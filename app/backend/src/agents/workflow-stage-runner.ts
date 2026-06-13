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
  saveCriticArtifact, saveLocalArtifact, loadLatestArtifactContent, updateArtifactContent,
} from './artifact-helpers';
import { getActiveSkill } from './skill-registry';
import { type ToolDefinition, getRegisteredTools } from './tool-registry';
import { loadWorkflowArtifacts, loadLocalDesignSystem, loadFigmaDesignSystem, repairTruncatedJson } from './prototype-agent';
import {
  PROJECT_ROOT, logger, stmts, insertEvent, addWorkflowCost,
  setCheckpointTokenUsage, loadGlobalPolicies, workflowOps, getStageRole,
  type StageTokenData,
} from './workflow-db';
import { isDemoMode, getDemoFixture, getDemoFixtureForTheme, demoSleep, DEMO_STAGE_DELAY_MS } from '../demo/demo-mode';
import { notifyCheckpointPending } from '../utils/slack-notifier';

/**
 * Stages that run silently with no human review gate.
 * Currently empty — every stage pauses for human approval.
 * To skip human review on a stage, add it here (e.g. new Set(['pm_prd'])).
 */
export const SILENT_STAGES = new Set<string>([]);

// ── User-initiated cancel registry ───────────────────────────────────────────

const _cancelControllers = new Map<string, AbortController>();
const _cancelledWorkflows = new Set<string>();

/**
 * Request cancellation of an active workflow.
 * Aborts any in-flight LLM stream, emits a `workflow_cancelled` event,
 * and marks the workflow complete so no further stages start.
 */
