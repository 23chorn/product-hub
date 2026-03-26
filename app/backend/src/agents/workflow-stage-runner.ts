/**
 * Workflow Stage Runner — autonomous specialist execution.
 *
 * Contains the fire-and-forget background task that runs a specialist agent,
 * streams its output, saves artifacts, runs inline critic review, and creates
 * checkpoints for human review.
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import db from '../data/database';
import { sessionManager } from '../session/session-manager';
import { CoordinatorAgent } from './coordinator-agent';
import { CriticAgent } from './critic-agent';
import { ContextCuratorAgent } from './curator-agent';
import { SpecialistAgent } from './specialist-agent';
import { resolveAgentModel, type TokenUsage } from '../utils/ai-provider';
import { computeRevisionDiff } from '../utils/revision-diff';
import { injectSprintEstimates } from './sprint-estimation';
import {
  STAGE_SESSION_MAP, STAGE_MAX_OUTPUT_TOKENS, STAGE_ARTIFACT_TYPE,
  STAGE_ARTIFACT_LABEL,
} from './stage-metadata';
import {
  saveCriticArtifact, getLatestArchitectureArtifactPath,
  getLatestArtifactPathByType,
} from './artifact-helpers';
import { loadWorkflowArtifacts, loadLocalDesignSystem, loadFigmaDesignSystem, repairTruncatedJson } from './prototype-agent';
import {
  PROJECT_ROOT, logger, stmts, insertEvent, addWorkflowCost,
  setCheckpointTokenUsage, loadGlobalPolicies, workflowOps,
  type StageTokenData,
} from './workflow-db';

/**
 * Stages that run silently with no human review gate.
 * Currently empty — every stage pauses for human approval.
 * To skip human review on a stage, add it here (e.g. new Set(['pm_prd'])).
 */
export const SILENT_STAGES = new Set<string>([]);

// ── Lazy singletons — avoids reading persona files at import time ─────────────

let _coordinator: CoordinatorAgent | null = null;
export function getCoordinator(): CoordinatorAgent {
  if (!_coordinator) _coordinator = new CoordinatorAgent();
  return _coordinator;
}

let _critic: CriticAgent | null = null;
export function getCritic(): CriticAgent {
  if (!_critic) _critic = new CriticAgent();
  return _critic;
}

let _curator: ContextCuratorAgent | null = null;
export function getCurator(): ContextCuratorAgent {
  if (!_curator) _curator = new ContextCuratorAgent();
  return _curator;
}

// ── Autonomous stage execution ────────────────────────────────────────────────

/**
 * Run a specialist stage autonomously (no user interaction).
 * Builds the specialist's system prompt, sends a single "produce output now"
 * message, collects the full response, saves it as an artifact, then creates
 * a pending checkpoint so the human reviews the output.
 *
 * This is a fire-and-forget background task called from advanceStage().
 */
