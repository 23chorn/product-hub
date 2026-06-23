/**
 * Workflow Stage Runner — autonomous specialist execution.
 *
 * Contains the fire-and-forget background task that runs a specialist agent,
 * streams its output, saves artifacts, runs inline critic review, and creates
 * checkpoints for human review.
 */

import db from '../data/database';
import { sessionManager } from '../session/session-manager';
import { CoordinatorAgent } from './coordinator-agent';
import { CriticAgent } from './critic-agent';
import { ContextCuratorAgent } from './curator-agent';
import { SpecialistAgent } from './specialist-agent';
import { resolveAgentModel, getActiveProvider, type TokenUsage } from '../utils/ai-provider';
import { computeRevisionDiff } from '../utils/revision-diff';
import { summarizeRevisionDiff } from './revision-diff-summary';
import {
  STAGE_SESSION_MAP, STAGE_MAX_OUTPUT_TOKENS, STAGE_ARTIFACT_TYPE,
  STAGE_ARTIFACT_LABEL, STAGE_TOOL_DEFINITIONS, stageProgressHeartbeat, stageProgressReview, stageProgressReviewComplete, stageProgressRevision, stageProgressSection, stageProgressWorking,
} from './stage-metadata';
import {
  saveCriticArtifact, saveDiffArtifact, saveLocalArtifact, loadLatestArtifactContent, syncArtifactToWiki,
} from './artifact-helpers';
import { type ToolDefinition, getRegisteredTools } from './tool-registry';
import { stripJsonFence } from '../utils/json-repair';
import { readProductArea } from './item-metadata';
import { ITEM_CONTEXT_BUILDERS } from './stage-item-context';
import { stripWholeResponseDuplication, cleanStageArtifactJson } from './stage-output-parser';
import { STAGE_ARTIFACT_POSTPROCESSORS } from './stage-artifact-postprocess';
import {
  logger, stmts, insertEvent,
  setCheckpointTokenUsage, loadGlobalPolicies, workflowOps, rolesJson,
  type StageTokenData,
} from './workflow-db';
import { isDemoMode, isDemoWorkflow, getDemoFixture, demoSleep, DEMO_STAGE_DELAY_MS } from '../demo/demo-mode';
import { notifyCheckpointPending } from '../utils/slack-notifier';

// Cancel registry, silent-stage set, and agent singletons live in dedicated
// modules; re-exported here so existing importers of workflow-stage-runner are
// unaffected.
export {
  SILENT_STAGES,
  requestCancel,
  isCancelRequested,
  clearCancelFlag,
} from './workflow-cancel';
import { setCancelController, clearCancelController, isCancelRequested } from './workflow-cancel';
export { getCoordinator, getCritic } from './workflow-agents';
import { getCoordinator, getCritic } from './workflow-agents';
import { runBacklogMerge, runMultiAgentFeatureStage, runMultiAgentFeatureRevision, runMultiAgentFeatureQaRevision } from './feature-stage-runner';

// ── Autonomous stage execution ────────────────────────────────────────────────

// Airtable column that should receive each stage's artifact link. Stages absent here
// have no Airtable link column (their links flow through ADO instead). Used by both the
// fallback push and the post-wiki-sync push below.
const STAGE_AIRTABLE_LINK_FIELD: Record<string, string> = {
  analyst: 'researchBriefLink',
  pm_prd: 'prdLink',
  solution_architect: 'technicalDesignLink',
  figma_design: 'figmaDesignLink',
};

// Short display labels for stage-completion event copy (e.g. "Research draft complete").
// Deliberately terser than STAGE_ARTIFACT_LABEL (which is the full document title) — kept
// separate so event narration stays concise.
const STAGE_EVENT_LABEL: Record<string, string> = {
  analyst: 'Research',
  pm_prd: 'PRD',
  epic_feature_planner: 'Epic & Features',
  solution_architect: 'Architecture',
  prototype: 'Prototype',
  figma_design: 'Figma Design',
};

/**
 * Create the checkpoint representing a completed stage's output, attaching specialist/critic
 * token usage and any figma file link extracted from the artifact. Consolidates checkpoint
 * creation that previously diverged slightly across the critic-approved, critic-exhausted, and
 * non-critic paths — e.g. the figma_design file link was only attached on two of the three.
 */
