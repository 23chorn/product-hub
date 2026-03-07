/**
 * Workflow Router — stage machine core (no LLM calls).
 *
 * Manages state transitions for coordinator-driven workflows.
 * A workflow has a stage_sequence JSON array (e.g. ["analyst","pm_prd","pm_backlog","critic","curator"]).
 * The router advances through the sequence, creating specialist sessions and checkpoints.
 *
 * All DB operations use better-sqlite3 synchronous calls.
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db, { getPolicies } from '../data/database';
import { sessionManager } from '../session/session-manager';
import { CoordinatorAgent } from './coordinator-agent';
import { CriticAgent } from './critic-agent';
import { ContextCuratorAgent } from './curator-agent';
import { BmadAgent } from './bmad-agent';
import Logger from '../utils/logger';
import type { AppMode, AgentType } from '@pap/shared';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

const logger = new Logger('WORKFLOW-ROUTER');

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

// ── Row types ──────────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  status: string;
  current_stage: string | null;
  stage_sequence: string;    // JSON string[]
  policy_overrides: string;  // JSON Record<string,string>
  created_at: number;
  updated_at: number;
}

export interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: string;
  human_feedback: string | null;
  coordinator_action: string | null;  // JSON blob
  created_at: number;
  resolved_at: number | null;
}

export interface WorkflowStatus {
  workflow: WorkflowRow;
  checkpoints: CheckpointRow[];
  currentStage: string | null;
  completedStages: string[];
  pendingStage: string | null;
  currentSessionId: string | null;
}

// ── Stage → specialist session mapping ────────────────────────────────────────

const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:    { mode: 'analyst', agentType: 'analyst' },
  pm_prd:     { mode: 'prd',     agentType: 'pm' },
  pm_backlog: { mode: 'backlog', agentType: 'pm' },
  critic:     { mode: 'analyst', agentType: 'analyst' },
  curator:    { mode: 'analyst', agentType: 'analyst' },
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:    'analyst',
  pm_prd:     'prd',
  pm_backlog: 'backlog',
};

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

// ── Story 3.1: Core functions ──────────────────────────────────────────────────

/**
 * Create a new workflow for an item.
 * Applies stage-skip policies at creation time.
 */
