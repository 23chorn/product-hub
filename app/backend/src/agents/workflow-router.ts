/**
 * Workflow Router — stage machine core.
 *
 * Manages state transitions for coordinator-driven workflows.
 * A workflow has a stage_sequence JSON array (e.g. ["analyst","pm_prd","epic_feature_planner","story_decomposition","curator"]).
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
import { streamAI, resolveModelId, resolveAgentModel } from '../utils/ai-provider';
import type { AppMode, AgentType } from '@pap/shared';
import {
  STAGE_SESSION_MAP, STAGE_MAX_OUTPUT_TOKENS, STAGE_ARTIFACT_TYPE,
  STAGE_ARTIFACT_LABEL, STAGE_LABELS_INTERNAL, stageProgressBriefing, stageProgressBriefReceived,
} from './stage-metadata';
import {
  saveCriticArtifact, loadLatestArtifactForItem,
} from './artifact-helpers';
import { deleteWorkflow as deleteWorkflowImpl, recoverStaleWorkflows as recoverStaleWorkflowsImpl, startStaleRecoveryTimer } from './workflow-lifecycle';
import { isDemoMode, isDemoWorkflow, demoSleep, DEMO_STAGE_DELAY_MS } from '../demo/demo-mode';
import { readItemMetadata, coerceProductArea } from './item-metadata';
import { notifyWorkflowComplete, notifyCheckpointPending } from '../utils/slack-notifier';
import { pushItemStatusToAirtable } from './ado-stage-push';
import { WorkflowRow, CheckpointRow, WorkflowStatus, WorkflowEvent } from './workflow-types';
export type { WorkflowRow, CheckpointRow, WorkflowStatus, WorkflowEvent } from './workflow-types';
import { parseDecompositionMetadata, findWaveForStage, type DecompositionMetadata } from './feature-decomposition';
export { propagateFeedback, reiterateFromStage, retryCurrentStage, restartWorkflow } from './workflow-mutations';
export { deleteWorkflow } from './workflow-lifecycle';
import Logger from '../utils/logger';
import { getCoordinator, getCritic, getCurator } from './workflow-agents';
import { workflowOps, rolesJson } from './workflow-db';

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
    INSERT INTO checkpoints (workflow_id, stage, artifact_id, status, human_feedback, coordinator_action, required_role, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
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
 * Per-workflow queue serializing advanceStage() calls. Two checkpoints can be approved
 * (and each independently call advanceStage) close enough together that their async work
 * — ADO/Airtable/wiki pushes — interleaves; without this, the second call can read a
 * current_stage that the first call already moved past, skipping the stage in between.
 * Keyed by workflowId; each entry is the tail promise of that workflow's queue.
 */
const advanceQueues = new Map<string, Promise<unknown>>();

/**
 * Advance a workflow to the next stage in its sequence.
 *
 * - For regular stages (analyst, pm_prd, epic_feature_planner, story_decomposition): creates a specialist session
 *   and pauses at a checkpoint for human review (unless auto-approve policy is set).
 * - For 'critic' stage: runs CriticAgent automatically; stores verdict in checkpoint;
 *   returns sessionId = null (no interactive session needed).
 * - For 'curator' stage: runs ContextCuratorAgent automatically; stores context_diffs;
 *   auto-completes — throws WORKFLOW_COMPLETE after storing diffs.
 *
 * Returns { stage, sessionId } or throws WORKFLOW_COMPLETE when all stages done.
 */
export function advanceStage(workflowId: string): Promise<{ stage: string; sessionId: string | null }> {
  const prior = advanceQueues.get(workflowId) ?? Promise.resolve();
  const run = prior.then(() => advanceStageCore(workflowId), () => advanceStageCore(workflowId));
  // Swallow rejection in the queue chain itself (already surfaced to this call's caller via `run`)
  // so a failed advance doesn't permanently wedge the next queued call.
  advanceQueues.set(workflowId, run.catch(() => {}));
  return run;
}