function createStageCheckpoint(
  workflowId: string,
  stage: string,
  artifactId: number | null,
  artifactContent: string,
  opts: {
    sessionId: string;
    status: 'approved' | 'pending';
    autoApprove: boolean;
    criticDetails?: Record<string, unknown>;
    diffArtifactId?: number | null;
    revisionSummary?: string;
    specialistTokenData: StageTokenData['specialist'] | null;
    criticTokenData?: StageTokenData['critic'] | null;
  }
): number {
  let figmaFileUrl: string | undefined;
  if (stage === 'figma_design') {
    try {
      figmaFileUrl = JSON.parse(stripJsonFence(artifactContent)).figma_file_url || undefined;
    } catch { /* ignore */ }
  }

  const metadata = {
    session_id: opts.sessionId,
    autonomous: true,
    auto_approved: opts.autoApprove,
    ...(opts.criticDetails ? { critic: opts.criticDetails } : {}),
    ...(opts.diffArtifactId ? { diff_artifact_id: opts.diffArtifactId } : {}),
    ...(opts.revisionSummary ? { revision_summary: opts.revisionSummary } : {}),
    ...(figmaFileUrl ? { figma_file_url: figmaFileUrl } : {}),
  };

  const now = Date.now();
  const cpResult = stmts.insertCheckpoint.run(
    workflowId, stage, artifactId, opts.status,
    JSON.stringify(metadata),
    opts.status === 'pending' ? rolesJson(stage) : null, now
  );
  const checkpointId = cpResult.lastInsertRowid as number;
  if (opts.specialistTokenData) {
    setCheckpointTokenUsage(checkpointId,
      { specialist: opts.specialistTokenData, ...(opts.criticTokenData ? { critic: opts.criticTokenData } : {}) });
  }
  return checkpointId;
}

/**
 * Either auto-advance the workflow past the stage just completed, or pause and notify the
 * approvers — the finish-the-stage logic that previously diverged across the critic-approved,
 * critic-exhausted, and non-critic paths. On auto-advance failure, always leaves behind a
 * pending checkpoint carrying the error so a human has something actionable to act on, rather
 * than a workflow paused with no checkpoint at all (a gap two of the three original paths had).
 */