export function createWorkflow(
  itemId: string,
  goal: string,
  stageSequence: string[],
  policyOverrides?: Record<string, string>
): WorkflowRow {
  const policies = loadGlobalPolicies();

  // Story 3.2: Stage-skip at creation time
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
  return workflow;
}

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

  const sequence: string[] = JSON.parse(workflow.stage_sequence);
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
    logger.info(`Workflow ${workflowId} complete — all ${sequence.length} stages done`);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  const nextStage = sequence[nextIndex];
  const now = Date.now();

  // Move to next stage
  stmts.updateWorkflowStage.run(nextStage, now, workflowId);

  // ── Critic stage: automated single-shot review ────────────────────────────
  if (nextStage === 'critic') {
    const { content: artifactContent, type: artifactType } = loadLatestArtifactForItem(workflow.item_id);
    const review = await getCritic().review(artifactContent, artifactType);

    const coordinatorAction = JSON.stringify({
      critic_verdict: review.verdict,
      issue_count: review.issues.length,
      critical_issues: review.issues.filter(i => i.severity === 'critical').length,
      major_issues:    review.issues.filter(i => i.severity === 'major').length,
      questions:       review.questions.slice(0, 3),
      auto_reviewed:   true,
    });

    stmts.insertCheckpoint.run(workflowId, nextStage, null, 'pending', coordinatorAction, now);
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

    logger.info(`Critic completed for workflow ${workflowId} — verdict: ${review.verdict}`);
    return { stage: nextStage, sessionId: null };
  }

  // ── Curator stage: automated curation, auto-completes workflow ────────────
  if (nextStage === 'curator') {
    const diffCount = await getCurator().runCuration(workflowId);

    stmts.insertCheckpoint.run(
      workflowId, nextStage, null, 'approved',
      JSON.stringify({ auto_approved: true, context_diffs_proposed: diffCount }),
      now
    );
    stmts.updateWorkflowStageAndStatus.run(nextStage, 'complete', now, workflowId);

    logger.info(`Curator completed for workflow ${workflowId} — ${diffCount} diff(s) proposed, workflow complete`);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  // ── Regular specialist stage: run autonomously in the background ─────────
  const stageMap = STAGE_SESSION_MAP[nextStage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
  const session = sessionManager.createBmadSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  logger.info(`Created ${stageMap.mode} session ${session.id} for stage "${nextStage}"`);

  const brief = getCoordinator().generateStageBrief(workflowId, nextStage);
  sessionManager.updateWorkflow(session.id, workflowId, brief);

  const policies = loadGlobalPolicies();
  const autoApproveKey = `auto_approve_${nextStage}_output`;
  const autoApprove = policies.get(autoApproveKey);
  const shouldAutoApprove = autoApprove === 'true' || autoApprove === true as any;

  // Fire the autonomous specialist run as a background task.
  // It will collect the full output, store an artifact, then create the checkpoint.
  runAutonomousStage(session.id, workflowId, nextStage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => logger.error(`Autonomous stage "${nextStage}" background task failed: ${err.message}`));

  return { stage: nextStage, sessionId: null };
}

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
 * Run a specialist stage autonomously (no user interaction).
 * Builds the specialist's system prompt, sends a single "produce output now"
 * message, collects the full response, saves it as an artifact, then creates
 * a pending checkpoint so the human reviews the output.
 *
 * This is a fire-and-forget background task called from advanceStage().
 */
async function runAutonomousStage(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  brief: string,
  autoApprove: boolean
): Promise<void> {
  const stageMap = STAGE_SESSION_MAP[stage];
  if (!stageMap) {
    logger.error(`runAutonomousStage: no stage map for "${stage}"`);
    return;
  }

  logger.info(`Autonomous stage "${stage}" starting (session=${sessionId})`);

  try {
    const agent = new BmadAgent(stageMap.agentType);
    const persona = await agent.loadPersona();

    // Inject previous stage artifact as item context
    let itemContext: string | undefined;
    if (stage === 'pm_prd') {
      const analystPath = sessionManager.getLatestAnalystArtifactPath(itemId);
      if (analystPath) {
        try {
          const content = fs.readFileSync(analystPath, 'utf-8');
          itemContext = `**Research Brief (use as background for the PRD):**\n\n${content}`;
        } catch { /* ignore */ }
      }
    } else if (stage === 'pm_backlog') {
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          itemContext = `**PRD Document (use as source of requirements for the backlog):**\n\n${content}`;
        } catch { /* ignore */ }
      }
    }

    const systemPrompt = await agent.buildSystemPrompt(persona, brief, itemContext, true);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'Produce the complete output now.' },
    ];

    let fullResponse = '';
    for await (const chunk of agent.streamResponse(systemPrompt, messages)) {
      fullResponse += chunk;
    }

    // Write artifact to disk
    const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, stageMap.mode, 'artifacts');
    await fsAsync.mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `${Date.now()}-${stage}.md`);
    await fsAsync.writeFile(artifactPath, fullResponse, 'utf-8');

    // Insert artifact record (type must match what getLatestPrdArtifact / getLatestAnalystArtifact query for)
    const artifactType = STAGE_ARTIFACT_TYPE[stage] ?? stage;
    const artifactResult = db.prepare(`
      INSERT INTO artifacts (session_id, type, file_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, artifactType, artifactPath, Date.now());
    const artifactId = artifactResult.lastInsertRowid as number;

    // Create checkpoint
    const checkpointStatus = autoApprove ? 'approved' : 'pending';
    const now = Date.now();
    stmts.insertCheckpoint.run(
      workflowId, stage, artifactId, checkpointStatus,
      JSON.stringify({ session_id: sessionId, autonomous: true, auto_approved: autoApprove }),
      now
    );

    if (autoApprove) {
      // Keep workflow active so advanceStage can be called for the next stage
      logger.info(`Autonomous stage "${stage}" auto-approved — workflow stays active`);
    } else {
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      logger.info(`Autonomous stage "${stage}" complete — checkpoint created, workflow paused`);
    }
  } catch (err: any) {
    logger.error(`Autonomous stage "${stage}" failed: ${err.message}`);
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

/**
 * Load the most recently created artifact for an item, across all sessions.
 * Used by the critic stage to find the document to review.
 */
function loadLatestArtifactForItem(itemId: string): { content: string; type: string } {
  const row = db.prepare<[string], { file_path: string; type: string }>(`
    SELECT a.file_path, a.type
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode IN ('prd', 'analyst', 'backlog')
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);

  if (!row?.file_path) return { content: '(no artifact found)', type: 'document' };
  try {
    return { content: fs.readFileSync(row.file_path, 'utf-8'), type: row.type };
  } catch {
    return { content: '(artifact file unreadable)', type: row.type };
  }
}