export function requestCancel(workflowId: string): void {
  _cancelledWorkflows.add(workflowId);
  const controller = _cancelControllers.get(workflowId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  const now = Date.now();
  try { stmts.updateWorkflowStatus.run('complete', now, workflowId); } catch { /* ignore */ }
  insertEvent(workflowId, 'workflow_cancelled', null, 'Workflow stopped by user.');
  logger.info(`Workflow ${workflowId} cancelled by user`);
}

/** Returns true if the user has requested cancellation for this workflow. */
export function isCancelRequested(workflowId: string): boolean {
  return _cancelledWorkflows.has(workflowId);
}

/** Clears the cancel flag so a restarted workflow can run again. */
export function clearCancelFlag(workflowId: string): void {
  _cancelledWorkflows.delete(workflowId);
  _cancelControllers.delete(workflowId);
}

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
  // ── Multi-Agent Refinement for story_decomposition_F* stages ────────────────
  // Each feature runs a multi-agent collaborative session (platform-filtered participants)
  const featureMatch = stage.match(/^story_decomposition_F(\d+)$/);
  if (featureMatch) {
    const featureIndex = parseInt(featureMatch[1], 10) - 1; // Convert to 0-based
    const { runMultiAgentRefinement } = await import('./multi-agent-refinement');

    try {
      const artifactContent = await runMultiAgentRefinement(workflowId, itemId, stage, featureIndex);
      const strippedArtifact = artifactContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const newFeature = JSON.parse(strippedArtifact);

      // Load accumulated backlog (if any previous features completed)
      let accumulatedBacklog: any;
      const { loadLatestArtifactContent } = await import('./artifact-helpers');
      const priorBacklogContent = await loadLatestArtifactContent(itemId, 'backlog');

      if (priorBacklogContent) {
        // Append new feature to existing backlog
        const cleaned = priorBacklogContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
        accumulatedBacklog = JSON.parse(cleaned);
        accumulatedBacklog.features.push(...newFeature.features);
      } else {
        // First feature — initialize backlog structure
        accumulatedBacklog = newFeature;
      }

      // Save the accumulated backlog artifact (epic + all features so far).
      // Type is always 'backlog' so loadLatestArtifactContent(itemId, 'backlog') finds it for accumulation.
      const { saveLocalArtifact } = await import('./artifact-helpers');
      const artifactId = await saveLocalArtifact(sessionId, 'backlog', JSON.stringify(accumulatedBacklog, null, 2), itemId, null);

      // Create checkpoint for human review — ADO push happens at checkpoint approval
      const { pauseAtCheckpoint } = await import('./workflow-router');
      await pauseAtCheckpoint(workflowId, stage, artifactId, undefined);

      logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement complete — checkpoint created`);

      insertEvent(workflowId, 'stage_completed', stage,
        `Multi-agent collaborative refinement complete for Feature ${featureIndex + 1} — ready for human review`,
        { artifact_id: artifactId });

      return;
    } catch (err: any) {
      logger.error(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement failed: ${err.message}`);
      insertEvent(workflowId, 'error', stage, `Multi-agent refinement failed: ${err.message}`);
      throw err;
    }
  }

  // Handle dynamic feature stages (qa_engineer_F1, F2, etc., tech_refinement_F1, F2, etc.)
  let stageMap = STAGE_SESSION_MAP[stage];
  if (!stageMap && stage.match(/^story_decomposition_F\d+$/)) {
    stageMap = STAGE_SESSION_MAP['story_decomposition'];
  }
  if (!stageMap && stage.match(/^qa_engineer_F\d+$/)) {
    stageMap = STAGE_SESSION_MAP['qa_engineer'];
  }
  if (!stageMap && stage.match(/^tech_refinement_F\d+$/)) {
    stageMap = STAGE_SESSION_MAP['tech_refinement'];
  }
  if (!stageMap) {
    logger.error(`runAutonomousStage: no stage map for "${stage}"`);
    return;
  }

  const activeSkill = getActiveSkill(stage);
  const skillVersionId = activeSkill?.id ?? null;
  if (activeSkill) {
    db.prepare(
      `INSERT INTO workflow_skill_assignments (workflow_id, stage, skill_name, skill_version, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(workflowId, stage, activeSkill.skill_name, activeSkill.version, Date.now());
    logger.info(`Stage "${stage}" using skill v${activeSkill.version}`);
  }

  // Parse tool definitions from skill and filter to those with registered handlers
  let skillTools: ToolDefinition[] = [];
  if (activeSkill?.tool_definitions) {
    try {
      const parsed: ToolDefinition[] = JSON.parse(activeSkill.tool_definitions);
      const registered = getRegisteredTools();
      skillTools = parsed.filter(t => registered.includes(t.name));
      const skipped = parsed.length - skillTools.length;
      if (skipped > 0) {
        logger.warn(`Stage "${stage}": ${skipped} tool(s) skipped — no handler registered`);
      }
      if (skillTools.length > 0) {
        logger.info(`Stage "${stage}": providing tools: ${skillTools.map(t => t.name).join(', ')}`);
      }
    } catch {
      logger.warn(`Stage "${stage}": could not parse tool_definitions from skill`);
    }
  }

  // ── Deprecation warning ───────────────────────────────────────────────────────
  if (stage === 'pm_backlog') {
    logger.warn(`[DEPRECATION] Stage "pm_backlog" is deprecated. Use "epic_feature_planner" + "story_decomposition" instead. Workflow ${workflowId} will continue with legacy stage.`);
    insertEvent(workflowId, 'stage_progress', stage, '⚠️  pm_backlog is deprecated — use epic_feature_planner + story_decomposition in new workflows');
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
  const coordinatorFilterTokenCallback = (usage: TokenUsage) => {
    addWorkflowCost(workflowId, usage.estimatedCost);
  };

  logger.info(`Autonomous stage "${stage}" starting (session=${sessionId})`);

  // Bail immediately if a cancel was already requested before this stage started
  if (isCancelRequested(workflowId)) {
    logger.info(`Stage "${stage}" skipped — workflow ${workflowId} was cancelled`);
    return;
  }

  // AbortController lets the user kill the in-flight LLM stream
  const abortController = new AbortController();
  _cancelControllers.set(workflowId, abortController);

  try {
    // ── Demo fixture lookup ────────────────────────────────────────────────────
    // Check workflow policy to see if this is a demo workflow (either demo_mode or demo_auto_approve).
    // When demo flag is present, replace the LLM call with a pre-built fixture.
    // isDemoMode() controls UI visibility only — it must not affect real workflow behavior.
    const workflow = stmts.getWorkflow.get(workflowId);
    const policyOverrides: Record<string, string> = workflow?.policy_overrides
      ? JSON.parse(workflow.policy_overrides)
      : {};
    const isDemoWorkflow = policyOverrides.demo_mode === 'true' || policyOverrides.demo_auto_approve === 'true';

    logger.info(`[DEMO CHECK] Stage "${stage}" - isDemoWorkflow: ${isDemoWorkflow}, policyOverrides: ${JSON.stringify(policyOverrides)}`);

    let demoFixture: string | null = null;
    if (isDemoWorkflow) {
      demoFixture = getDemoFixture(stage) ?? null;
      logger.info(`[DEMO FIXTURE] Stage "${stage}" - fixture ${demoFixture ? 'LOADED' : 'NOT FOUND'} (${demoFixture?.length ?? 0} chars)`);
    }

    const agent = new SpecialistAgent(stageMap.agentType);
    const persona = await agent.loadPersona(stage);

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
      const analystContent = await loadLatestArtifactContent(itemId, 'analyst');
      if (analystContent) {
        itemContext = `**Research Brief (use as background for the PRD):**\n\n${analystContent}`;
      }
    } else if (stage === 'epic_feature_planner') {
      const prdContent = await loadLatestArtifactContent(itemId, 'prd');
      if (prdContent) {
        itemContext = `**PRD Document (use as source of functional requirements to decompose into epic and features):**\n\n${prdContent}`;
      }
    } else if (stage === 'solution_architect') {
      const parts: string[] = [];
      const prdContent = await loadLatestArtifactContent(itemId, 'prd');
      if (prdContent) parts.push(`**PRD Document (use as source of requirements for the architecture):**\n\n${prdContent}`);

      const techStackPath = path.join(PROJECT_ROOT, 'context', 'tech-stack.md');
      let techStackNote = '';
      try {
        const techStack = fs.readFileSync(techStackPath, 'utf-8');
        techStackNote = `**Existing Tech Stack (align your architecture with this):**\n\n${techStack}`;
      } catch {
        techStackNote = `**Note:** No existing tech stack document found at context/tech-stack.md. You should recommend technology choices with tradeoffs for each decision.`;
      }
      parts.push(techStackNote);
      itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'story_decomposition') {
      const parts: string[] = [];
      const [prdContent, archContent] = await Promise.all([
        loadLatestArtifactContent(itemId, 'prd'),
        loadLatestArtifactContent(itemId, 'architecture'),
      ]);
      if (prdContent) parts.push(`**PRD Document (use as source of functional requirements for story traceability):**\n\n${prdContent}`);
      if (archContent) parts.push(`**Architecture Document (reference specific services, APIs, and data models in stories):**\n\n${archContent}`);

      // CRITICAL: Load the tech-enriched epic/features JSON from the architect
      // This should be extracted from the architect's output (the ## Technical Feature Metadata section)
      // For now, try loading as a separate artifact type if it exists
      let techEpicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features_enriched');
      if (!techEpicFeaturesContent) {
        techEpicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features');
      }

      if (techEpicFeaturesContent) {
        parts.push(`**Tech-Enriched Epic & Features (decompose each feature into 6-8 stories, preserving all epic/feature metadata):**\n\n${techEpicFeaturesContent}`);
      }

      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    }

    // ── Feature-specific story decomposition ─────────────────────────────────────
    const { parseFeatureStage, loadPartialBacklog } = await import('./feature-decomposition');
    const featureIndex = parseFeatureStage(stage);
    if (featureIndex !== null) {
      const parts: string[] = [];
      const [prdContent, archContent] = await Promise.all([
        loadLatestArtifactContent(itemId, 'prd'),
        loadLatestArtifactContent(itemId, 'architecture'),
      ]);

      // Load epic/features structure (try enriched first, then fallback to base)
      let epicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features_enriched');
      if (!epicFeaturesContent) {
        epicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features');
      }

      if (!epicFeaturesContent) {
        throw new Error(`No epic_features artifact found for feature-specific stage ${stage}`);
      }

      // Parse to get the target feature
      const cleaned = epicFeaturesContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const jsonStart = cleaned.indexOf('{');
      const jsonContent = jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
      const epicFeatures = JSON.parse(jsonContent);

      if (!epicFeatures.features || featureIndex >= epicFeatures.features.length) {
        throw new Error(`Feature index ${featureIndex} out of range for ${stage}`);
      }

      const targetFeature = epicFeatures.features[featureIndex];

      // Load prior partial backlog (if exists)
      const priorBacklog = await loadPartialBacklog(itemId);

      // Build feature-specific context
      if (prdContent) parts.push(`**PRD Document (use for FR traceability):**\n\n${prdContent}`);
      if (archContent) parts.push(`**Architecture Document (reference specific components and APIs):**\n\n${archContent}`);
      parts.push(`**Epic & Features Structure:**\n\n${epicFeaturesContent}`);

      parts.push(`\n---\n\n**YOUR TASK:**\n\nDecompose ONLY the following feature into 6-8 stories or technical tasks. Do NOT decompose other features.\n\n**Feature to decompose:** ${targetFeature.title}\n**Phase:** ${targetFeature.phase}\n**Description:** ${targetFeature.description}\n**Acceptance Criteria:**\n${targetFeature.acceptanceCriteria?.map((ac: string, i: number) => `${i + 1}. ${ac}`).join('\n')}\n\n**Technical Context (from architect):**\n${targetFeature.technical ? JSON.stringify(targetFeature.technical, null, 2) : 'N/A'}`);

      parts.push(`\n**Output format:**\n\nReturn the FULL backlog JSON structure (epic + all features), but ONLY populate stories for Feature ${featureIndex + 1} (${targetFeature.title}).\n\nFor other features, include them with their metadata but leave \`stories: []\` empty.`);

      if (priorBacklog) {
        parts.push(`\n**Prior work (preserve these):**\n\nThe following features have already been decomposed. Copy their stories exactly as-is:\n\n\`\`\`json\n${priorBacklog}\n\`\`\``);
      }

      itemContext = parts.join('\n\n');
    } else if (stage === 'pm_backlog') {
      const parts: string[] = [];
      const [prdContent, archContent] = await Promise.all([
        loadLatestArtifactContent(itemId, 'prd'),
        loadLatestArtifactContent(itemId, 'architecture'),
      ]);
      if (prdContent) parts.push(`**PRD Document (use as source of requirements for the backlog):**\n\n${prdContent}`);
      if (archContent) parts.push(`**Architecture Document (reference specific services, APIs, and data models in stories):**\n\n${archContent}`);
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'gtm_strategy') {
      const prdContent = await loadLatestArtifactContent(itemId, 'prd');
      if (prdContent) {
        itemContext = `**PRD Document (use as the source of truth for personas, scope, and success metrics — do not redefine these):**\n\n${prdContent}`;
      }
    } else if (stage === 'feature_marketing') {
      const parts: string[] = [];
      const [prdContent, gtmContent] = await Promise.all([
        loadLatestArtifactContent(itemId, 'prd'),
        loadLatestArtifactContent(itemId, 'gtm'),
      ]);
      if (prdContent) parts.push(`**PRD Document (use to verify that all copy references only approved capabilities):**\n\n${prdContent}`);
      if (gtmContent) parts.push(`**GTM Strategy (use as the source of positioning, messaging hierarchy, and channel direction):**\n\n${gtmContent}`);
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'tech_refinement' || stage.match(/^tech_refinement_F\d+$/)) {
      const parts: string[] = [];
      const [backlogContent, archContent, prdContent] = await Promise.all([
        loadLatestArtifactContent(itemId, 'backlog'),
        loadLatestArtifactContent(itemId, 'architecture'),
        loadLatestArtifactContent(itemId, 'prd'),
      ]);

      // Feature-specific tech refinement stage: provide only stories for this feature
      if (stage.match(/^tech_refinement_F\d+$/)) {
        const { parseFeatureStage } = await import('./feature-decomposition');
        const featureIndex = parseFeatureStage(stage);
        if (featureIndex !== null && backlogContent) {
          try {
            const backlog = JSON.parse(backlogContent);
            if (backlog.features && backlog.features[featureIndex]) {
              const targetFeature = backlog.features[featureIndex];
              const featureOnlyBacklog = {
                epic: backlog.epic,
                features: [targetFeature]
              };
              parts.push(`**Feature ${featureIndex + 1} Stories (THIS IS YOUR PRIMARY INPUT — enrich these ${targetFeature.stories.length} stories only with technical details, add platform fields, split oversized stories, enforce dependency ordering, add missing infra stories):**\n\n${JSON.stringify(featureOnlyBacklog, null, 2)}`);
            }
          } catch (err: any) {
            logger.warn(`Failed to parse backlog for feature-specific tech refinement: ${err.message}`);
            // Fallback to full backlog
            if (backlogContent) parts.push(`**PM Backlog (THIS IS YOUR PRIMARY INPUT — enrich every story with technical details, add platform fields, split oversized stories, enforce dependency ordering, add missing infra stories):**\n\n${backlogContent}`);
          }
        }
      } else {
        // Full tech_refinement stage (legacy single-stage flow)
        if (backlogContent) parts.push(`**PM Backlog (THIS IS YOUR PRIMARY INPUT — enrich every story with technical details, add platform fields, split oversized stories, enforce dependency ordering, add missing infra stories):**\n\n${backlogContent}`);
      }

      if (archContent) parts.push(`**Architecture Document (use to populate specific component names, API endpoints, data model changes):**\n\n${archContent}`);
      if (prdContent) parts.push(`**PRD Document (reference for FR traceability and NFR constraints):**\n\n${prdContent}`);
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'qa_engineer' || stage.match(/^qa_engineer_F\d+$/)) {
      const parts: string[] = [];
      const [prdContent, backlogContent] = await Promise.all([
        loadLatestArtifactContent(itemId, 'prd'),
        loadLatestArtifactContent(itemId, 'backlog'),
      ]);

      // Feature-specific QA stage: provide only stories for this feature
      if (stage.match(/^qa_engineer_F\d+$/)) {
        const { parseFeatureStage } = await import('./feature-decomposition');
        const featureIndex = parseFeatureStage(stage);
        if (featureIndex !== null && backlogContent) {
          try {
            const backlog = JSON.parse(backlogContent);
            if (backlog.features && backlog.features[featureIndex]) {
              const targetFeature = backlog.features[featureIndex];
              const featureOnlyBacklog = {
                epic: backlog.epic,
                features: [targetFeature]
              };
              if (prdContent) parts.push(`**PRD Document (use to trace every FR and acceptance criterion to test cases):**\n\n${prdContent}`);
              parts.push(`**Feature ${featureIndex + 1} Stories (create test cases for these ${targetFeature.stories.length} stories only — use story IDs like F${featureIndex + 1}.S1, F${featureIndex + 1}.S2, etc.):**\n\n${JSON.stringify(featureOnlyBacklog, null, 2)}`);
            }
          } catch (err: any) {
            logger.warn(`Failed to parse backlog for feature-specific QA: ${err.message}`);
            // Fallback to full backlog
            if (prdContent) parts.push(`**PRD Document (use to trace every FR and acceptance criterion to test cases):**\n\n${prdContent}`);
            if (backlogContent) parts.push(`**Backlog (use story IDs in format F1.S1, F2.S3, etc. to populate story_ref field — stories are indexed by their position in each feature's stories array):**\n\n${backlogContent}`);
          }
        }
      } else {
        // Full QA stage (legacy single-stage flow)
        if (prdContent) parts.push(`**PRD Document (use to trace every FR and acceptance criterion to test cases):**\n\n${prdContent}`);
        if (backlogContent) parts.push(`**Backlog (use story IDs in format F1.S1, F2.S3, etc. to populate story_ref field — stories are indexed by their position in each feature's stories array):**\n\n${backlogContent}`);
      }

      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'prototype') {
      // Load design system context: try Figma MCP first, fall back to local CSS tokens
      const figma = await loadFigmaDesignSystem((msg) => {
        insertEvent(workflowId, 'stage_progress', stage, msg.trim());
      });
      const designSystem = figma || await loadLocalDesignSystem();
      // Load prior workflow artifacts (research, PRD, architecture) as reference
      const artifacts = await loadWorkflowArtifacts(itemId);
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
          const formattedDraft = (stage === 'prototype' || stage === 'pm_backlog' || stage === 'tech_refinement' || stage === 'qa_engineer')
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
    const startTime = Date.now();

    if (demoFixture !== null) {
      // ── Demo fixture injection — simulate realistic progress events ───────
      if (stage === 'analyst') {
        insertEvent(workflowId, 'stage_progress', stage, 'Writing section 1: Executive Summary...');
        await demoSleep(4_500);
        insertEvent(workflowId, 'stage_progress', stage, 'Generating... 5s elapsed, 0.9k chars written');
        await demoSleep(3_500);
        insertEvent(workflowId, 'stage_progress', stage, 'Writing section 2: Market Analysis...');
        await demoSleep(2_000);
      } else {
        const delay = DEMO_STAGE_DELAY_MS[stage] ?? 2_000;
        insertEvent(workflowId, 'stage_progress', stage, `Running ${stage}...`);
        await demoSleep(delay);
      }
      fullResponse = demoFixture;
    } else {
      // ── Real LLM streaming ────────────────────────────────────────────────
      let lastReportedSection = '';
      let lastProgressTime = startTime;

      for await (const chunk of agent.streamResponse(systemPrompt, messages, stageModel, specialistTokenCallback, STAGE_MAX_OUTPUT_TOKENS[stage], skillTools, abortController.signal)) {
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
            // Heartbeat: still on same section and been silent for 45s — prove the stage is alive
            if (now - lastProgressTime > 45_000) {
              const elapsedSec = Math.round((now - startTime) / 1000);
              const kChars = (fullResponse.length / 1000).toFixed(1);
              insertEvent(workflowId, 'stage_progress', stage,
                `Generating... ${elapsedSec}s elapsed, ${kChars}k chars written`);
              lastProgressTime = now;
            }
          }
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.info(`Autonomous stage "${stage}" LLM streaming complete (${elapsed}s, ${fullResponse.length} chars)`);

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
      // Strip markdown code fences from JSON output, then skip any preamble before the JSON object
      const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;
      try {
        const parsed = JSON.parse(jsonContent);
        artifactContent = await injectSprintEstimates(parsed);
      } catch {
        artifactContent = jsonContent;
      }
    } else if (stage === 'tech_refinement' || stage === 'qa_engineer') {
      // Strip markdown code fences, skip any preamble before the JSON object, pretty-print
      const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;
      try {
        artifactContent = JSON.stringify(JSON.parse(jsonContent), null, 2);
      } catch {
        artifactContent = jsonContent;
      }
    } else {
      // Formerly-markdown stages (analyst, pm_prd, solution_architect, gtm_strategy, feature_marketing)
      // now produce JSON. Strip code fences, skip any preamble before {, pretty-print.
      const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;
      try {
        artifactContent = JSON.stringify(JSON.parse(jsonContent), null, 2);
      } catch {
        artifactContent = jsonContent;
      }
    }

    // ── Feature-specific stage: merge with prior backlog ────────────────────────
    const { isFeatureStage, loadPartialBacklog: loadPartialBacklogForMerge } = await import('./feature-decomposition');
    if (isFeatureStage(stage)) {
      // Parse the new backlog output
      const stripped = artifactContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;

      try {
        const newBacklog = JSON.parse(jsonContent);
        const priorBacklog = await loadPartialBacklogForMerge(itemId);

        if (priorBacklog) {
          // Merge: copy stories from new into the cumulative structure
          const prior = JSON.parse(priorBacklog);
          for (let i = 0; i < prior.features.length; i++) {
            if (newBacklog.features[i] && newBacklog.features[i].stories && newBacklog.features[i].stories.length > 0) {
              prior.features[i].stories = newBacklog.features[i].stories;
            }
          }
          artifactContent = await injectSprintEstimates(prior);
        } else {
          // First feature — just apply sprint estimates
          artifactContent = await injectSprintEstimates(newBacklog);
        }
      } catch (err: any) {
        logger.error(`Failed to merge feature backlog for ${stage}: ${err.message}`);
      }
    }

    // Save artifact — ONLY story_decomposition stages save locally (they accumulate across features).
    // All other stages push to their destination immediately:
    //   - Document stages (analyst, pm_prd, solution_architect, gtm_strategy, feature_marketing, prototype) → Azure Wiki
    //   - ADO-backed stages (pm_backlog, epic_feature_planner, qa_engineer, tech_refinement) → local + push to ADO

    // Feature-specific stages (story_decomposition_F1, F2, etc.) use 'backlog' as artifact type
    // QA feature-specific stages (qa_engineer_F1, F2, etc.) use 'qa_tests' as artifact type
    // Tech refinement feature-specific stages (tech_refinement_F1, F2, etc.) use 'backlog' as artifact type
    const isQaFeatureStage = stage.match(/^qa_engineer_F\d+$/);
    const isTechRefinementFeatureStage = stage.match(/^tech_refinement_F\d+$/);
    const artifactType = isFeatureStage(stage) ? 'backlog'
      : isQaFeatureStage ? 'qa_tests'
      : isTechRefinementFeatureStage ? 'backlog'
      : (STAGE_ARTIFACT_TYPE[stage] ?? stage);
    const localOnlyStages = new Set(['story_decomposition']);
    const adoBackedStages = new Set(['pm_backlog', 'epic_feature_planner', 'qa_engineer']);

    let artifactId: number;
    if (localOnlyStages.has(stage) || isFeatureStage(stage) || isQaFeatureStage || isTechRefinementFeatureStage) {
      // Story decomposition, QA, and tech refinement feature stages: local only (accumulate/append)
      artifactId = await saveLocalArtifact(sessionId, stage, artifactContent, itemId, skillVersionId);
    } else if (adoBackedStages.has(stage)) {
      // ADO-backed stages: save locally first, then push to ADO (ADO push happens below)
      artifactId = await saveLocalArtifact(sessionId, stage, artifactContent, itemId, skillVersionId);
    } else {
      // Document stages: save locally; wiki push deferred to checkpoint approval
      artifactId = await saveLocalArtifact(sessionId, stage, artifactContent, itemId, skillVersionId);
    }

    // ── Special handling for solution_architect: extract epic_features_enriched from JSON ──
    if (stage === 'solution_architect') {
      try {
        const parsed = JSON.parse(artifactContent);
        if (parsed.epic_features_enriched) {
          const enrichedJson = JSON.stringify(parsed.epic_features_enriched, null, 2);
          await saveLocalArtifact(sessionId, 'epic_features_enriched', enrichedJson, itemId, skillVersionId);
          logger.info(`Extracted and saved tech-enriched epic/features JSON from architect JSON output`);
        } else {
          logger.warn(`No epic_features_enriched field in architect JSON — story decomposition will use non-enriched features`);
        }
      } catch (err: any) {
        logger.warn(`Failed to parse architect JSON for epic_features_enriched extraction: ${err.message}`);
      }
    }

    // ── Special handling for epic_feature_planner & story_decomposition: strip code fences and pretty-print ──
    if (stage === 'epic_feature_planner' || stage === 'story_decomposition') {
      const stripped = artifactContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;
      try {
        if (stage === 'story_decomposition') {
          // Apply sprint estimation to story_decomposition output (same as pm_backlog)
          const parsed = JSON.parse(jsonContent);
          artifactContent = await injectSprintEstimates(parsed);
        } else {
          // epic_feature_planner: ensure all features have empty stories arrays for frontend compatibility
          const parsed = JSON.parse(jsonContent);
          if (parsed.features && Array.isArray(parsed.features)) {
            parsed.features = parsed.features.map((f: any) => ({
              ...f,
              stories: f.stories ?? [],
            }));
          }
          artifactContent = JSON.stringify(parsed, null, 2);
        }
        // Update the artifact in-place (works for MongoDB, wiki, and disk)
        await updateArtifactContent(artifactId, artifactContent);
        logger.info(`Updated artifact in-place for stage "${stage}"`);

      } catch (err: any) {
        logger.warn(`Failed to parse JSON for ${stage}: ${err.message}`);
      }
    }

    // ADO push for pm_backlog, qa_engineer, and epic_feature_planner happens at checkpoint approval.
    // tech_refinement and story_decomposition_F* just read existing ADO URLs for event metadata.
    let adoUrl: string | null = null;
    if (stage === 'tech_refinement' || stage.match(/^tech_refinement_F\d+$/)) {
      try {
        const epicMapping = db.prepare<[string], { ado_url: string }>(
          `SELECT ado_url FROM ado_work_item_map
           WHERE workflow_id = ? AND ado_type = 'epic' AND local_key = 'epic'
           LIMIT 1`
        ).get(workflowId);
        if (epicMapping) adoUrl = epicMapping.ado_url;
      } catch (err: any) {
        logger.error(`Failed to fetch epic URL for tech_refinement event: ${err.message}`);
      }
    } else if (stage.match(/^story_decomposition_F\d+$/)) {
      try {
        const { appConfig } = require('../config/app-config');
        if (appConfig.integrations.workItems === 'ado') {
          const { parseFeatureStage } = await import('./feature-decomposition');
          const featureIndex = parseFeatureStage(stage);
          if (featureIndex !== null) {
            const featureMapping = db.prepare<[string, string], { ado_url: string }>(
              `SELECT ado_url FROM ado_work_item_map
               WHERE workflow_id = ? AND ado_type = 'feature' AND local_key = ?
               LIMIT 1`
            ).get(workflowId, `F${featureIndex + 1}`);
            if (featureMapping) adoUrl = featureMapping.ado_url;
          }
        }
      } catch (err: any) {
        logger.error(`Failed to get feature URL for ${stage}: ${err.message}`);
      }
    }

    // If this is a revision run, compute and save a diff locally (internal artifact)
    let diffArtifactId: number | null = null;
    if (priorDraftContent) {
      try {
        const stageLabel = STAGE_ARTIFACT_TYPE[stage] ?? stage;
        const diffText = computeRevisionDiff(priorDraftContent, artifactContent, stageLabel);
        const diffDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, stageMap.mode, 'artifacts');
        await fsAsync.mkdir(diffDir, { recursive: true });
        const diffPath = path.join(diffDir, `${Date.now()}-${stage}-diff.md`);
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
    // Map stage names to display labels (including dynamic feature stages)
    let stageLabel = stage;
    if (stage === 'analyst') stageLabel = 'Research';
    else if (stage === 'pm_prd') stageLabel = 'PRD';
    else if (stage === 'epic_feature_planner') stageLabel = 'Epic & Features';
    else if (stage === 'solution_architect') stageLabel = 'Architecture';
    else if (stage === 'prototype') stageLabel = 'Prototype';
    else if (stage === 'pm_backlog') stageLabel = 'Backlog';
    else if (stage === 'gtm_strategy') stageLabel = 'GTM Strategy';
    else if (stage === 'feature_marketing') stageLabel = 'Feature Marketing';
    else if (stage === 'tech_refinement' || stage.match(/^tech_refinement_F\d+$/)) stageLabel = 'Technical Refinement';
    else if (stage === 'qa_engineer' || stage.match(/^qa_engineer_F\d+$/)) stageLabel = 'QA Test Suite';
    else if (stage.match(/^story_decomposition_F\d+$/)) stageLabel = 'Story Decomposition';

    // Wiki push is deferred to checkpoint approval — no wiki URL available at stage execution time
    const isStoryFeatureStage = stage.match(/^story_decomposition_F\d+$/);
    const wikiUrl: string | null = null;

    // ── Inline critic review for specialist stages ────────────────────────────
    // After each specialist produces an artifact, the critic reviews it.
    // If issues are found, auto-revise once. If still unresolved,
    // pause and ask the human for input.
    const specialistStages = new Set(['analyst', 'pm_prd', 'epic_feature_planner', 'solution_architect', 'prototype', 'pm_backlog', 'gtm_strategy', 'feature_marketing', 'qa_engineer']);
    const isSpecialistStage = specialistStages.has(stage) || stage.match(/^(story_decomposition|qa_engineer)_F\d+$/);
    const policies = loadGlobalPolicies();
    const criticEnabled = policies.get('require_critic_review') !== 'false' && policies.get('require_critic_review') !== (false as any);

    // Skip critic when a demo fixture was used — fixture content is pre-approved
    if (isSpecialistStage && criticEnabled && !skipCritic && demoFixture === null) {
      insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} draft complete.`,
        { excerpt, artifact_id: artifactId, ...(wikiUrl ? { wiki_url: wikiUrl } : {}), ...(adoUrl ? { ado_url: adoUrl } : {}) });

      // Brief pause before critic to reduce back-to-back API rate limit pressure
      await demoSleep(8_000);

      insertEvent(workflowId, 'stage_progress', stage, 'Running quality review...');

      // Load reference documents so the critic can cross-check completeness.
      // pm_backlog: needs PRD (FR coverage) + architecture (story scoping)
      // solution_architect: needs PRD (NFR traceability)
      // gtm_strategy: needs PRD (persona/scope consistency)
      // feature_marketing: needs PRD + GTM strategy (copy scope verification)
      let criticReferenceDocuments: string | undefined;
      if (stage === 'tech_refinement') {
        const [backlogContent, prdContent] = await Promise.all([
          loadLatestArtifactContent(itemId, 'backlog'),
          loadLatestArtifactContent(itemId, 'prd'),
        ]);
        const refParts: string[] = [];
        if (backlogContent) refParts.push(`### Original PM Backlog\n\n${backlogContent}`);
        if (prdContent) refParts.push(`### PRD Document\n\n${prdContent}`);
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      } else if (stage === 'pm_backlog' || stage === 'solution_architect' || stage === 'prototype' || stage === 'gtm_strategy') {
        const needsArch = stage === 'pm_backlog' || stage === 'prototype';
        const [prdContent, archContent] = await Promise.all([
          loadLatestArtifactContent(itemId, 'prd'),
          needsArch ? loadLatestArtifactContent(itemId, 'architecture') : Promise.resolve(null),
        ]);
        const refParts: string[] = [];
        if (prdContent) refParts.push(`### PRD Document\n\n${prdContent}`);
        if (archContent) refParts.push(`### Architecture Document\n\n${archContent}`);
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      } else if (stage === 'feature_marketing') {
        const [prdContent, gtmContent] = await Promise.all([
          loadLatestArtifactContent(itemId, 'prd'),
          loadLatestArtifactContent(itemId, 'gtm'),
        ]);
        const refParts: string[] = [];
        if (prdContent) refParts.push(`### PRD Document\n\n${prdContent}`);
        if (gtmContent) refParts.push(`### GTM Strategy\n\n${gtmContent}`);
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      } else if (stage === 'qa_engineer') {
        const [prdContent, backlogContent] = await Promise.all([
          loadLatestArtifactContent(itemId, 'prd'),
          loadLatestArtifactContent(itemId, 'backlog'),
        ]);
        const refParts: string[] = [];
        if (prdContent) refParts.push(`### PRD Document\n\n${prdContent}`);
        if (backlogContent) refParts.push(`### Backlog\n\n${backlogContent}`);
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      }

      let review = await getCritic().review(fullResponse, artifactType, resolveAgentModel('critic'), criticTokenCallback, stage, priorCriticIssues, criticReferenceDocuments);
      insertEvent(workflowId, 'stage_progress', stage, 'Quality review complete. Processing results...');

      // ── Coordinator scope filter ──────────────────────────────────────────
      // If the Critic flagged issues, ask the Coordinator to validate them against
      // the initiative's stated scope. Issues that contradict explicit scope
      // boundaries are filtered out before the revision decision is made.
      if (review.verdict === 'revise' && review.issues.length > 0) {
        insertEvent(workflowId, 'stage_progress', stage, 'Validating review against initiative scope…');
        const filterResult = await getCoordinator().filterCriticIssues(
          workflowId, stage, review.issues, coordinatorFilterTokenCallback
        );
        if (filterResult.filteredCount > 0) {
          const noun = filterResult.filteredCount === 1 ? 'issue' : 'issues';
          insertEvent(workflowId, 'stage_progress', stage,
            `Chief of Staff removed ${filterResult.filteredCount} out-of-scope ${noun}. ${filterResult.reasoning}`);
        }
        review = { ...review, issues: filterResult.validIssues };
        // Re-evaluate verdict with only in-scope issues
        const hasCritical = filterResult.validIssues.some(i => i.severity === 'critical');
        const majorCount = filterResult.validIssues.filter(i => i.severity === 'major').length;
        if (!hasCritical && majorCount < 2) {
          review = { ...review, verdict: 'approve' };
        }
      }

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
        const now = Date.now();
        const checkpointStatusCritic = autoApprove ? 'approved' : 'pending';
        const cpResult = stmts.insertCheckpoint.run(
          workflowId, stage, artifactId, checkpointStatusCritic,
          JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails, auto_approved: autoApprove, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
          checkpointStatusCritic === 'pending' ? getStageRole(stage) : null, now
        );
        if (specialistTokenData) {
          setCheckpointTokenUsage(cpResult.lastInsertRowid as number,
            { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}), ...(priorRunsCost ? { priorRunsCost } : {}) });
        }
        const minorCount = review.issues.filter(i => i.severity === 'minor').length;
        const approveMsg = minorCount > 0
          ? `Quality review passed with ${minorCount} minor note${minorCount > 1 ? 's' : ''} (resolved internally). Approve to proceed.`
          : 'Quality review passed — no issues found. Approve to proceed.';
        insertEvent(workflowId, 'critic_verdict', stage, approveMsg, criticDetails);

        if (autoApprove) {
          logger.info(`Inline critic approved "${stage}" — auto-advancing (demo mode)`);
          workflowOps.advanceStage(workflowId).catch(err => {
            if (err.message?.startsWith('WORKFLOW_COMPLETE')) {
              logger.info(`Workflow ${workflowId} completed after critic auto-approve chain through "${stage}"`);
            } else {
              logger.error(`Auto-advance after critic-approved stage "${stage}" failed: ${err.message}`);
              const now2 = Date.now();
              stmts.updateWorkflowStatus.run('paused_at_checkpoint', now2, workflowId);
            }
          });
        } else {
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
          logger.info(`Inline critic approved "${stage}" for workflow ${workflowId} — paused for human review`);
          const titleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(itemId);
          if (titleRow) notifyCheckpointPending(titleRow.title, stage);
        }
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
          null, now
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

      // Max revisions exhausted
      const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
      const hasQuestions = review.questions && review.questions.length > 0;
      const questionsSummary = hasQuestions
        ? ` Questions: ${review.questions.slice(0, 2).join('; ')}`
        : '';

      const now = Date.now();
      const cpResult2 = stmts.insertCheckpoint.run(
        workflowId, stage, artifactId, autoApprove ? 'approved' : 'pending',
        JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails, auto_approved: autoApprove, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
        autoApprove ? null : getStageRole(stage), now
      );
      if (specialistTokenData) {
        setCheckpointTokenUsage(cpResult2.lastInsertRowid as number,
          { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}) });
      }

      if (autoApprove) {
        insertEvent(workflowId, 'critic_verdict', stage,
          `Quality review noted issues — advancing automatically (demo mode): ${issuesSummary}.`,
          criticDetails);
        logger.info(`Inline critic exhausted revisions for "${stage}" — auto-advancing (demo mode)`);
        workflowOps.advanceStage(workflowId).catch(err => {
          if (!err.message?.startsWith('WORKFLOW_COMPLETE')) {
            logger.error(`Auto-advance after exhausted revisions "${stage}" failed: ${err.message}`);
            const now2 = Date.now();
            stmts.updateWorkflowStatus.run('paused_at_checkpoint', now2, workflowId);
          }
        });
      } else {
        stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
        insertEvent(workflowId, 'critic_verdict', stage,
          `Quality review still has unresolved issues after ${MAX_INLINE_REVISIONS} revision(s): ${issuesSummary}.${questionsSummary} How would you like to proceed?`,
          criticDetails);
        logger.info(`Inline critic exhausted revisions for "${stage}" — pausing for human input`);
      }
      return;
    }

    // ── Mock critic for PRD in demo mode ──────────────────────────────────────
    // Demonstrates the revise → auto-revise → approve flow without any LLM calls.
    if (demoFixture !== null && stage === 'pm_prd') {
      insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} draft complete.`,
        { excerpt, artifact_id: artifactId, ...(wikiUrl ? { wiki_url: wikiUrl } : {}), ...(adoUrl ? { ado_url: adoUrl } : {}) });
      await demoSleep(600);
      insertEvent(workflowId, 'stage_progress', stage, 'Running quality review...');
      await demoSleep(1_800);

      const reviseDetails = {
        critic_verdict: 'revise',
        issue_count: 1,
        critical_issues: 0,
        major_issues: 1,
        issues_summary: '[MAJOR] Counter-metrics table missing — document should include measurable failure thresholds alongside success metrics to enable informed rollback decisions',
        inline_review: true,
        reviewed_stage: stage,
      };
      insertEvent(workflowId, 'critic_verdict', stage,
        'Quality review flagged issues. Auto-revising (attempt 1/1).', reviseDetails);
      await demoSleep(500);
      insertEvent(workflowId, 'stage_progress', stage, 'Auto-revising: addressing quality review feedback...');
      await demoSleep(1_600);
      insertEvent(workflowId, 'stage_progress', stage, 'Running quality review...');
      await demoSleep(1_800);

      const approveDetails = {
        critic_verdict: 'approve',
        issue_count: 0,
        critical_issues: 0,
        major_issues: 0,
        issues_summary: '',
        inline_review: true,
        reviewed_stage: stage,
      };
      const now = Date.now();
      const checkpointStatusMock = autoApprove ? 'approved' : 'pending';
      stmts.insertCheckpoint.run(
        workflowId, stage, artifactId, checkpointStatusMock,
        JSON.stringify({ session_id: sessionId, autonomous: true, critic: approveDetails, auto_approved: autoApprove }),
        checkpointStatusMock === 'pending' ? getStageRole(stage) : null, now
      );
      insertEvent(workflowId, 'critic_verdict', stage,
        'Quality review passed — no issues found. Approve to proceed.', approveDetails);

      if (autoApprove) {
        logger.info(`[DEMO] Mock PRD critic approved — auto-advancing`);
        workflowOps.advanceStage(workflowId).catch(err => {
          if (err.message?.startsWith('WORKFLOW_COMPLETE')) {
            logger.info(`Workflow ${workflowId} completed after demo PRD critic`);
          } else {
            logger.error(`Auto-advance after demo PRD critic failed: ${err.message}`);
            stmts.updateWorkflowStatus.run('paused_at_checkpoint', Date.now(), workflowId);
          }
        });
      } else {
        stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
        const titleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(itemId);
        if (titleRow) notifyCheckpointPending(titleRow.title, stage);
        logger.info(`[DEMO] Mock PRD critic approved — checkpoint pending human review`);
      }
      return;
    }

    // ── Non-critic path (critic disabled or non-specialist stage) ─────────────
    const checkpointStatus = autoApprove ? 'approved' : 'pending';
    const now = Date.now();
    const cpResult3 = stmts.insertCheckpoint.run(
      workflowId, stage, artifactId, checkpointStatus,
      JSON.stringify({ session_id: sessionId, autonomous: true, auto_approved: autoApprove, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
      checkpointStatus === 'pending' ? getStageRole(stage) : null, now
    );
    if (specialistTokenData) {
      setCheckpointTokenUsage(cpResult3.lastInsertRowid as number,
        { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}) });
    }
    insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} complete.`,
      { excerpt, artifact_id: artifactId, ...(wikiUrl ? { wiki_url: wikiUrl } : {}), ...(adoUrl ? { ado_url: adoUrl } : {}) });

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
            getStageRole(stage), now2
          );
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now2, workflowId);
        }
      });
    } else {
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      logger.info(`Autonomous stage "${stage}" complete — checkpoint created, workflow paused`);
    }
  } catch (err: any) {
    // Graceful exit when user cancelled — no error checkpoint needed
    if (err?.name === 'AbortError' || isCancelRequested(workflowId)) {
      logger.info(`Autonomous stage "${stage}" aborted by user cancel`);
    } else {
      logger.error(`Autonomous stage "${stage}" failed: ${err.message}`);
      insertEvent(workflowId, 'error', stage,
        `Stage "${stage}" encountered an error: ${err.message}`,
        { error: err.message });
      // Create a pending checkpoint so the UI doesn't hang forever
      const now = Date.now();
      stmts.insertCheckpoint.run(
        workflowId, stage, null, 'pending',
        JSON.stringify({ error: err.message, autonomous: true }),
        getStageRole(stage), now
      );
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
    }
  } finally {
    _cancelControllers.delete(workflowId);
  }
}

// Register for late-binding (breaks circular dep with advanceStage in workflow-router.ts)
workflowOps.runAutonomousStage = runAutonomousStage;