function finishStage(
  workflowId: string,
  itemId: string,
  stage: string,
  autoApprove: boolean,
  logLabel: string,
  revisionRequestedBy?: string
): void {
  if (autoApprove) {
    logger.info(`${logLabel} — auto-advancing (demo mode)`);
    workflowOps.advanceStage(workflowId).catch((err: any) => {
      if (err.message?.startsWith('WORKFLOW_COMPLETE')) {
        logger.info(`Workflow ${workflowId} completed after auto-advance chain through "${stage}"`);
        return;
      }
      logger.error(`Auto-advance after "${stage}" failed: ${err.message}`);
      const now = Date.now();
      stmts.insertCheckpoint.run(
        workflowId, stage, null, 'pending',
        JSON.stringify({ error: `Auto-advance failed: ${err.message}`, autonomous: true }),
        rolesJson(stage), now
      );
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
    });
  } else {
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', Date.now(), workflowId);
    logger.info(`${logLabel} — paused for human review`);
    const titleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(itemId);
    if (titleRow) notifyCheckpointPending(titleRow.title, stage, undefined, revisionRequestedBy);
  }
}

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
  skipCritic?: boolean,
  revisionRequestedBy?: string
): Promise<void> {
  // ── Backlog Merge Stage ──────────────────────────────────────────────────────
  // After all feature stages complete, merge their isolated artifacts into one final backlog.
  // This is a simple concatenation — no LLM call needed, just JSON manipulation.
  if (stage === 'backlog_merge') {
    await runBacklogMerge(sessionId, workflowId, itemId);
    return;
  }

  // ── Multi-Agent Refinement for story_decomposition_F* stages ────────────────
  // Each feature runs a multi-agent collaborative session (platform-filtered participants).
  // When priorDraftContent is set (human revision or critic revision), use the targeted
  // single-agent revision path instead of re-running the full 3-phase pipeline.
  const featureMatch = stage.match(/^story_decomposition_F(\d+)(_qa)?$/);
  if (featureMatch) {
    const featureIndex = parseInt(featureMatch[1], 10) - 1;
    const isQaStage = !!featureMatch[2];
    if (isQaStage) {
      // The QA checkpoint only ever gets a targeted revision (it's never generated on
      // its own — the initial generation always produces stories + QA together via the
      // unsuffixed stage, see runMultiAgentFeatureStage below).
      if (priorDraftContent) {
        await runMultiAgentFeatureQaRevision(sessionId, workflowId, stage, itemId, featureIndex, priorDraftContent, brief);
      } else {
        logger.error(`runAutonomousStage: "${stage}" requires priorDraftContent (QA checkpoints can only be revised, not generated directly)`);
      }
    } else if (priorDraftContent) {
      await runMultiAgentFeatureRevision(sessionId, workflowId, stage, itemId, featureIndex, priorDraftContent, brief);
    } else {
      await runMultiAgentFeatureStage(sessionId, workflowId, stage, itemId, featureIndex);
    }
    return;
  }

  const stageMap = STAGE_SESSION_MAP[stage];
  if (!stageMap) {
    logger.error(`runAutonomousStage: no stage map for "${stage}"`);
    return;
  }

  // Tools advertised to the LLM for this stage, filtered to those with a registered handler.
  let skillTools: ToolDefinition[] = [];
  const stageToolDefs = STAGE_TOOL_DEFINITIONS[stage];
  if (stageToolDefs) {
    const registered = getRegisteredTools();
    skillTools = stageToolDefs.filter(t => registered.includes(t.name));
    const skipped = stageToolDefs.length - skillTools.length;
    if (skipped > 0) {
      logger.warn(`Stage "${stage}": ${skipped} tool(s) skipped — no handler registered`);
    }
    if (skillTools.length > 0) {
      logger.info(`Stage "${stage}": providing tools: ${skillTools.map(t => t.name).join(', ')}`);
    }
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

  const specialistTokenCallback = (usage: TokenUsage) => {
    specialistTokenData = {
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      searchCount: usage.searchCount,
    };
  };
  const criticTokenCallback = (usage: TokenUsage) => {
    criticTokenData = {
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
    };
  };

  logger.info(`Autonomous stage "${stage}" starting (session=${sessionId})`);

  // Bail immediately if a cancel was already requested before this stage started
  if (isCancelRequested(workflowId)) {
    logger.info(`Stage "${stage}" skipped — workflow ${workflowId} was cancelled`);
    return;
  }

  // AbortController lets the user kill the in-flight LLM stream
  const abortController = new AbortController();
  setCancelController(workflowId, abortController);

  try {
    // ── Demo fixture lookup ────────────────────────────────────────────────────
    // Check workflow policy to see if this is a demo workflow (either demo_mode or demo_auto_approve).
    // When demo flag is present, replace the LLM call with a pre-built fixture.
    // isDemoMode() controls UI visibility only — it must not affect real workflow behavior.
    const workflow = stmts.getWorkflow.get(workflowId);
    const policyOverrides: Record<string, string> = workflow?.policy_overrides
      ? JSON.parse(workflow.policy_overrides)
      : {};
    const isDemo = isDemoWorkflow(policyOverrides);

    logger.debug(`Stage "${stage}" demo check — isDemoWorkflow=${isDemo}`, policyOverrides);

    // Admin-only global setting: when on, figma_design still produces the full screens/tokens/notes
    // overview, but never auto-creates or writes to a Figma file — a human pastes their own link instead.
    const figmaBypassPolicy = loadGlobalPolicies().get('figma_bypass_mode');
    const figmaBypass = figmaBypassPolicy === 'true' || figmaBypassPolicy === (true as any);

    let demoFixture: string | null = null;
    if (isDemo) {
      demoFixture = getDemoFixture(stage) ?? null;
      logger.info(`Stage "${stage}" using demo fixture (${demoFixture ? `${demoFixture.length} chars` : 'NOT FOUND'})`);
    }

    const agent = new SpecialistAgent(stageMap.agentType);
    const persona = await agent.loadPersona(stage);

    // Extract the goal from the brief and pin it in the system prompt so the
    // model cannot miss it even when the project context describes a different product.
    const goalMatch = brief.match(/^## Goal\n([\s\S]*?)(?=\n## |\n# |$)/m);
    const goalText = goalMatch ? goalMatch[1].trim() : null;

    // ── Extract productArea from item metadata ───────────────────────────────────
    const productAreaScope = readProductArea(itemId);

    // Helper to add platform scope constraint to item context
    const addPlatformScope = (base: string): string => {
      if (!productAreaScope) return base;
      const scopeText = `\n\n**Platform Scope:** ${productAreaScope}\n- Design and architect ONLY for the platforms this tag implies (e.g., "Web App" → web platform only; "Mobile App" → iOS + Android only)\n- Do NOT design for platforms outside this scope\n- User stories, architecture decisions, and prototypes must be scoped to these platforms only`;
      return base + scopeText;
    };

    // Build item context: for analyst, the goal itself is the primary context.
    // For later stages, inject the previous stage's artifact via a per-stage builder
    // (ITEM_CONTEXT_BUILDERS above). story_decomposition_F*/qa_engineer_F* stages never
    // reach here — see that map's doc comment for why no feature-specific case is needed.
    let itemContext: string | undefined;
    const itemContextBuilder = ITEM_CONTEXT_BUILDERS[stage];
    if (itemContextBuilder) {
      itemContext = await itemContextBuilder({ itemId, workflowId, stage, goalText, addPlatformScope, figmaBypass });
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
            `You are performing a SURGICAL EDIT of the ${artifactLabel} above.${issueLines}\n\n` +
            `Rules — apply strictly:\n` +
            `- Identify the exact field, sentence, or JSON value that each issue refers to.\n` +
            `- Fix ONLY that specific location — leave everything else byte-for-byte identical to your prior draft.\n` +
            `- Do NOT rewrite, reorganise, or "improve" any section adjacent to the problem.\n` +
            `- Do NOT add new sections, remove existing sections, or change headings.\n` +
            `- Do NOT reorder array items or object keys that were not mentioned in the issues.\n` +
            `- Return the complete ${artifactLabel} with every section present — only the flagged locations will differ.`;
          // Wrap JSON artifacts in code fences for the assistant turn
          const formattedDraft = stage === 'prototype'
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
      // Every stage emits a single "working" line (no per-section cycling), so the analyst
      // reads like the PRD stage — "Sage is writing the Research Brief." — rather than stepping
      // through "Writing section 1: Executive Summary…", "section 2: Market Analysis…".
      const delay = DEMO_STAGE_DELAY_MS[stage] ?? 2_000;
      insertEvent(workflowId, 'stage_progress', stage, stageProgressWorking(stage));
      await demoSleep(delay);
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
                  `Generating the prototype screens and file map — ${countStr} so far`);
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
                  stageProgressSection(stage, latestSection, sectionCount));
                lastProgressTime = now;
              }
            }
          }
          // Heartbeat: no progress event fired in the last 12s — prove the stage is alive.
          // Applies to every stage, including prototype (whose file-count tracker can stay
          // silent for a long time while the model writes the JSON preamble).
          if (now - lastProgressTime > 12_000) {
            const elapsedSec = Math.round((now - startTime) / 1000);
            insertEvent(workflowId, 'stage_progress', stage,
              stageProgressHeartbeat(stage, elapsedSec, fullResponse.length));
            lastProgressTime = now;
          }
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.info(`Autonomous stage "${stage}" LLM streaming complete (${elapsed}s, ${fullResponse.length} chars)`);

    fullResponse = stripWholeResponseDuplication(fullResponse, stage);

    // Clean up LLM output before saving
    let artifactContent = cleanStageArtifactJson(stage, fullResponse);

    // ── Analyst stage: enforce the no-fake-citations policy server-side ─────────
    // The model is told not to include references without web search, but that's
    // a prompt instruction, not a guarantee. Strip any references it added anyway
    // whenever this session had no web search capability, and stamp the document
    // with the actual (server-known) flag so the renderer can show an honest
    // disclaimer instead of a references section.
    if (stage === 'analyst') {
      const webSearchEnabled = getActiveProvider() === 'anthropic';
      try {
        const parsed = JSON.parse(artifactContent);
        if (!webSearchEnabled) parsed.references = [];
        parsed.web_search_enabled = webSearchEnabled;
        artifactContent = JSON.stringify(parsed, null, 2);
      } catch {
        logger.warn('Could not parse analyst artifact JSON to enforce web-search citation policy');
      }
    }

    const artifactType = STAGE_ARTIFACT_TYPE[stage] ?? stage;

    const artifactId = await saveLocalArtifact(sessionId, stage, artifactContent, itemId);

    // ── Push artifact link to Airtable (all stages that produce viewable artifacts) ──
    // Airtable should only ever show the permanent link (Azure Wiki / ADO epic) — never
    // a Product Hub in-app URL. tryWikiPush() below pushes the real link once the artifact
    // is approved and synced. This only fires as a fallback when no wiki sync will ever
    // happen for this deployment, so the field isn't left permanently empty.
    const pushArtifactLinkToAirtable = async () => {
      try {
        const { appConfig } = require('../config/app-config');
        if (appConfig.integrations.roadmap !== 'airtable') return;
        if (appConfig.integrations.knowledgeBase === 'azure_wiki') return; // wiki push will supersede this

        const airtableField = STAGE_AIRTABLE_LINK_FIELD[stage];
        if (!airtableField) return; // Stage doesn't have an Airtable column

        const itemRow = db.prepare<[string], { airtable_id: string | null }>(
          'SELECT airtable_id FROM items WHERE id = ?'
        ).get(itemId);
        if (!itemRow?.airtable_id) return;

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const localUrl = `${frontendUrl}/?artifact=${artifactId}`;
        const { pushLinksToAirtable } = await import('./ado-stage-push');
        await pushLinksToAirtable(itemRow.airtable_id, { [airtableField]: localUrl });
        logger.info(`Pushed ${airtableField} to Airtable for stage ${stage}`);
      } catch (err: any) {
        logger.warn(`Failed to push artifact link to Airtable for ${stage}: ${err.message}`);
      }
    };

    // Fire the Airtable push in the background (don't block artifact save)
    pushArtifactLinkToAirtable().catch(() => {});

    // ── Per-stage artifact post-processing (figma annotation, architect enrichment
    // extraction, feature dependency resolution, prototype platform stamping) ──
    // Each processor persists its own change and returns the updated content.
    const postprocessor = STAGE_ARTIFACT_POSTPROCESSORS[stage];
    if (postprocessor) {
      artifactContent = await postprocessor({
        workflowId, itemId, stage, sessionId, artifactId, artifactContent,
        figmaBypass, isDemoFixture: demoFixture !== null,
      });
    }

    // If this is a revision run, compute and save a diff to disk, then summarise it for
    // the reviewer so they can confirm their requested changes were addressed at a glance.
    let diffArtifactId: number | null = null;
    let revisionSummary: string | undefined;
    if (priorDraftContent) {
      try {
        const stageLabel = STAGE_ARTIFACT_TYPE[stage] ?? stage;
        const diffText = computeRevisionDiff(priorDraftContent, artifactContent, stageLabel);
        diffArtifactId = await saveDiffArtifact(itemId, stage, diffText, sessionId);
        if (diffArtifactId) logger.info(`Revision diff saved for stage "${stage}" (artifact ${diffArtifactId})`);
        revisionSummary = await summarizeRevisionDiff({
          stageLabel: STAGE_ARTIFACT_LABEL[stage] ?? stage,
          requestContext: brief,
          diffText,
        }) || undefined;
        if (revisionSummary) logger.info(`Revision summary generated for stage "${stage}"`);
      } catch (err: any) {
        logger.warn(`Failed to compute revision diff/summary for "${stage}": ${err.message}`);
      }
    }

    // Bail out if the workflow was cancelled while this stage's call was in flight.
    // The abort signal doesn't always interrupt an already-resolving stream in time,
    // so without this check a late-arriving "success" would overwrite the cancelled
    // workflow status with 'active'/'paused_at_checkpoint', undoing the stop.
    if (isCancelRequested(workflowId)) {
      logger.info(`Stage "${stage}" result discarded — workflow ${workflowId} was cancelled mid-flight`);
      return;
    }

    // Log stage completion event with excerpt
    const excerpt = fullResponse.slice(0, 200).replace(/\n+/g, ' ').trim();
    // Map stage names to short display labels for event copy
    const stageLabel = STAGE_EVENT_LABEL[stage] ?? stage;

    const isAdoHandledStage = stage === 'epic_feature_planner';
    let wikiUrl: string | null = null;

    const tryWikiPush = async (): Promise<string | null> => {
      // Prototype output is an interactive HTML wireframe — it doesn't render as
      // readable wiki markdown, so there's no point mirroring it to the wiki.
      if (isAdoHandledStage || stage === 'prototype' || !artifactId) return null;
      try {
        const { appConfig } = require('../config/app-config');
        if (appConfig.integrations.knowledgeBase !== 'azure_wiki') return null;
        const url = await syncArtifactToWiki(artifactId);
        insertEvent(workflowId, 'wiki_synced', stage, 'Artifact synced to Azure Wiki', { wiki_url: url });

        // Mirror the link back to Airtable columns, same as epicLink/testPlanLink
        // already do after the ADO-handled stages (ado-stage-push.ts).
        const airtableField = STAGE_AIRTABLE_LINK_FIELD[stage];
        if (airtableField && appConfig.integrations.roadmap === 'airtable') {
          const itemRow = db.prepare<[string], { airtable_id: string | null }>(
            'SELECT airtable_id FROM items WHERE id = ?'
          ).get(itemId);
          if (itemRow?.airtable_id) {
            const { pushLinksToAirtable } = await import('./ado-stage-push');
            pushLinksToAirtable(itemRow.airtable_id, { [airtableField]: url }).catch(() => {});
          }
        }

        return url;
      } catch (err: any) {
        logger.warn(`[WIKI] Push failed for ${stage}: ${err.message}`);
        return null;
      }
    };

    // ── Inline critic review for specialist stages ────────────────────────────
    // After each specialist produces an artifact, the critic reviews it.
    // If issues are found, auto-revise once. If still unresolved,
    // pause and ask the human for input.
    const specialistStages = new Set(['analyst', 'pm_prd', 'epic_feature_planner', 'solution_architect', 'prototype', 'figma_design']);
    const isSpecialistStage = specialistStages.has(stage);
    const policies = loadGlobalPolicies();
    const criticEnabled = policies.get('require_critic_review') !== 'false' && policies.get('require_critic_review') !== (false as any);

    // Skip critic when a demo fixture was used — fixture content is pre-approved
    if (isSpecialistStage && criticEnabled && !skipCritic && demoFixture === null) {
      insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} draft complete.`,
        { excerpt, artifact_id: artifactId, llm_seconds: elapsed, ...(wikiUrl ? { wiki_url: wikiUrl } : {}) });

      // Brief pause before critic to reduce back-to-back API rate limit pressure
      await demoSleep(8_000);

      insertEvent(workflowId, 'stage_progress', stage, stageProgressReview(stage));

      // Load reference documents so the critic can cross-check completeness.
      // story_decomposition: needs PRD (FR coverage) + architecture (story scoping)
      // solution_architect: needs PRD (NFR traceability)
      let criticReferenceDocuments: string | undefined;
      if (stage === 'solution_architect' || stage === 'prototype') {
        const needsArch = stage === 'prototype';
        const [prdContent, archContent] = await Promise.all([
          loadLatestArtifactContent(itemId, 'prd'),
          needsArch ? loadLatestArtifactContent(itemId, 'architecture') : Promise.resolve(null),
        ]);
        const refParts: string[] = [];
        if (prdContent) refParts.push(`### PRD Document\n\n${prdContent}`);
        if (archContent) refParts.push(`### Architecture Document\n\n${archContent}`);
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      }

      let review = await getCritic().review(fullResponse, artifactType, resolveAgentModel('critic'), criticTokenCallback, stage, priorCriticIssues, criticReferenceDocuments);
      insertEvent(workflowId, 'stage_progress', stage, stageProgressReviewComplete(stage));

      // ── Coordinator scope filter ──────────────────────────────────────────
      // If the Critic flagged issues, ask the Coordinator to validate them against
      // the initiative's stated scope. Issues that contradict explicit scope
      // boundaries are filtered out before the revision decision is made.
      if (review.verdict === 'revise' && review.issues.length > 0) {
        insertEvent(workflowId, 'stage_progress', stage, `Validating the review against the scope for ${STAGE_ARTIFACT_LABEL[stage] ?? stage}…`);
        const filterResult = await getCoordinator().filterCriticIssues(
          workflowId, stage, review.issues
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
        wikiUrl = await tryWikiPush();
        const checkpointStatusCritic: 'approved' | 'pending' = autoApprove ? 'approved' : 'pending';
        createStageCheckpoint(workflowId, stage, artifactId, artifactContent, {
          sessionId, status: checkpointStatusCritic, autoApprove, criticDetails,
          diffArtifactId, revisionSummary, specialistTokenData, criticTokenData,
        });
        const minorCount = review.issues.filter(i => i.severity === 'minor').length;
        const approveMsg = minorCount > 0
          ? `Quality review passed with ${minorCount} minor note${minorCount > 1 ? 's' : ''} (resolved internally). Approve to proceed.`
          : 'Quality review passed — no issues found. Approve to proceed.';
        insertEvent(workflowId, 'critic_verdict', stage, approveMsg, criticDetails);

        finishStage(workflowId, itemId, stage, autoApprove, `Inline critic approved "${stage}" for workflow ${workflowId}`);
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
        runAutonomousStage(newSession.id, workflowId, stage, itemId, revisedBrief, autoApprove, priorIssuesForRevision, fullResponse)
          .catch(err => logger.error(`Inline revision for "${stage}" failed: ${err.message}`));
        return;
      }

      // Max revisions exhausted
      const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
      const hasQuestions = review.questions && review.questions.length > 0;
      const questionsSummary = hasQuestions
        ? ` Questions: ${review.questions.slice(0, 2).join('; ')}`
        : '';

      wikiUrl = await tryWikiPush();
      createStageCheckpoint(workflowId, stage, artifactId, artifactContent, {
        sessionId, status: autoApprove ? 'approved' : 'pending', autoApprove, criticDetails,
        diffArtifactId, revisionSummary, specialistTokenData, criticTokenData,
      });

      if (autoApprove) {
        insertEvent(workflowId, 'critic_verdict', stage,
          `Quality review noted issues — advancing automatically (demo mode): ${issuesSummary}.`,
          criticDetails);
      } else {
        insertEvent(workflowId, 'critic_verdict', stage,
          `Quality review still has unresolved issues after ${MAX_INLINE_REVISIONS} revision(s): ${issuesSummary}.${questionsSummary} How would you like to proceed?`,
          criticDetails);
      }
      finishStage(workflowId, itemId, stage, autoApprove, `Inline critic exhausted revisions for "${stage}"`);
      return;
    }

    // ── Mock critic for PRD in demo mode ──────────────────────────────────────
    // Demonstrates the revise → auto-revise → approve flow without any LLM calls.
    if (demoFixture !== null && stage === 'pm_prd') {
      insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} draft complete.`,
        { excerpt, artifact_id: artifactId, llm_seconds: elapsed, ...(wikiUrl ? { wiki_url: wikiUrl } : {}) });
      await demoSleep(600);
      insertEvent(workflowId, 'stage_progress', stage, stageProgressReview(stage));
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
      insertEvent(workflowId, 'stage_progress', stage, stageProgressRevision(stage));
      await demoSleep(1_600);
      insertEvent(workflowId, 'stage_progress', stage, stageProgressReview(stage));
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
      wikiUrl = await tryWikiPush();
      createStageCheckpoint(workflowId, stage, artifactId, artifactContent, {
        sessionId, status: autoApprove ? 'approved' : 'pending', autoApprove, criticDetails: approveDetails,
        diffArtifactId, revisionSummary, specialistTokenData, criticTokenData,
      });
      insertEvent(workflowId, 'critic_verdict', stage,
        'Quality review passed — no issues found. Approve to proceed.', approveDetails);

      finishStage(workflowId, itemId, stage, autoApprove, '[DEMO] Mock PRD critic approved');
      return;
    }

    // ── Non-critic path (critic disabled or non-specialist stage) ─────────────
    wikiUrl = await tryWikiPush();
    createStageCheckpoint(workflowId, stage, artifactId, artifactContent, {
      sessionId, status: autoApprove ? 'approved' : 'pending', autoApprove,
      diffArtifactId, revisionSummary, specialistTokenData, criticTokenData,
    });
    // wiki_url is deliberately omitted here — tryWikiPush() above already inserted a
    // separate 'wiki_synced' event with the same link, so including it again would
    // render a duplicate link line in the chat narration (eventToMessage).
    insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} complete.`,
      { excerpt, artifact_id: artifactId, llm_seconds: elapsed });

    finishStage(workflowId, itemId, stage, autoApprove, `Autonomous stage "${stage}" complete`, revisionRequestedBy);
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
        rolesJson(stage), now
      );
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
    }
  } finally {
    clearCancelController(workflowId);
  }
}

// Register for late-binding (breaks circular dep with advanceStage in workflow-router.ts)
workflowOps.runAutonomousStage = runAutonomousStage;
