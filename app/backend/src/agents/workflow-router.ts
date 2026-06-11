/**
 * Workflow Router — stage machine core.
 *
 * Manages state transitions for coordinator-driven workflows.
 * A workflow has a stage_sequence JSON array (e.g. ["analyst","pm_prd","pm_backlog","curator"]).
 * The router advances through the sequence, creating specialist sessions and checkpoints.
 *
 * Sub-modules:
 *   workflow-db.ts           — shared types, prepared statements, helpers
 *   workflow-stage-runner.ts — autonomous specialist execution (runAutonomousStage)
 *   workflow-mutations.ts    — post-completion mutations (feedback, reiterate, extend, retry)
 */

import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import db, { getPolicies } from '../data/database';
import { sessionManager } from '../session/session-manager';
import { streamAI, resolveModelId, resolveAgentModel, type TokenUsage } from '../utils/ai-provider';
import type { AppMode, AgentType } from '@pap/shared';
import {
  STAGE_SESSION_MAP, STAGE_MAX_OUTPUT_TOKENS, STAGE_ARTIFACT_TYPE,
  STAGE_ARTIFACT_LABEL, STAGE_LABELS_INTERNAL,
} from './stage-metadata';
import {
  saveCriticArtifact, loadLatestArtifactForItem,
} from './artifact-helpers';
import { deleteWorkflow as deleteWorkflowImpl, recoverStaleWorkflows as recoverStaleWorkflowsImpl, startStaleRecoveryTimer } from './workflow-lifecycle';
import { isDemoMode, demoSleep, DEMO_STAGE_DELAY_MS } from '../demo/demo-mode';
import { notifyWorkflowComplete } from '../utils/slack-notifier';
import { WorkflowRow, CheckpointRow, WorkflowStatus, WorkflowEvent, StageTokenData } from './workflow-types';
export type { WorkflowRow, CheckpointRow, WorkflowStatus, WorkflowEvent, StageTokenData } from './workflow-types';
export { propagateFeedback, reiterateFromStage, extendWorkflow, retryCurrentStage, restartWorkflow } from './workflow-mutations';
export { deleteWorkflow } from './workflow-lifecycle';
import Logger from '../utils/logger';
import { CoordinatorAgent } from './coordinator-agent';
import { CriticAgent } from './critic-agent';
import { ContextCuratorAgent } from './curator-agent';
import { runTechRefinementStage } from './tech-refinement-agent';
import { workflowOps } from './workflow-db';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

const logger = new Logger('WORKFLOW-ROUTER');

/**
 * Stages that run silently with no human review gate.
 * Currently empty — every stage pauses for human approval.
 * To skip human review on a stage, add it here (e.g. new Set(['pm_prd'])).
 */
const SILENT_STAGES = new Set<string>([]);

/**
 * Default model overrides per stage.
 * Analyst gets a more capable model for better factual accuracy and source quality.
 * Later stages can use faster/cheaper models since they work from prior artifacts.
 * Set a key to '' (empty string) to fall back to the user-selected / provider default.
 *
 * Can also be overridden per-workflow via policy_overrides:
 *   { "model:analyst": "claude-opus-4-6", "model:pm_prd": "claude-sonnet-4-6" }
 */
// Lazy singletons — avoids reading persona files at import time
let _coordinator: CoordinatorAgent | null = null;
function getCoordinator(): CoordinatorAgent {
  if (!_coordinator) _coordinator = new CoordinatorAgent();
  return _coordinator;
}

let _critic: CriticAgent | null = null;
function getCritic(): CriticAgent {
  if (!_critic) _critic = new CriticAgent();
  return _critic;
}

let _curator: ContextCuratorAgent | null = null;
function getCurator(): ContextCuratorAgent {
  if (!_curator) _curator = new ContextCuratorAgent();
  return _curator;
}

// ── Policy helpers ─────────────────────────────────────────────────────────────