async function advanceStageCore(workflowId: string): Promise<{ stage: string; sessionId: string | null }> {
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

  const decompMeta = parseDecompositionMetadata(workflow.decomposition_metadata);

  let currentIndex = workflow.current_stage !== null
    ? sequence.indexOf(workflow.current_stage)
    : -1;

  // If current_stage is the representative member of a multi-member wave, jump to the
  // position of that wave's LAST member (by sequence order) before advancing — otherwise
  // +1 would land on a sibling wave member instead of the true next stage.
  if (workflow.current_stage) {
    const currentWave = findWaveForStage(decompMeta, workflow.current_stage);
    if (currentWave && currentWave.length > 1) {
      const lastMemberIdx = Math.max(...currentWave.map(s => sequence.indexOf(s)).filter(i => i >= 0));
      if (lastMemberIdx > currentIndex) currentIndex = lastMemberIdx;
    }
  }

  const nextIndex = currentIndex + 1;

  if (nextIndex >= sequence.length) {
    const now = Date.now();
    stmts.updateWorkflowStageAndStatus.run(
      workflow.current_stage, 'complete', now, workflowId
    );
    insertEvent(workflowId, 'workflow_complete', null, 'All stages complete. Your outputs are ready for review.');
    logger.info(`Workflow ${workflowId} complete — all ${sequence.length} stages done`);
    pushItemStatusToAirtable(workflow.item_id, 'Ready').catch(() => {});
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
    insertEvent(workflowId, 'stage_started', 'critic', 'Running quality review on the current stage output...');

    const { content: artifactContent, type: artifactType } = loadLatestArtifactForItem(workflow.item_id);
    const review = await getCritic().review(artifactContent, artifactType, resolveAgentModel('critic'), undefined, workflow.current_stage ?? undefined);

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
      stmts.insertCheckpoint.run(workflowId, nextStage, null, 'approved', coordinatorAction, null, now);
      insertEvent(workflowId, 'critic_verdict', 'critic',
        'Quality review passed — no issues found. Auto-approved.',
        criticDetails);
      logger.info(`Critic auto-approved for workflow ${workflowId}`);

      // Continue to next stage. Calls the core directly (not the exported advanceStage)
      // since this is a synchronous continuation of the current call, not a new concurrent
      // request — going through the queue would deadlock waiting on itself.
      return advanceStageCore(workflowId);
    }

    if (autoApproveCritic && review.verdict === 'revise') {
      // Auto-revise: roll back and rerun with critic feedback (max 2 retries)
      const revisionCount = (review as any)._revisionCount ?? 0;
      if (revisionCount < 2) {
        stmts.insertCheckpoint.run(workflowId, nextStage, null, 'revised', coordinatorAction, null, now);
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
    stmts.insertCheckpoint.run(workflowId, nextStage, null, 'pending', coordinatorAction, rolesJson(nextStage), now);
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

    const criticTitleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(workflow.item_id);
    if (criticTitleRow) notifyCheckpointPending(criticTitleRow.title, nextStage);

    logger.info(`Critic completed for workflow ${workflowId} — verdict: ${review.verdict}`);
    return { stage: nextStage, sessionId: null };
  }

  // ── Curator stage: automated curation, auto-completes workflow ────────────
  if (nextStage === 'curator') {
    insertEvent(workflowId, 'stage_started', 'curator', 'Updating project context files...');


    let diffCount: number;
    let reasoning: string | null;

    const isDemo = isDemoWorkflow(workflow.policy_overrides);

    if (isDemo) {
      await demoSleep(DEMO_STAGE_DELAY_MS['curator'] ?? 1500);
      diffCount = 3;
      reasoning = `## Curator review — In-App Messaging & Trade Chat

Reviewed all stage outputs against the existing context files. Proposing 3 targeted updates:

**company.md** — Add the In-App Messaging feature to the Active Features section. The architecture confirms a new Message Service (Node.js), Cassandra message store, and Redis Pub/Sub fan-out layer are now part of the production stack.

**strategy.md** — Update the retention strategy section to reference Chat as a social engagement mechanism. Per GTM strategy: target 25% of MAU using Chat within 90 days; 30-day retention lift of +15% for Chat users vs non-Chat. Note the regulatory constraint: all messages retained 7 years for MiFID II compliance.

**current-state.md** — Add the Message Service, Cassandra cluster, Redis cluster, Moderation Service, and S3 archive pipeline to the architecture overview. These are new production components introduced in this feature.

No changes needed to tech-stack.md or process.md — those remain accurate as written.`;
    } else {
      const result = await getCurator().runCuration(workflowId, resolveAgentModel('curator'));
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
      null, now
    );
    insertEvent(workflowId, 'stage_completed', 'curator',
      diffCount > 0
        ? `Context curation complete — ${diffCount} update${diffCount !== 1 ? 's' : ''} proposed.`
        : 'Context curation complete — no updates needed.',
      { context_diffs_proposed: diffCount });

    stmts.updateWorkflowStageAndStatus.run(nextStage, 'complete', now, workflowId);

    insertEvent(workflowId, 'workflow_complete', null,
      'All stages complete. Your outputs are ready for review.');

    logger.info(`Curator completed for workflow ${workflowId} — ${diffCount} diff(s) proposed, workflow complete`);
    pushItemStatusToAirtable(workflow.item_id, 'Ready').catch(() => {});
    const curatorTitleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(workflow.item_id);
    if (curatorTitleRow) notifyWorkflowComplete(curatorTitleRow.title);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  // Compute auto-approve once — used by regular stages below.
  const _wfPolicyOverrides: Record<string, string> = workflow.policy_overrides
    ? JSON.parse(workflow.policy_overrides)
    : {};
  const _isDemoAutoApprove = _wfPolicyOverrides['demo_auto_approve'] === 'true';

  // ── Regular specialist stage: run autonomously in the background ─────────
  const STAGE_NARRATION: Record<string, string> = {
    analyst:            'Sage is writing the Research Brief from market evidence and source notes.',
    pm_prd:             'Rex is writing the PRD sections, success metrics, and open questions.',
    epic_feature_planner:'Apex is writing the epic and feature breakdown from the PRD.',
    solution_architect: 'Atlas is writing the architecture sections, API surface, and data model.',
    prototype:          'Nova is generating the prototype wireframe and file map from the workflow artifacts.',
    figma_design:       'Luma is generating the Figma mockup plan from the workflow artifacts.',
  };

  // Creates a session, generates a brief, and fires the autonomous specialist run as a
  // background task for ONE stage. Shared by the single-stage path and each member of a
  // multi-member wave below — every wave member gets its own session/brief/run/safety-net,
  // exactly like a standalone stage would.
  const kickoffMemberStage = async (memberStage: string): Promise<void> => {
    const featureStageMatch = memberStage.match(/^story_decomposition_F(\d+)$/);
    const narration = STAGE_NARRATION[memberStage]
      ?? (featureStageMatch ? `Starting refinement for Feature ${featureStageMatch[1]}...` : `Starting ${memberStage}...`);
    insertEvent(workflowId, 'stage_started', memberStage, narration);

    let stageMap = STAGE_SESSION_MAP[memberStage];
    if (!stageMap) stageMap = { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
    const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
    logger.info(`Created ${stageMap.mode} session ${session.id} for stage "${memberStage}"`);

    insertEvent(workflowId, 'stage_progress', memberStage, stageProgressBriefing(memberStage));
    const memberBrief = _wfPolicyOverrides.demo_mode === 'true' || _isDemoAutoApprove
      ? `## Goal\nDemo mode — running with fixture data.\n\n## Output required\nSee fixture.`
      : await getCoordinator().generateStageBrief(workflowId, memberStage);
    sessionManager.updateWorkflow(session.id, workflowId, memberBrief);
    insertEvent(workflowId, 'stage_progress', memberStage, stageProgressBriefReceived(memberStage));

    const shouldAutoApprove = SILENT_STAGES.has(memberStage) || _isDemoAutoApprove;

    // Fire the autonomous specialist run as a background task.
    // It will collect the full output, store an artifact, then create the checkpoint.
    workflowOps.runAutonomousStage(session.id, workflowId, memberStage, workflow.item_id, memberBrief, shouldAutoApprove)
      .catch(err => {
        logger.error(`Autonomous stage "${memberStage}" background task failed: ${err.message}`);
        createSafetyNetCheckpoint(workflowId, memberStage, stageMap, err.message);
      });
  };

  const nextWave = findWaveForStage(decompMeta, nextStage) ?? [nextStage];

  if (nextWave.length > 1) {
    insertEvent(workflowId, 'stage_started', nextStage,
      `Starting ${nextWave.length} features in parallel: ${nextWave.map(s => s.replace('story_decomposition_', '')).join(', ')}`);
    await Promise.all(nextWave.map(memberStage => kickoffMemberStage(memberStage)));
  } else {
    await kickoffMemberStage(nextStage);
  }

  return { stage: nextStage, sessionId: null };
}

/**
 * Safety net: if runAutonomousStage's inner try/catch didn't create a checkpoint for a
 * failed stage, create one here so the workflow doesn't get stuck in 'active' forever.
 * Shared by the single-stage kickoff path and every member of a multi-member wave, so one
 * failing wave member gets its own visible error checkpoint instead of silently wedging
 * the whole wave (siblings still complete and create their own checkpoints normally).
 */
function createSafetyNetCheckpoint(
  workflowId: string,
  stage: string,
  stageMap: { mode: AppMode; agentType: AgentType } | undefined,
  errorMessage: string
): void {
  try {
    const wf = stmts.getWorkflow.get(workflowId);
    if (!wf || wf.status !== 'active') return;
    const now = Date.now();
    insertEvent(workflowId, 'error', stage,
      `Stage "${stage}" failed unexpectedly: ${errorMessage}`,
      { error: errorMessage });

    // Try to recover the artifact that may have been saved before the error.
    // This mirrors the logic in workflow-lifecycle.ts stale recovery.
    let artifactId: number | null = null;
    const artifactType = STAGE_ARTIFACT_TYPE[stage];
    if (stageMap && artifactType) {
      const latestArtifact = db.prepare<[string, string, string], { id: number }>(
        `SELECT a.id FROM artifacts a
         JOIN sessions s ON a.session_id = s.id
         WHERE s.item_id = (SELECT item_id FROM workflows WHERE id = ?)
           AND s.mode = ?
           AND a.type = ?
         ORDER BY a.created_at DESC LIMIT 1`
      ).get(workflowId, stageMap.mode, artifactType);
      artifactId = latestArtifact?.id ?? null;
      if (artifactId) {
        logger.info(`Safety net: recovered artifact ${artifactId} for failed stage "${stage}"`);
      }
    }

    stmts.insertCheckpoint.run(
      workflowId, stage, artifactId, 'pending',
      JSON.stringify({ error: errorMessage, autonomous: true, safety_net: true }),
      rolesJson(stage), now
    );
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
    logger.info(`Safety net: created error checkpoint for stuck workflow ${workflowId}${artifactId ? ` with artifact ${artifactId}` : ''}`);
  } catch (inner) {
    logger.error(`Safety net checkpoint creation also failed: ${(inner as Error).message}`);
  }
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
    rolesJson(workflow.current_stage),
    now
  );
  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  const completeTitleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(workflow.item_id);
  if (completeTitleRow) notifyCheckpointPending(completeTitleRow.title, workflow.current_stage);

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
  metadata?: Record<string, any>,
  requiredRole?: string  // Optional explicit role override
): import('./workflow-db').CheckpointRow {
  const now = Date.now();

  // Build coordinator_action JSON with session_id and optional metadata
  let coordinatorAction: Record<string, any> = {};
  if (sessionId) coordinatorAction.session_id = sessionId;
  if (metadata) coordinatorAction = { ...coordinatorAction, ...metadata };

  // Use explicit role if provided, otherwise lookup from stage_roles table
  const roleValue = requiredRole ? JSON.stringify([requiredRole]) : rolesJson(stage);

  const result = stmts.insertCheckpoint.run(
    workflowId, stage, artifactId ?? null, 'pending',
    Object.keys(coordinatorAction).length > 0 ? JSON.stringify(coordinatorAction) : null,
    roleValue, now
  );

  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  const checkpoint = stmts.getCheckpoint.get(result.lastInsertRowid as number)!;
  logger.info(`Paused workflow ${workflowId} at checkpoint #${checkpoint.id} for stage "${stage}"${requiredRole ? ` (role: ${requiredRole})` : ''}`);

  const pauseWorkflow = stmts.getWorkflow.get(workflowId);
  if (pauseWorkflow) {
    const pauseTitleRow = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(pauseWorkflow.item_id);
    if (pauseTitleRow) notifyCheckpointPending(pauseTitleRow.title, stage);
  }

  return checkpoint;
}

/**
 * Get the base stage name from a checkpoint stage (strips _qa suffix).
 * Example: "story_decomposition_F1_qa" → "story_decomposition_F1"
 */
function getBaseStage(stage: string): string {
  return stage.replace(/_qa$/, '');
}

/**
 * Get the current checkpoints in a group (base stage + base_stage_qa) — the latest one
 * per stage variant. getCheckpointsByWorkflow returns oldest-first, so after a retry or
 * revision leaves older 'revised' rows behind for the same stage name, only the most
 * recent row per variant should count toward the group's approval state.
 */
function getCheckpointGroup(workflowId: string, stage: string): import('./workflow-db').CheckpointRow[] {
  const baseStage = getBaseStage(stage);
  const qaStage = `${baseStage}_qa`;

  const allCheckpoints = stmts.getCheckpointsByWorkflow.all(workflowId);
  const reversed = [...allCheckpoints].reverse();
  const latestBase = reversed.find(cp => cp.stage === baseStage);
  const latestQa = reversed.find(cp => cp.stage === qaStage);
  return [latestBase, latestQa].filter((cp): cp is import('./workflow-db').CheckpointRow => !!cp);
}

/**
 * Check if all checkpoints in a group are approved.
 * Used to determine if workflow can advance past a dual-checkpoint stage.
 */
function isCheckpointGroupFullyApproved(workflowId: string, stage: string): boolean {
  const group = getCheckpointGroup(workflowId, stage);
  if (group.length === 0) return false;

  // All checkpoints in group must be approved
  return group.every(cp => cp.status === 'approved');
}

/**
 * Check if every member of the wave containing `stage` has its OWN {backlog, qa}
 * checkpoint pair fully approved. Used to gate advanceStage() for wave-grouped
 * story_decomposition_F* stages — distinct from isCheckpointGroupFullyApproved(),
 * which only checks ONE feature's own pair (used to gate that feature's ADO push).
 *
 * For workflows with no wave metadata (pre-dating this feature) or for a stage that
 * isn't part of any multi-member wave, this degrades to exactly
 * isCheckpointGroupFullyApproved(workflowId, stage) — i.e. every existing stage type
 * and every old workflow is unaffected.
 */
function isWaveFullyApproved(workflowId: string, stage: string): boolean {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) return false;
  const decompMeta = parseDecompositionMetadata(workflow.decomposition_metadata);
  const wave = findWaveForStage(decompMeta, getBaseStage(stage));
  const members = wave ?? [getBaseStage(stage)];
  return members.every(memberStage => isCheckpointGroupFullyApproved(workflowId, memberStage));
}

/**
 * Invalidate all approved checkpoints in a group when one is revised.
 * This ensures that if stories are approved but QA requests changes,
 * the story approval is cleared since the refinement will regenerate both.
 */
function invalidateCheckpointGroupApprovals(workflowId: string, stage: string, exceptCheckpointId: number): void {
  const group = getCheckpointGroup(workflowId, stage);
  const now = Date.now();

  for (const cp of group) {
    if (cp.id !== exceptCheckpointId && cp.status === 'approved') {
      stmts.updateCheckpoint.run('revised', 'Invalidated due to sibling checkpoint revision', cp.coordinator_action, now, cp.id);
      logger.info(`Checkpoint ${cp.id} (stage: ${cp.stage}) invalidated — sibling checkpoint requested changes`);
      insertEvent(workflowId, 'checkpoint_invalidated', cp.stage,
        `${cp.stage} approval invalidated — refinement will regenerate both stories and QA tests`,
        { invalidated_checkpoint_id: cp.id, trigger_checkpoint_id: exceptCheckpointId });
    }
  }
}

/**
 * Result of resolveCheckpoint() — two independent completion signals so callers can
 * gate per-feature side effects separately from whole-workflow advancement:
 *   - ownGroupComplete: this checkpoint's own feature pair (backlog+QA) is fully
 *     approved. Drives per-feature side effects like pushFeatureToADO().
 *   - waveComplete: the ENTIRE WAVE containing this stage (all concurrent sibling
 *     features, if any) has each had its own pair fully approved. Drives
 *     advanceStage(). For non-wave stages (every stage type that existed before
 *     parallel waves, and feature stages in workflows with no wave metadata), this
 *     is always identical to ownGroupComplete — zero behavior change for those.
 */
export interface ResolveCheckpointResult {
  ownGroupComplete: boolean;
  waveComplete: boolean;
}

/**
 * Resolve a checkpoint after human review.
 * - approved: if all sibling checkpoints in the group are also approved, the feature's
 *   own work is complete; if the whole wave is also fully approved, the workflow can advance
 * - rejected: workflow stays active but intervention is needed
 * - revised: invalidates any approved sibling checkpoints and rolls back for full stage re-run
 *
 * Callers must only fire per-feature side effects (like pushing a feature to ADO) when
 * `ownGroupComplete` is true, and must only call advanceStage() when `waveComplete` is
 * true — calling advanceStage() while wave siblings are still pending lets it race ahead
 * and skip stages whose checkpoints haven't actually been reviewed yet.
 */
export function resolveCheckpoint(
  checkpointId: number,
  status: 'approved' | 'rejected' | 'revised',
  feedback?: string
): ResolveCheckpointResult {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);
  if (checkpoint.status !== 'pending') {
    throw new Error(`Checkpoint ${checkpointId} is not pending (current: ${checkpoint.status})`);
  }

  const now = Date.now();

  if (status === 'revised') {
    // Invalidate any approved checkpoints in the same group since the stage will regenerate all artifacts
    invalidateCheckpointGroupApprovals(checkpoint.workflow_id, checkpoint.stage, checkpointId);

    // Roll current_stage back to the stage before this one so advanceStage re-enters it
    const workflow = stmts.getWorkflow.get(checkpoint.workflow_id)!;
    const sequence: string[] = JSON.parse(workflow.stage_sequence);
    const baseStage = getBaseStage(checkpoint.stage);
    const stageIdx = sequence.indexOf(baseStage);
    const prevStage = stageIdx > 0 ? sequence[stageIdx - 1] : null;

    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);
    stmts.updateWorkflowStageAndStatus.run(prevStage, 'active', now, checkpoint.workflow_id);
    logger.info(`Checkpoint ${checkpointId} revised — workflow ${checkpoint.workflow_id} will rerun stage "${baseStage}"`);
    return { ownGroupComplete: false, waveComplete: false };
  } else if (status === 'approved') {
    // Mark this checkpoint as approved
    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);

    // Check if all checkpoints in this feature's own group are now approved
    const ownGroupComplete = isCheckpointGroupFullyApproved(checkpoint.workflow_id, checkpoint.stage);
    if (!ownGroupComplete) {
      // Still waiting on sibling checkpoint(s) — keep workflow paused
      logger.info(`Checkpoint ${checkpointId} approved — workflow ${checkpoint.workflow_id} remains paused pending sibling checkpoint approval`);
      return { ownGroupComplete: false, waveComplete: false };
    }

    // This feature's own pair is done — check if the whole wave (if any) is also done
    const waveComplete = isWaveFullyApproved(checkpoint.workflow_id, checkpoint.stage);
    if (waveComplete) {
      stmts.updateWorkflowStatus.run('active', now, checkpoint.workflow_id);
      logger.info(`Checkpoint ${checkpointId} approved — wave fully approved, workflow ${checkpoint.workflow_id} can advance`);
    } else {
      logger.info(`Checkpoint ${checkpointId} approved — feature's own pair complete, but wave sibling(s) still pending; workflow ${checkpoint.workflow_id} remains paused`);
    }
    return { ownGroupComplete: true, waveComplete };
  } else {
    // rejected — set workflow back to active for intervention
    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);
    stmts.updateWorkflowStatus.run('active', now, checkpoint.workflow_id);
    logger.info(`Checkpoint ${checkpointId} ${status} — workflow ${checkpoint.workflow_id} active`);
    return { ownGroupComplete: false, waveComplete: false };
  }
}