export async function runAutonomousStage(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  brief: string,
  autoApprove: boolean,
  priorCriticIssues?: string[],
  priorDraftContent?: string,
  priorRunsCost?: number,
  skipCritic?: boolean
): Promise<void> {
  const stageMap = STAGE_SESSION_MAP[stage];
  if (!stageMap) {
    logger.error(`runAutonomousStage: no stage map for "${stage}"`);
    return;
  }

  // Resolve model: workflow policy_overrides take priority, then per-agent defaults
  const workflow = stmts.getWorkflow.get(workflowId);
  const policyOverrides: Record<string, string> = workflow?.policy_overrides
    ? JSON.parse(workflow.policy_overrides)
    : {};
  const stageModelKey = `model:${stage}`;
  const stageModel = policyOverrides[stageModelKey] || resolveAgentModel(stage);
  logger.info(`Stage "${stage}" using model: ${stageModel}`);

  // Per-stage token tracking — captured here, stored on the final pending checkpoint.
  let specialistTokenData: StageTokenData['specialist'] | null = null;
  let criticTokenData: StageTokenData['critic'] | null = null;
  // Costs captured in plain numbers to avoid TS5.9 closure-narrowing issues with ?.estimatedCost
  let specialistRunCost = 0;
  let criticRunCost = 0;

  const specialistTokenCallback = (usage: TokenUsage) => {
    specialistTokenData = {
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      searchCount: usage.searchCount, estimatedCost: usage.estimatedCost,
    };
    specialistRunCost = usage.estimatedCost;
    addWorkflowCost(workflowId, usage.estimatedCost);
  };
  const criticTokenCallback = (usage: TokenUsage) => {
    criticTokenData = {
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      estimatedCost: usage.estimatedCost,
    };
    criticRunCost = usage.estimatedCost;
    addWorkflowCost(workflowId, usage.estimatedCost);
  };

  logger.info(`Autonomous stage "${stage}" starting (session=${sessionId})`);

  try {
    const agent = new SpecialistAgent(stageMap.agentType);
    const persona = await agent.loadPersona();

    // Extract the goal from the brief and pin it in the system prompt so the
    // model cannot miss it even when the project context describes a different product.
    const goalMatch = brief.match(/^## Goal\n([\s\S]*?)(?=\n## |\n# |$)/m);
    const goalText = goalMatch ? goalMatch[1].trim() : null;

    // Build item context: for analyst, the goal itself is the primary context.
    // For later stages, inject the previous stage's artifact.
    let itemContext: string | undefined;
    if (stage === 'analyst') {
      if (goalText) {
        itemContext = `## THIS IS YOUR RESEARCH TOPIC\nThe task below defines exactly what to research. The company context above is background only — your output must be about this specific goal, NOT about the company's existing products.\n\n**Goal:** ${goalText}`;
      }
    } else if (stage === 'pm_prd') {
      const analystPath = sessionManager.getLatestAnalystArtifactPath(itemId);
      if (analystPath) {
        try {
          const content = fs.readFileSync(analystPath, 'utf-8');
          itemContext = `**Research Brief (use as background for the PRD):**\n\n${content}`;
        } catch { /* ignore */ }
      }
    } else if (stage === 'solution_architect') {
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      let prdContent = '';
      if (prdPath) {
        try { prdContent = fs.readFileSync(prdPath, 'utf-8'); } catch { /* ignore */ }
      }
      // Load tech-stack context if available
      const techStackPath = path.join(PROJECT_ROOT, 'context', 'tech-stack.md');
      let techStackNote = '';
      try {
        const techStack = fs.readFileSync(techStackPath, 'utf-8');
        techStackNote = `**Existing Tech Stack (align your architecture with this):**\n\n${techStack}`;
      } catch {
        techStackNote = `**Note:** No existing tech stack document found at context/tech-stack.md. You should recommend technology choices with tradeoffs for each decision.`;
      }
      const parts: string[] = [];
      if (prdContent) parts.push(`**PRD Document (use as source of requirements for the architecture):**\n\n${prdContent}`);
      parts.push(techStackNote);
      itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'pm_backlog') {
      const parts: string[] = [];
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          parts.push(`**PRD Document (use as source of requirements for the backlog):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      const archPath = getLatestArchitectureArtifactPath(itemId);
      if (archPath) {
        try {
          const content = fs.readFileSync(archPath, 'utf-8');
          parts.push(`**Architecture Document (reference specific services, APIs, and data models in stories):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'gtm_strategy') {
      const parts: string[] = [];
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          parts.push(`**PRD Document (use as the source of truth for personas, scope, and success metrics — do not redefine these):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'feature_marketing') {
      const parts: string[] = [];
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          parts.push(`**PRD Document (use to verify that all copy references only approved capabilities):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      const gtmPath = getLatestArtifactPathByType(itemId, 'gtm');
      if (gtmPath) {
        try {
          const content = fs.readFileSync(gtmPath, 'utf-8');
          parts.push(`**GTM Strategy (use as the source of positioning, messaging hierarchy, and channel direction):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'prototype') {
      // Load design system context: try Figma MCP first, fall back to local CSS tokens
      const figma = await loadFigmaDesignSystem((msg) => {
        insertEvent(workflowId, 'stage_progress', stage, msg.trim());
      });
      const designSystem = figma || await loadLocalDesignSystem();
      // Load prior workflow artifacts (research, PRD, architecture) as reference
      const artifacts = loadWorkflowArtifacts(itemId);
      const parts: string[] = [];
      if (designSystem) parts.push(`## Design System\n\n${designSystem}`);
      if (artifacts) parts.push(`## Workflow Artifacts\n\nUse these documents to understand what to prototype:\n\n${artifacts}`);
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    }

    const systemPrompt = await agent.buildSystemPrompt(persona, undefined, itemContext, true, stage);

    // For revision runs: construct a conversation thread so the specialist sees its
    // prior output as its own assistant turn and makes targeted edits rather than
    // rewriting from scratch. The brief contains revision instructions only (no
    // embedded prior draft). The prior draft is injected as the assistant turn.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = priorDraftContent
      ? (() => {
          const artifactLabel = STAGE_ARTIFACT_LABEL[stage] ?? 'document';
          const issueLines = priorCriticIssues && priorCriticIssues.length > 0
            ? `\n\nThe specific issues to address:\n${priorCriticIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`
            : '';
          const revisionDirective =
            `Please revise the ${artifactLabel} above based on the issues listed in the revision instructions.${issueLines}\n\n` +
            `Make targeted changes only — locate and fix the flagged sections directly. ` +
            `Do not rewrite, restructure, or modify any section that was not flagged. ` +
            `Return the complete revised ${artifactLabel} with all sections included.`;
          // Wrap JSON artifacts in code fences for the assistant turn
          const formattedDraft = (stage === 'prototype' || stage === 'pm_backlog')
            ? '```json\n' + priorDraftContent + '\n```'
            : priorDraftContent;
          return [
            { role: 'user' as const, content: brief },
            { role: 'assistant' as const, content: formattedDraft },
            { role: 'user' as const, content: revisionDirective },
          ];
        })()
      : [
          { role: 'user', content: brief },
        ];

    let fullResponse = '';
    let lastReportedSection = '';
    const startTime = Date.now();
    let lastProgressTime = startTime;

    for await (const chunk of agent.streamResponse(systemPrompt, messages, stageModel, specialistTokenCallback, STAGE_MAX_OUTPUT_TOKENS[stage])) {
      fullResponse += chunk;

      // Detect progress and emit events
      const now = Date.now();
      if (now - lastProgressTime > 3000) {  // Throttle to max once every 3s
        if (stage === 'prototype') {
          // For JSON output, track progress by counting file entries
          const fileMatches = fullResponse.match(/"[^"]+\.tsx?"\s*:/g);
          const fileCount = fileMatches ? fileMatches.length : 0;
          if (fileCount > 0) {
            const countStr = `${fileCount} file(s)`;
            if (countStr !== lastReportedSection) {
              lastReportedSection = countStr;
              insertEvent(workflowId, 'stage_progress', stage,
                `Generating prototype... ${countStr} so far`);
              lastProgressTime = now;
            }
          }
        } else {
          const sectionMatch = fullResponse.match(/^## ([^\n]+)/gm);
          if (sectionMatch && sectionMatch.length > 0) {
            const latestSection = sectionMatch[sectionMatch.length - 1].replace(/^## /, '').trim();
            if (latestSection !== lastReportedSection) {
              lastReportedSection = latestSection;
              const sectionCount = sectionMatch.length;
              insertEvent(workflowId, 'stage_progress', stage,
                `Writing section ${sectionCount}: ${latestSection}...`);
              lastProgressTime = now;
            }
          }
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.info(`Autonomous stage "${stage}" LLM streaming complete (${elapsed}s, ${fullResponse.length} chars)`);

    // Write artifact to disk
    const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, stageMap.mode, 'artifacts');
    await fsAsync.mkdir(artifactDir, { recursive: true });
    const ext = (stage === 'pm_backlog' || stage === 'prototype') ? 'json' : 'md';
    const artifactPath = path.join(artifactDir, `${Date.now()}-${stage}.${ext}`);
    // Clean up LLM output before saving
    let artifactContent: string;
    if (stage === 'prototype') {
      // Strip code fences, repair truncated JSON, pretty-print
      const repaired = repairTruncatedJson(fullResponse);
      try {
        const parsed = JSON.parse(repaired);
        artifactContent = JSON.stringify(parsed, null, 2);
      } catch {
        artifactContent = repaired;
      }
    } else if (stage === 'pm_backlog') {
      // Strip markdown code fences from JSON output
      const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      try {
        const parsed = JSON.parse(stripped);
        artifactContent = await injectSprintEstimates(parsed);
      } catch {
        // If JSON parse fails, save as-is and let downstream error handling catch it
        artifactContent = stripped;
      }
    } else {
      // Strip any preamble before the first markdown heading (e.g. "Here's the research brief:")
      const match = fullResponse.match(/^# /m);
      artifactContent = match?.index && match.index > 0
        ? fullResponse.slice(match.index)
        : fullResponse;
    }
    await fsAsync.writeFile(artifactPath, artifactContent, 'utf-8');

    // Insert artifact record (type must match what getLatestPrdArtifact / getLatestAnalystArtifact query for)
    const artifactType = STAGE_ARTIFACT_TYPE[stage] ?? stage;
    const artifactResult = db.prepare(`
      INSERT INTO artifacts (session_id, type, file_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, artifactType, artifactPath, Date.now());
    const artifactId = artifactResult.lastInsertRowid as number;

    // If this is a revision run, compute and save a diff of what changed
    let diffArtifactId: number | null = null;
    if (priorDraftContent) {
      try {
        const stageLabel = STAGE_ARTIFACT_TYPE[stage] ?? stage;
        const diffText = computeRevisionDiff(priorDraftContent, artifactContent, stageLabel);
        const diffPath = path.join(artifactDir, `${Date.now()}-${stage}-diff.md`);
        await fsAsync.writeFile(diffPath, diffText, 'utf-8');
        const diffResult = db.prepare(`
          INSERT INTO artifacts (session_id, type, file_path, created_at)
          VALUES (?, ?, ?, ?)
        `).run(sessionId, `${stage}_diff`, diffPath, Date.now());
        diffArtifactId = diffResult.lastInsertRowid as number;
        logger.info(`Revision diff saved for stage "${stage}" (artifact ${diffArtifactId})`);
      } catch (err: any) {
        logger.warn(`Failed to compute revision diff for "${stage}": ${err.message}`);
      }
    }

    // Log stage completion event with excerpt
    const excerpt = fullResponse.slice(0, 200).replace(/\n+/g, ' ').trim();
    const stageLabel = stage === 'analyst' ? 'Research' : stage === 'pm_prd' ? 'PRD' : stage === 'solution_architect' ? 'Architecture' : stage === 'prototype' ? 'Prototype' : stage === 'pm_backlog' ? 'Backlog' : stage === 'gtm_strategy' ? 'GTM Strategy' : stage === 'feature_marketing' ? 'Feature Marketing' : stage;

    // ── Inline critic review for specialist stages ────────────────────────────
    // After each specialist produces an artifact, the critic reviews it.
    // If issues are found, auto-revise once. If still unresolved,
    // pause and ask the human for input.
    const specialistStages = new Set(['analyst', 'pm_prd', 'solution_architect', 'prototype', 'pm_backlog', 'gtm_strategy', 'feature_marketing']);
    const policies = loadGlobalPolicies();
    const criticEnabled = policies.get('require_critic_review') !== 'false' && policies.get('require_critic_review') !== (false as any);

    if (specialistStages.has(stage) && criticEnabled && !skipCritic) {
      insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} draft complete.`,
        { excerpt, artifact_id: artifactId });

      // Brief pause before critic to reduce back-to-back API rate limit pressure
      await new Promise(r => setTimeout(r, 8_000));

      insertEvent(workflowId, 'stage_progress', stage, 'Running quality review...');

      // Load reference documents so the critic can cross-check completeness.
      // pm_backlog: needs PRD (FR coverage) + architecture (story scoping)
      // solution_architect: needs PRD (NFR traceability)
      // gtm_strategy: needs PRD (persona/scope consistency)
      // feature_marketing: needs PRD + GTM strategy (copy scope verification)
      let criticReferenceDocuments: string | undefined;
      if (stage === 'pm_backlog' || stage === 'solution_architect' || stage === 'prototype' || stage === 'gtm_strategy') {
        const refParts: string[] = [];
        const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
        if (prdPath) {
          try {
            const content = fs.readFileSync(prdPath, 'utf-8');
            refParts.push(`### PRD Document\n\n${content}`);
          } catch { /* ignore */ }
        }
        if (stage === 'pm_backlog' || stage === 'prototype') {
          const archPath = getLatestArchitectureArtifactPath(itemId);
          if (archPath) {
            try {
              const content = fs.readFileSync(archPath, 'utf-8');
              refParts.push(`### Architecture Document\n\n${content}`);
            } catch { /* ignore */ }
          }
        }
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      } else if (stage === 'feature_marketing') {
        const refParts: string[] = [];
        const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
        if (prdPath) {
          try {
            const content = fs.readFileSync(prdPath, 'utf-8');
            refParts.push(`### PRD Document\n\n${content}`);
          } catch { /* ignore */ }
        }
        const gtmPath = getLatestArtifactPathByType(itemId, 'gtm');
        if (gtmPath) {
          try {
            const content = fs.readFileSync(gtmPath, 'utf-8');
            refParts.push(`### GTM Strategy\n\n${content}`);
          } catch { /* ignore */ }
        }
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      }

      const review = await getCritic().review(fullResponse, artifactType, resolveAgentModel('critic'), criticTokenCallback, stage, priorCriticIssues, criticReferenceDocuments);
      insertEvent(workflowId, 'stage_progress', stage, 'Quality review complete. Processing results...');

      // Save full critic review as artifact .md file
      const criticArtifactId = await saveCriticArtifact(itemId, stage, review.fullText, sessionId);

      const criticDetails = {
        critic_verdict: review.verdict,
        issue_count: review.issues.length,
        critical_issues: review.issues.filter(i => i.severity === 'critical').length,
        major_issues: review.issues.filter(i => i.severity === 'major').length,
        issues_summary: review.issues.slice(0, 5).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; '),
        inline_review: true,
        reviewed_stage: stage,
        critic_artifact_id: criticArtifactId,
        questions: review.questions,
        issues: review.issues.slice(0, 10),
      };

      if (review.verdict === 'approve') {
        // Critic approved — still pause for human review before advancing
        const now = Date.now();
        const cpResult = stmts.insertCheckpoint.run(
          workflowId, stage, artifactId, 'pending',
          JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
          now
        );
        if (specialistTokenData) {
          setCheckpointTokenUsage(cpResult.lastInsertRowid as number,
            { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}), ...(priorRunsCost ? { priorRunsCost } : {}) });
        }
        stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
        const minorCount = review.issues.filter(i => i.severity === 'minor').length;
        const approveMsg = minorCount > 0
          ? `Quality review passed with ${minorCount} minor note${minorCount > 1 ? 's' : ''} (resolved internally). Approve to proceed.`
          : 'Quality review passed — no issues found. Approve to proceed.';
        insertEvent(workflowId, 'critic_verdict', stage, approveMsg, criticDetails);
        logger.info(`Inline critic approved "${stage}" for workflow ${workflowId} — paused for human review`);
        return;
      }

      // Critic wants revisions — auto-revise once, then ask the human.
      // Keeps agents from looping on issues a human can resolve quickly.
      const MAX_INLINE_REVISIONS = 1;

      // Check how many times we've already revised this stage in this workflow
      const priorRevisions = stmts.getCheckpointsByWorkflow.all(workflowId)
        .filter(c => c.stage === stage && c.status === 'revised').length;

      if (priorRevisions < MAX_INLINE_REVISIONS) {
        // Auto-revise: rerun the specialist with the prior draft + explicit issue list.
        const now = Date.now();
        stmts.insertCheckpoint.run(
          workflowId, stage, artifactId, 'revised',
          JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails }),
          now
        );
        insertEvent(workflowId, 'critic_verdict', stage,
          `Quality review flagged issues. Auto-revising (attempt ${priorRevisions + 1}/${MAX_INLINE_REVISIONS}).`,
          criticDetails);

        // Keep workflow on the same stage
        stmts.updateWorkflowStageAndStatus.run(stage, 'active', now, workflowId);

        // Build a revision brief: includes the prior draft + explicit issue list so the
        // specialist revises its own output rather than writing a new document from scratch.
        const priorIssuesForRevision = review.issues.map(i => `[${i.severity.toUpperCase()}] ${i.description}`);
        const revisedBrief = getCoordinator().generateRevisionBrief(workflowId, stage, fullResponse, priorIssuesForRevision);
        const newSession = sessionManager.createSpecialistSession(itemId, stageMap.mode, stageMap.agentType);
        sessionManager.updateWorkflow(newSession.id, workflowId, revisedBrief);

        logger.info(`Inline critic revision ${priorRevisions + 1}/${MAX_INLINE_REVISIONS} for "${stage}" in workflow ${workflowId}`);
        const thisRunCost = specialistRunCost + criticRunCost;
        runAutonomousStage(newSession.id, workflowId, stage, itemId, revisedBrief, autoApprove, priorIssuesForRevision, fullResponse, (priorRunsCost ?? 0) + thisRunCost)
          .catch(err => logger.error(`Inline revision for "${stage}" failed: ${err.message}`));
        return;
      }

      // Max revisions exhausted — pause at checkpoint for human input
      const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
      const hasQuestions = review.questions && review.questions.length > 0;
      const questionsSummary = hasQuestions
        ? ` Questions: ${review.questions.slice(0, 2).join('; ')}`
        : '';

      const now = Date.now();
      const cpResult2 = stmts.insertCheckpoint.run(
        workflowId, stage, artifactId, 'pending',
        JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
        now
      );
      if (specialistTokenData) {
        setCheckpointTokenUsage(cpResult2.lastInsertRowid as number,
          { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}) });
      }
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      insertEvent(workflowId, 'critic_verdict', stage,
        `Quality review still has unresolved issues after ${MAX_INLINE_REVISIONS} revision(s): ${issuesSummary}.${questionsSummary} How would you like to proceed?`,
        criticDetails);
      logger.info(`Inline critic exhausted revisions for "${stage}" — pausing for human input`);
      return;
    }

    // ── Non-critic path (critic disabled or non-specialist stage) ─────────────
    const checkpointStatus = autoApprove ? 'approved' : 'pending';
    const now = Date.now();
    const cpResult3 = stmts.insertCheckpoint.run(
      workflowId, stage, artifactId, checkpointStatus,
      JSON.stringify({ session_id: sessionId, autonomous: true, auto_approved: autoApprove, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
      now
    );
    if (specialistTokenData) {
      setCheckpointTokenUsage(cpResult3.lastInsertRowid as number,
        { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}) });
    }
    insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} complete.`,
      { excerpt, artifact_id: artifactId });

    if (autoApprove) {
      logger.info(`Autonomous stage "${stage}" complete (silent) — advancing to next stage`);
      workflowOps.advanceStage(workflowId).catch(err => {
        if (err.message?.startsWith('WORKFLOW_COMPLETE')) {
          logger.info(`Workflow ${workflowId} completed after silent chain through "${stage}"`);
        } else {
          logger.error(`Auto-advance after silent stage "${stage}" failed: ${err.message}`);
          const now2 = Date.now();
          stmts.insertCheckpoint.run(
            workflowId, stage, null, 'pending',
            JSON.stringify({ error: `Auto-advance failed: ${err.message}`, autonomous: true }),
            now2
          );
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now2, workflowId);
        }
      });
    } else {
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      logger.info(`Autonomous stage "${stage}" complete — checkpoint created, workflow paused`);
    }
  } catch (err: any) {
    logger.error(`Autonomous stage "${stage}" failed: ${err.message}`);
    insertEvent(workflowId, 'error', stage,
      `Stage "${stage}" encountered an error: ${err.message}`,
      { error: err.message });
    // Create a pending checkpoint with the error so the UI doesn't hang forever
    const now = Date.now();
    stmts.insertCheckpoint.run(
      workflowId, stage, null, 'pending',
      JSON.stringify({ error: err.message, autonomous: true }),
      now
    );
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
  }
}

// Register for late-binding (breaks circular dep with advanceStage in workflow-router.ts)
workflowOps.runAutonomousStage = runAutonomousStage;