function loadGlobalPolicies(): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of getPolicies('global')) {
    try {
      // rule_value is a JSON string — unwrap to get the plain value
      map.set(p.rule_key, JSON.parse(p.rule_value));
    } catch {
      map.set(p.rule_key, p.rule_value);
    }
  }
  return map;
}

// ── Prepared statements ────────────────────────────────────────────────────────

const stmts = {
  getWorkflow: db.prepare<[string], WorkflowRow>(
    'SELECT * FROM workflows WHERE id = ?'
  ),
  insertWorkflow: db.prepare(`
    INSERT INTO workflows (id, item_id, goal, status, current_stage, stage_sequence, policy_overrides, created_at, updated_at)
    VALUES (?, ?, ?, 'active', NULL, ?, ?, ?, ?)
  `),
  updateWorkflowSummary: db.prepare(`
    UPDATE workflows SET summary = ?, updated_at = ? WHERE id = ?
  `),
  updateWorkflowStage: db.prepare(`
    UPDATE workflows SET current_stage = ?, status = 'active', updated_at = ? WHERE id = ?
  `),
  updateWorkflowStatus: db.prepare(`
    UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?
  `),
  updateWorkflowStageAndStatus: db.prepare(`
    UPDATE workflows SET current_stage = ?, status = ?, updated_at = ? WHERE id = ?
  `),
  insertCheckpoint: db.prepare(`
    INSERT INTO checkpoints (workflow_id, stage, artifact_id, status, human_feedback, coordinator_action, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `),
  getCheckpoint: db.prepare<[number], CheckpointRow>(
    'SELECT * FROM checkpoints WHERE id = ?'
  ),
  updateCheckpoint: db.prepare(`
    UPDATE checkpoints SET status = ?, human_feedback = ?, coordinator_action = ?, resolved_at = ? WHERE id = ?
  `),
  getCheckpointsByWorkflow: db.prepare<[string], CheckpointRow>(
    'SELECT * FROM checkpoints WHERE workflow_id = ? ORDER BY created_at ASC'
  ),
  getPendingCheckpointForStage: db.prepare<[string, string], { id: number }>(`
    SELECT id FROM checkpoints WHERE workflow_id = ? AND stage = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `),
  getLatestSessionForItemMode: db.prepare<[string, string], { id: string }>(`
    SELECT s.id FROM sessions s
    WHERE s.item_id = ? AND s.mode = ?
    ORDER BY s.created_at DESC LIMIT 1
  `),
};

// ── Workflow event logging ────────────────────────────────────────────────────