// ── Workflow status query ─────────────────────────────────────────────────────

/**
 * Get the full status of a workflow: workflow row, all checkpoints, stage info.
 */
export function getWorkflowStatus(workflowId: string): WorkflowStatus {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const checkpoints = stmts.getCheckpointsByWorkflow.all(workflowId);

  const completedStages = [...new Set(
    checkpoints
      .filter(c => c.status === 'approved')
      .map(c => c.stage)
  )];

  const pendingCheckpoints = checkpoints.filter(c => c.status === 'pending');
  const pendingCheckpoint = pendingCheckpoints[0];
  const pendingStages = [...new Set(pendingCheckpoints.map(c => c.stage))];

  // Full membership of the wave the current stage belongs to (or just [currentStage]
  // for non-wave / legacy workflows) — lets the UI show every concurrently-running
  // feature as in-progress instead of just one.
  const decompMeta = parseDecompositionMetadata(workflow.decomposition_metadata);
  let inProgressStages: string[] = [];
  if (workflow.current_stage && workflow.status === 'active') {
    inProgressStages = findWaveForStage(decompMeta, workflow.current_stage) ?? [workflow.current_stage];
  }

  // Look up the active specialist session for the current stage
  let currentSessionId: string | null = null;
  if (workflow.current_stage && workflow.status === 'active') {
    const stageMap = STAGE_SESSION_MAP[workflow.current_stage];
    if (stageMap) {
      const row = stmts.getLatestSessionForItemMode.get(workflow.item_id, stageMap.mode);
      currentSessionId = row?.id ?? null;
    }
  }

  // Product Area / Theme live on the item's metadata (synced from Airtable), not the workflow row
  const meta = readItemMetadata(workflow.item_id);
  const productArea = coerceProductArea(meta?.productArea) ?? undefined;
  const strategicTheme = typeof meta?.strategicTheme === 'string' ? meta.strategicTheme : undefined;

  return {
    workflow,
    checkpoints,
    currentStage: workflow.current_stage,
    completedStages,
    pendingStage: pendingCheckpoint?.stage ?? null,
    pendingStages,
    inProgressStages,
    currentSessionId,
    productArea,
    strategicTheme,
  };
}

// ── Module initialization ─────────────────────────────────────────────────────

// Start stale workflow recovery timer (runs on module load and every 5 minutes)
startStaleRecoveryTimer();