/**
 * Force a workflow's status to 'complete' (e.g. after a rejection decision).
 */
export function markWorkflowComplete(workflowId: string): void {
  stmts.updateWorkflowStatus.run('complete', Date.now(), workflowId);
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
  sessionId?: string
): CheckpointRow {
  const now = Date.now();
  const coordinatorAction = sessionId ? JSON.stringify({ session_id: sessionId }) : null;

  const result = stmts.insertCheckpoint.run(
    workflowId, stage, artifactId ?? null, 'pending', coordinatorAction, now
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

/**
 * Get the full status of a workflow: workflow row, all checkpoints, stage info.
 */
export function getWorkflowStatus(workflowId: string): WorkflowStatus {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const checkpoints = stmts.getCheckpointsByWorkflow.all(workflowId);

  const completedStages = checkpoints
    .filter(c => c.status === 'approved')
    .map(c => c.stage);

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

// ── Story 3.3: Feedback propagation ───────────────────────────────────────────

/**
 * Propagate human feedback on a checkpoint back to the specialist session.
 * Generates a revised stage brief via the Coordinator and appends it as a user
 * message to the specialist's existing session, then marks the checkpoint as revised.
 */
export function propagateFeedback(checkpointId: number, feedback: string): void {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);

  const workflow = stmts.getWorkflow.get(checkpoint.workflow_id);
  if (!workflow) throw new Error(`Workflow not found: ${checkpoint.workflow_id}`);

  // Resolve specialist session — prefer session_id stored at checkpoint creation
  let sessionId: string | null = null;
  if (checkpoint.coordinator_action) {
    try {
      const action = JSON.parse(checkpoint.coordinator_action) as { session_id?: string };
      sessionId = action.session_id ?? null;
    } catch { /* ignore */ }
  }

  // Fallback: find most recent session for item + stage mode
  if (!sessionId) {
    const stageMap = STAGE_SESSION_MAP[checkpoint.stage];
    if (stageMap) {
      const row = stmts.getLatestSessionForItemMode.get(workflow.item_id, stageMap.mode);
      sessionId = row?.id ?? null;
    }
  }

  if (!sessionId) {
    throw new Error(
      `No specialist session found for stage "${checkpoint.stage}" in workflow ${checkpoint.workflow_id}`
    );
  }

  // Build artifact summary if available
  const artifactSummary = checkpoint.artifact_id
    ? loadArtifactSummary(checkpoint.artifact_id)
    : undefined;

  const previousContext = artifactSummary
    ? `${artifactSummary}\n\n**Human feedback requiring revision:** ${feedback}`
    : `**Human feedback requiring revision:** ${feedback}`;

  // Generate revised stage brief incorporating feedback
  const brief = getCoordinator().generateStageBrief(
    checkpoint.workflow_id,
    checkpoint.stage,
    previousContext
  );

  // Append brief as new user message to the specialist's existing session
  sessionManager.addMessage(sessionId, 'user', brief);
  logger.info(`Propagated feedback to session ${sessionId} for stage "${checkpoint.stage}"`);

  // Update checkpoint with action record
  const coordinatorAction = JSON.stringify({
    session_id: sessionId,
    action: 'feedback_propagated',
    feedback_summary: feedback.slice(0, 200),
    acted_at: Date.now(),
  });

  const now = Date.now();
  stmts.updateCheckpoint.run('revised', feedback, coordinatorAction, now, checkpointId);

  // Roll current_stage back so advanceStage reruns this stage
  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  const stageIdx = sequence.indexOf(checkpoint.stage);
  const prevStage = stageIdx > 0 ? sequence[stageIdx - 1] : null;
  stmts.updateWorkflowStageAndStatus.run(prevStage, 'active', now, checkpoint.workflow_id);

  logger.info(`Workflow ${checkpoint.workflow_id} set to rerun stage "${checkpoint.stage}" with feedback`);
}

function loadArtifactSummary(artifactId: number): string | undefined {
  const row = db.prepare<[number], { file_path: string }>(
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row?.file_path) return undefined;
  try {
    const content = fs.readFileSync(row.file_path, 'utf-8');
    return content.slice(0, 500) + (content.length > 500 ? '\n[…truncated]' : '');
  } catch {
    return undefined;
  }
}