const eventStmts = {
  insertEvent: db.prepare(`
    INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getEventsSince: db.prepare<[string, number], WorkflowEvent>(`
    SELECT * FROM workflow_events WHERE workflow_id = ? AND id > ? ORDER BY id ASC
  `),
  getAllEvents: db.prepare<[string], WorkflowEvent>(
    'SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY id ASC'
  ),
};

function insertEvent(
  workflowId: string,
  eventType: string,
  stage: string | null,
  summary: string,
  details?: Record<string, unknown>
): number {
  const result = eventStmts.insertEvent.run(
    workflowId, eventType, stage, summary,
    details ? JSON.stringify(details) : null,
    Date.now()
  );
  return result.lastInsertRowid as number;
}

/**
 * Atomically add an estimated cost (USD) to a workflow's running total.
 */
function addWorkflowCost(workflowId: string, cost: number): void {
  if (cost <= 0) return;
  db.prepare(`UPDATE workflows SET estimated_cost = estimated_cost + ? WHERE id = ?`).run(cost, workflowId);
}

/** Build an onTokens callback that accumulates cost on a workflow. */
export function costTracker(workflowId: string): (usage: TokenUsage) => void {
  return (usage) => addWorkflowCost(workflowId, usage.estimatedCost);
}

/** Write token usage JSON to a checkpoint row. */
function setCheckpointTokenUsage(checkpointRowId: number, data: StageTokenData): void {
  db.prepare('UPDATE checkpoints SET token_usage = ? WHERE id = ?')
    .run(JSON.stringify(data), checkpointRowId);
}

export function getWorkflowEvents(workflowId: string, sinceId?: number): WorkflowEvent[] {
  if (sinceId !== undefined && sinceId > 0) {
    return eventStmts.getEventsSince.all(workflowId, sinceId);
  }
  return eventStmts.getAllEvents.all(workflowId);
}

/**
 * Create a new workflow for an item.
 * Applies stage-skip policies at creation time.
 */
export function createWorkflow(
  itemId: string,
  goal: string,
  stageSequence: string[],
  policyOverrides?: Record<string, string>
): import('./workflow-db').WorkflowRow {
  const policies = loadGlobalPolicies();

  let sequence = [...stageSequence];

  const requireCritic = policies.get('require_critic_review');
  if (requireCritic === 'false' || requireCritic === false as any) {
    const before = sequence.length;
    sequence = sequence.filter(s => s !== 'critic');
    if (sequence.length < before) {
      logger.info('[POLICY] require_critic_review=false — removed critic from stage sequence');
    }
  }

  const id = uuidv4();
  const now = Date.now();

  stmts.insertWorkflow.run(
    id, itemId, goal,
    JSON.stringify(sequence),
    JSON.stringify(policyOverrides ?? {}),
    now, now
  );

  const workflow = stmts.getWorkflow.get(id)!;
  logger.info(`Created workflow ${id} (item=${itemId}) stages: ${sequence.join(' → ')}`);

  // Fire-and-forget: generate a brief summary name in the background.
  // Delay 30s to avoid competing with the first stage's LLM calls for rate limits.
  setTimeout(() => {
    generateWorkflowSummary(id, goal).catch(err =>
      logger.warn(`Failed to generate workflow summary: ${err.message}`)
    );
  }, 30_000);

  return workflow;
}

/**
 * Generate a brief summary name for a workflow via LLM.
 * Runs fire-and-forget after workflow creation — updates the DB row when done.
 */
async function generateWorkflowSummary(workflowId: string, goal: string): Promise<void> {
  const model = resolveModelId(undefined);
  const system = 'You generate concise workflow titles. Respond with ONLY the title — no quotes, no punctuation at the end, no explanation.';
  const userMsg = `Generate a brief summary name (4-8 words) for this product workflow goal. The name should capture the core intent, like a project name a team would use.\n\nGoal:\n${goal.split('\n\n[Coordinator context]')[0].slice(0, 500)}`;

  let summary = '';
  for await (const chunk of streamAI(model, system, [{ role: 'user', content: userMsg }], 60)) {
    summary += chunk;
  }

  summary = summary.trim().replace(/^["']|["']$/g, '').replace(/\.+$/, '');
  if (summary.length > 0 && summary.length <= 100) {
    stmts.updateWorkflowSummary.run(summary, Date.now(), workflowId);
    logger.info(`Workflow ${workflowId} summary: "${summary}"`);
  }
}

// ── Core stage advancement ────────────────────────────────────────────────────

/**
 * Advance a workflow to the next stage in its sequence.
 *
 * - For regular stages (analyst, pm_prd, pm_backlog): creates a specialist session
 *   and pauses at a checkpoint for human review (unless auto-approve policy is set).
 * - For 'critic' stage: runs CriticAgent automatically; stores verdict in checkpoint;
 *   returns sessionId = null (no interactive session needed).
 * - For 'curator' stage: runs ContextCuratorAgent automatically; stores context_diffs;
 *   auto-completes — throws WORKFLOW_COMPLETE after storing diffs.
 *
 * Returns { stage, sessionId } or throws WORKFLOW_COMPLETE when all stages done.
 */
export async function advanceStage(workflowId: string): Promise<{ stage: string; sessionId: string | null }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status === 'complete') throw new Error(`Workflow ${workflowId} is already complete`);
  if (workflow.status === 'paused_at_checkpoint') {
    throw new Error(`Workflow ${workflowId} is paused at a checkpoint — resolve it before advancing`);
  }

  // Check if there's an active change request — if so, use its stage sequence
  const activeCR = db.prepare<[string], { impact_assessment: string | null }>(
    `SELECT impact_assessment FROM change_requests WHERE workflow_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`
  ).get(workflowId);

  let sequence: string[];
  if (activeCR?.impact_assessment) {
    const assessment = JSON.parse(activeCR.impact_assessment);
    sequence = assessment.cr_stage_sequence ?? JSON.parse(workflow.stage_sequence);
  } else {
    sequence = JSON.parse(workflow.stage_sequence);
  }

  if (sequence.length === 0) throw new Error(`Workflow ${workflowId} has no stages defined`);

  const currentIndex = workflow.current_stage !== null
    ? sequence.indexOf(workflow.current_stage)
    : -1;
  const nextIndex = currentIndex + 1;

  if (nextIndex >= sequence.length) {
    const now = Date.now();
    stmts.updateWorkflowStageAndStatus.run(
      workflow.current_stage, 'complete', now, workflowId
    );
    insertEvent(workflowId, 'workflow_complete', null, 'All stages complete. Your outputs are ready for review.');
    logger.info(`Workflow ${workflowId} complete — all ${sequence.length} stages done`);
    const titleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(workflow.item_id);
    if (titleRow) notifyWorkflowComplete(titleRow.title);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  const nextStage = sequence[nextIndex];
  const now = Date.now();

  // Move to next stage
  stmts.updateWorkflowStage.run(nextStage, now, workflowId);

  // ── Critic stage: automated single-shot review ────────────────────────────
  if (nextStage === 'critic') {
    insertEvent(workflowId, 'stage_started', 'critic', 'Running quality review...');

    const { content: artifactContent, type: artifactType } = loadLatestArtifactForItem(workflow.item_id);
    const review = await getCritic().review(artifactContent, artifactType, resolveAgentModel('critic'), costTracker(workflowId), workflow.current_stage ?? undefined);

    // Save full critic review as artifact .md file
    const criticArtifactId = await saveCriticArtifact(workflow.item_id, 'critic', review.fullText);

    const criticDetails = {
      critic_verdict: review.verdict,
      issue_count: review.issues.length,
      critical_issues: review.issues.filter(i => i.severity === 'critical').length,
      major_issues:    review.issues.filter(i => i.severity === 'major').length,
      questions:       review.questions.slice(0, 3),
      issues_summary:  review.issues.slice(0, 5).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; '),
      auto_reviewed:   true,
      critic_artifact_id: criticArtifactId,
    };
    const coordinatorAction = JSON.stringify(criticDetails);

    // Check auto_approve_critic policy
    const policies = loadGlobalPolicies();
    const autoApproveCritic = policies.get('auto_approve_critic') === 'true' || policies.get('auto_approve_critic') === true as any;

    if (autoApproveCritic && review.verdict === 'approve') {
      // Auto-approve: no human gate needed
      stmts.insertCheckpoint.run(workflowId, nextStage, null, 'approved', coordinatorAction, now);
      insertEvent(workflowId, 'critic_verdict', 'critic',
        'Quality review passed — no issues found. Auto-approved.',
        criticDetails);
      logger.info(`Critic auto-approved for workflow ${workflowId}`);

      // Continue to next stage
      return advanceStage(workflowId);
    }

    if (autoApproveCritic && review.verdict === 'revise') {
      // Auto-revise: roll back and rerun with critic feedback (max 2 retries)
      const revisionCount = (review as any)._revisionCount ?? 0;
      if (revisionCount < 2) {
        stmts.insertCheckpoint.run(workflowId, nextStage, null, 'revised', coordinatorAction, now);
        insertEvent(workflowId, 'critic_verdict', 'critic',
          `Quality review flagged issues. Auto-revising (attempt ${revisionCount + 1}/2).`,
          criticDetails);

        // Roll back to the stage before critic and rerun
        const criticIdx = sequence.indexOf('critic');
        const prevStage = criticIdx > 0 ? sequence[criticIdx - 1] : null;
        stmts.updateWorkflowStageAndStatus.run(prevStage, 'active', now, workflowId);

        // Propagate critic feedback as a revision
        const feedbackText = review.issues.map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('\n');
        const brief = await getCoordinator().generateStageBrief(workflowId, prevStage!, feedbackText);
        const stageMap = STAGE_SESSION_MAP[prevStage!] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
        const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
        sessionManager.updateWorkflow(session.id, workflowId, brief);

        workflowOps.runAutonomousStage(session.id, workflowId, prevStage!, workflow.item_id, brief, true)
          .catch(err => logger.error(`Auto-revision after critic failed: ${err.message}`));

        logger.info(`Critic auto-revise for workflow ${workflowId} — rerunning ${prevStage}`);
        return { stage: nextStage, sessionId: null };
      }
      // Max retries exceeded — fall through to human gate
    }

    // Default: pause at checkpoint for human review
    stmts.insertCheckpoint.run(workflowId, nextStage, null, 'pending', coordinatorAction, now);
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

    if (review.verdict === 'approve') {
      insertEvent(workflowId, 'critic_verdict', 'critic',
        'Quality review passed — no issues found. Approve to proceed.',
        criticDetails);
    } else {
      const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
      insertEvent(workflowId, 'critic_verdict', 'critic',
        `Quality review flagged issues: ${issuesSummary}. How would you like to proceed?`,
        criticDetails);
    }

    logger.info(`Critic completed for workflow ${workflowId} — verdict: ${review.verdict}`);
    return { stage: nextStage, sessionId: null };
  }

  // ── Curator stage: automated curation, auto-completes workflow ────────────
  if (nextStage === 'curator') {
    insertEvent(workflowId, 'stage_started', 'curator', 'Updating project context files...');

    let curatorTokenData: import('./workflow-db').StageTokenData['specialist'] | null = null;
    const curatorTokenCallback = (usage: TokenUsage) => {
      curatorTokenData = {
        model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
        searchCount: 0, estimatedCost: usage.estimatedCost,
      };
      addWorkflowCost(workflowId, usage.estimatedCost);
    };

    let diffCount: number;
    let reasoning: string | null;

    const workflowPolicies = JSON.parse(workflow.policy_overrides ?? '{}');
    const isDemoWorkflow = isDemoMode() || workflowPolicies.demo_auto_approve === 'true';

    if (isDemoWorkflow) {
      await demoSleep(DEMO_STAGE_DELAY_MS['curator'] ?? 1500);
      diffCount = 3;
      const fixtureTheme = process.env.DEMO_FIXTURE_THEME ?? 'price-alerts';
      reasoning = fixtureTheme === 'messaging'
        ? `## Curator review — In-App Messaging & Trade Chat

Reviewed all stage outputs against the existing context files. Proposing 3 targeted updates:

**company.md** — Add the In-App Messaging feature to the Active Features section. The architecture confirms a new Message Service (Node.js), Cassandra message store, and Redis Pub/Sub fan-out layer are now part of the production stack.

**strategy.md** — Update the retention strategy section to reference Chat as a social engagement mechanism. Per GTM strategy: target 25% of MAU using Chat within 90 days; 30-day retention lift of +15% for Chat users vs non-Chat. Note the regulatory constraint: all messages retained 7 years for MiFID II compliance.

**current-state.md** — Add the Message Service, Cassandra cluster, Redis cluster, Moderation Service, and S3 archive pipeline to the architecture overview. These are new production components introduced in this feature.

No changes needed to tech-stack.md or process.md — those remain accurate as written.`
        : `## Curator review — Price Alerts & Watchlist

Reviewed all stage outputs against the existing context files. Proposing 3 targeted updates:

**company.md** — Add the Price Alerts feature to the Active Features section. The PRD confirms push notification infrastructure (Firebase FCM) is now part of the production stack.

**strategy.md** — Update the retention strategy section to reference price alerts as a re-engagement mechanism for dormant users (per GTM strategy: 8% reactivation target). Also note the regulatory constraint: notification copy must not imply investment advice (DFSA requirement).

**current-state.md** — Add the Alert Evaluator microservice and Redis Streams alert queue to the architecture overview. These are new production components introduced in this feature.

No changes needed to tech-stack.md or process.md — those remain accurate as written.`;
    } else {
      const result = await getCurator().runCuration(workflowId, resolveAgentModel('curator'), curatorTokenCallback);
      diffCount = result.diffCount;
      reasoning = result.reasoning;
    }

    // Log the curator's reasoning so the user can review it
    if (reasoning) {
      insertEvent(workflowId, 'curator_reasoning', 'curator',
        reasoning.length > 300 ? reasoning.slice(0, 297) + '...' : reasoning,
        { full_reasoning: reasoning });
    }

    const curatorCpResult = stmts.insertCheckpoint.run(
      workflowId, nextStage, null, 'approved',
      JSON.stringify({ auto_approved: true, context_diffs_proposed: diffCount }),
      now
    );
    if (curatorTokenData) {
      setCheckpointTokenUsage(curatorCpResult.lastInsertRowid as number,
        { specialist: curatorTokenData! });
    }

    insertEvent(workflowId, 'stage_completed', 'curator',
      diffCount > 0
        ? `Context curation complete — ${diffCount} update${diffCount !== 1 ? 's' : ''} proposed.`
        : 'Context curation complete — no updates needed.',
      { context_diffs_proposed: diffCount });

    stmts.updateWorkflowStageAndStatus.run(nextStage, 'complete', now, workflowId);

    insertEvent(workflowId, 'workflow_complete', null,
      'All stages complete. Your outputs are ready for review.');

    logger.info(`Curator completed for workflow ${workflowId} — ${diffCount} diff(s) proposed, workflow complete`);
    const curatorTitleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(workflow.item_id);
    if (curatorTitleRow) notifyWorkflowComplete(curatorTitleRow.title);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  // Compute auto-approve once — used by tech_refinement and regular stages below.
  const _wfPolicyOverrides: Record<string, string> = workflow.policy_overrides
    ? JSON.parse(workflow.policy_overrides)
    : {};
  const _isDemoAutoApprove = _wfPolicyOverrides['demo_auto_approve'] === 'true';

  // ── Tech Refinement stage: parallel engineering stream review ────────────
  if (nextStage === 'tech_refinement') {
    const techAutoApprove = SILENT_STAGES.has('tech_refinement') || _isDemoAutoApprove;
    insertEvent(workflowId, 'stage_started', 'tech_refinement',
      'Finn (iOS), Remi (Android), and Cole (Backend) are reviewing the backlog in parallel. Each engineer will annotate every story with platform-specific implementation notes.');

    runTechRefinementStage(workflowId, workflow.item_id, techAutoApprove).catch((err: Error) => {
      logger.error(`Tech refinement background task failed: ${err.message}`);
    });

    return { stage: nextStage, sessionId: null };
  }

  // ── Regular specialist stage: run autonomously in the background ─────────
  const STAGE_NARRATION: Record<string, string> = {
    analyst:            'Sage is starting market research. This stage uses web search and typically takes 2–4 minutes.',
    pm_prd:             'Rex is writing the Product Requirements Document based on the research brief.',
    solution_architect: 'Atlas is designing the solution architecture based on the PRD.',
    prototype:          'Nova is generating an interactive prototype from the workflow artifacts. This typically takes 2–3 minutes.',
    pm_backlog:         'Pip is creating the backlog with epics, features, and stories.',
    gtm_strategy:       'Quinn is developing the Go-to-Market strategy based on the approved PRD.',
    feature_marketing:  'Milo is writing the feature marketing content pack based on the GTM strategy and PRD.',
  };
  insertEvent(workflowId, 'stage_started', nextStage,
    STAGE_NARRATION[nextStage] ?? `Starting ${nextStage}...`);

  const stageMap = STAGE_SESSION_MAP[nextStage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  logger.info(`Created ${stageMap.mode} session ${session.id} for stage "${nextStage}"`);

  insertEvent(workflowId, 'stage_progress', nextStage, 'Coordinator is briefing the specialist...');
  const brief = isDemoMode()
    ? `## Goal\nDemo mode — running with fixture data.\n\n## Output required\nSee fixture.`
    : await getCoordinator().generateStageBrief(workflowId, nextStage);
  sessionManager.updateWorkflow(session.id, workflowId, brief);
  insertEvent(workflowId, 'stage_progress', nextStage, 'Brief received. Specialist is working...');

  const shouldAutoApprove = SILENT_STAGES.has(nextStage) || _isDemoAutoApprove;

  // Fire the autonomous specialist run as a background task.
  // It will collect the full output, store an artifact, then create the checkpoint.
  workflowOps.runAutonomousStage(session.id, workflowId, nextStage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => {
      logger.error(`Autonomous stage "${nextStage}" background task failed: ${err.message}`);
      // Safety net: if runAutonomousStage's inner try/catch didn't create a checkpoint,
      // create one here so the workflow doesn't get stuck in 'active' forever.
      try {
        const wf = stmts.getWorkflow.get(workflowId);
        if (wf && wf.status === 'active') {
          const now = Date.now();
          insertEvent(workflowId, 'error', nextStage,
            `Stage "${nextStage}" failed unexpectedly: ${err.message}`,
            { error: err.message });
          stmts.insertCheckpoint.run(
            workflowId, nextStage, null, 'pending',
            JSON.stringify({ error: err.message, autonomous: true, safety_net: true }),
            now
          );
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
          logger.info(`Safety net: created error checkpoint for stuck workflow ${workflowId}`);
        }
      } catch (inner) {
        logger.error(`Safety net checkpoint creation also failed: ${(inner as Error).message}`);
      }
    });

  return { stage: nextStage, sessionId: null };
}

// Register advanceStage for late-binding (breaks circular dep with runAutonomousStage)
workflowOps.advanceStage = advanceStage;

// ── Checkpoint management ─────────────────────────────────────────────────────

/**
 * Explicitly complete the current stage, creating a pending checkpoint.
 * Called when the user decides the specialist's output is ready for review.
 * Sets workflow status to 'paused_at_checkpoint'.
 */
export function completeStage(workflowId: string): void {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (!workflow.current_stage) throw new Error(`Workflow ${workflowId} has no current stage`);
  if (workflow.status !== 'active') {
    throw new Error(`Workflow ${workflowId} is not active (status: ${workflow.status})`);
  }

  const now = Date.now();

  // Attempt to find the latest artifact for the item to attach to the checkpoint
  const artifactRow = db.prepare<[string], { id: number }>(`
    SELECT a.id FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? ORDER BY a.created_at DESC LIMIT 1
  `).get(workflow.item_id);

  // Find the specialist session for this stage
  const stageMap = STAGE_SESSION_MAP[workflow.current_stage];
  let sessionId: string | null = null;
  if (stageMap) {
    const row = stmts.getLatestSessionForItemMode.get(workflow.item_id, stageMap.mode);
    sessionId = row?.id ?? null;
  }

  stmts.insertCheckpoint.run(
    workflowId,
    workflow.current_stage,
    artifactRow?.id ?? null,
    'pending',
    sessionId ? JSON.stringify({ session_id: sessionId }) : null,
    now
  );
  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  logger.info(`Stage "${workflow.current_stage}" submitted for review — workflow ${workflowId} paused at checkpoint`);
}

/**
 * Force a workflow's status to 'complete' (e.g. after a rejection decision).
 */
export function markWorkflowComplete(workflowId: string): void {
  stmts.updateWorkflowStatus.run('complete', Date.now(), workflowId);
  insertEvent(workflowId, 'workflow_complete', null, 'Workflow ended.');
  const wf = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
  if (wf) {
    const titleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(wf.item_id);
    if (titleRow) notifyWorkflowComplete(titleRow.title);
  }
  logger.info(`Workflow ${workflowId} marked complete`);
}

/**
 * Pause a workflow at a checkpoint, waiting for human review.
 * The optional sessionId is stored in coordinator_action for later feedback propagation.
 */
export function pauseAtCheckpoint(
  workflowId: string,
  stage: string,
  artifactId?: number,
  sessionId?: string,
  metadata?: Record<string, any>
): import('./workflow-db').CheckpointRow {
  const now = Date.now();

  // Build coordinator_action JSON with session_id and optional metadata
  let coordinatorAction: Record<string, any> = {};
  if (sessionId) coordinatorAction.session_id = sessionId;
  if (metadata) coordinatorAction = { ...coordinatorAction, ...metadata };

  const result = stmts.insertCheckpoint.run(
    workflowId, stage, artifactId ?? null, 'pending',
    Object.keys(coordinatorAction).length > 0 ? JSON.stringify(coordinatorAction) : null,
    now
  );

  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  const checkpoint = stmts.getCheckpoint.get(result.lastInsertRowid as number)!;
  logger.info(`Paused workflow ${workflowId} at checkpoint #${checkpoint.id} for stage "${stage}"`);
  return checkpoint;
}

/**
 * Resolve a checkpoint after human review.
 * - approved: workflow can advance to the next stage
 * - rejected: workflow stays active but intervention is needed
 * - revised: current_stage is rolled back so advanceStage reruns it
 */
export function resolveCheckpoint(
  checkpointId: number,
  status: 'approved' | 'rejected' | 'revised',
  feedback?: string
): void {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);
  if (checkpoint.status !== 'pending') {
    throw new Error(`Checkpoint ${checkpointId} is not pending (current: ${checkpoint.status})`);
  }

  const now = Date.now();

  if (status === 'revised') {
    // Roll current_stage back to the stage before this one so advanceStage re-enters it
    const workflow = stmts.getWorkflow.get(checkpoint.workflow_id)!;
    const sequence: string[] = JSON.parse(workflow.stage_sequence);
    const stageIdx = sequence.indexOf(checkpoint.stage);
    const prevStage = stageIdx > 0 ? sequence[stageIdx - 1] : null;

    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);
    stmts.updateWorkflowStageAndStatus.run(prevStage, 'active', now, checkpoint.workflow_id);
    logger.info(`Checkpoint ${checkpointId} revised — workflow ${checkpoint.workflow_id} will rerun stage "${checkpoint.stage}"`);
  } else {
    // approved or rejected — both set workflow back to active
    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);
    stmts.updateWorkflowStatus.run('active', now, checkpoint.workflow_id);
    logger.info(`Checkpoint ${checkpointId} ${status} — workflow ${checkpoint.workflow_id} active`);
  }
}

// ── Workflow status query ─────────────────────────────────────────────────────

/**
 * Get the full status of a workflow: workflow row, all checkpoints, stage info.
 */
export function getWorkflowStatus(workflowId: string): import('./workflow-db').WorkflowStatus {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const checkpoints = stmts.getCheckpointsByWorkflow.all(workflowId);

  const completedStages = [...new Set(
    checkpoints
      .filter(c => c.status === 'approved')
      .map(c => c.stage)
  )];

  const pendingCheckpoint = checkpoints.find(c => c.status === 'pending');

  // Look up the active specialist session for the current stage
  let currentSessionId: string | null = null;
  if (workflow.current_stage && workflow.status === 'active') {
    const stageMap = STAGE_SESSION_MAP[workflow.current_stage];
    if (stageMap) {
      const row = stmts.getLatestSessionForItemMode.get(workflow.item_id, stageMap.mode);
      currentSessionId = row?.id ?? null;
    }
  }

  return {
    workflow,
    checkpoints,
    currentStage: workflow.current_stage,
    completedStages,
    pendingStage: pendingCheckpoint?.stage ?? null,
    currentSessionId,
  };
}

// ── Module initialization ─────────────────────────────────────────────────────

// Start stale workflow recovery timer (runs on module load and every 5 minutes)
startStaleRecoveryTimer();
