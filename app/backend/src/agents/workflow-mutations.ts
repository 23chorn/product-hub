/**
 * Workflow Mutations — post-completion workflow modifications.
 *
 * Functions that modify a workflow after it has produced output:
 * feedback propagation, reiteration, extension, and stuck-stage retry.
 */

import fs from 'fs';
import path from 'path';
import db from '../data/database';
import { sessionManager } from '../session/session-manager';
import type { AppMode, AgentType } from '@pap/shared';
import {
  STAGE_SESSION_MAP, STAGE_LABELS_INTERNAL, STAGE_ARTIFACT_TYPE,
  stageProgressWorking,
} from './stage-metadata';
import { loadArtifactContentById, loadLatestArtifactContent, resolveArtifactPath } from './artifact-helpers';
import {
  logger, stmts, insertEvent, workflowOps,
} from './workflow-db';
import {
  runAutonomousStage, getCoordinator, SILENT_STAGES, clearCancelFlag,
} from './workflow-stage-runner';

function stageSession(stage: string): { mode: AppMode; agentType: AgentType } {
  return STAGE_SESSION_MAP[stage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
}

/**
 * Propagate human feedback on a checkpoint back to the specialist session.
 * Generates a revised stage brief via the Coordinator and appends it as a user
 * message to the specialist's existing session, then marks the checkpoint as revised.
 */
export async function propagateFeedback(checkpointId: number, feedback: string): Promise<void> {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);

  const workflow = stmts.getWorkflow.get(checkpoint.workflow_id);
  if (!workflow) throw new Error(`Workflow not found: ${checkpoint.workflow_id}`);

  // Load the full prior artifact — passed as the assistant turn in the conversation thread.
  // Use the async loader so MongoDB-backed artifacts are fetched correctly.
  const priorDraft = checkpoint.artifact_id
    ? (await loadArtifactContentById(checkpoint.artifact_id)) ?? undefined
    : undefined;

  // Build the revision brief (instructions only — prior draft goes into the message thread)
  const brief = priorDraft
    ? getCoordinator().generateRevisionBrief(
        checkpoint.workflow_id,
        checkpoint.stage,
        priorDraft,
        [`[HUMAN FEEDBACK] ${feedback}`]
      )
    : await getCoordinator().generateStageBrief(
        checkpoint.workflow_id,
        checkpoint.stage,
        `**Human feedback requiring revision:** ${feedback}`
      );

  // Mark the old checkpoint as revised.
  const now = Date.now();
  stmts.updateCheckpoint.run(
    'revised',
    feedback,
    JSON.stringify({ action: 'revision_rerun', feedback_summary: feedback.slice(0, 200), acted_at: now }),
    now,
    checkpointId
  );

  // Set current_stage to this stage and status to active — a new run is starting.
  stmts.updateWorkflowStageAndStatus.run(checkpoint.stage, 'active', now, checkpoint.workflow_id);

  // Create a fresh specialist session and fire an autonomous re-run.
  const stageMap = stageSession(checkpoint.stage);
  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, checkpoint.workflow_id, brief);

  const shouldAutoApprove = SILENT_STAGES.has(checkpoint.stage);

  // Skip critic on human-initiated revisions — the human is now the reviewer
  // Pass priorDraft so runAutonomousStage threads it as the assistant turn
  runAutonomousStage(session.id, checkpoint.workflow_id, checkpoint.stage, workflow.item_id, brief, shouldAutoApprove, undefined, priorDraft, true)
    .catch(err => logger.error(`Revision re-run for stage "${checkpoint.stage}" failed: ${err.message}`));

  logger.info(`Revision re-run started — session ${session.id} for stage "${checkpoint.stage}" in workflow ${checkpoint.workflow_id}`);
}

/**
 * Re-enter a completed workflow at a specific stage.
 * The given stage and all downstream stages are re-run using the user's
 * feedback as context. Existing artifacts are preserved for audit trail.
 */
export async function reiterateFromStage(
  workflowId: string,
  fromStage: string,
  feedback: string,
  briefOverride?: string
): Promise<void> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'complete') {
    throw new Error(`Workflow ${workflowId} is not complete (status: ${workflow.status}) — reiteration only applies to completed workflows`);
  }

  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  const idx = sequence.indexOf(fromStage);
  if (idx < 0) throw new Error(`Stage "${fromStage}" is not in the workflow's stage sequence`);

  const stageLabel = STAGE_LABELS_INTERNAL[fromStage] ?? fromStage;
  insertEvent(workflowId, 'reiteration', fromStage,
    `Re-entering at ${stageLabel}: ${feedback.slice(0, 200)}`);

  // Mark existing approved checkpoints for fromStage and all downstream stages
  // as 'revised' so they no longer count as completed in the UI
  const downstreamStages = sequence.slice(idx);
  for (const stage of downstreamStages) {
    db.prepare(`
      UPDATE checkpoints SET status = 'revised'
      WHERE workflow_id = ? AND stage = ? AND status = 'approved'
    `).run(workflowId, stage);
  }

  // Set current_stage to fromStage so the UI shows the correct active stage
  // and retryCurrentStage can recover if the server restarts mid-run
  const now = Date.now();
  stmts.updateWorkflowStageAndStatus.run(fromStage, 'active', now, workflowId);

  // Load the prior artifact so the specialist can revise in-place.
  // story_decomposition_F* stages save as 'backlog' type (not keyed to stage name).
  const isFeatureDecompStage = /^story_decomposition_F\d+$/.test(fromStage);
  const artifactTypeForLoad = isFeatureDecompStage ? 'backlog' : STAGE_ARTIFACT_TYPE[fromStage];
  const priorDraft = artifactTypeForLoad
    ? (await loadLatestArtifactContent(workflow.item_id, artifactTypeForLoad)) ?? undefined
    : undefined;
  const brief = briefOverride
    ? briefOverride
    : priorDraft
      ? getCoordinator().generateRevisionBrief(workflowId, fromStage, priorDraft, [`[HUMAN FEEDBACK] ${feedback}`])
      : await getCoordinator().generateStageBrief(workflowId, fromStage, feedback);

  // Create a new specialist session
  const stageMap = stageSession(fromStage);
  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, workflowId, brief);

  const shouldAutoApprove = SILENT_STAGES.has(fromStage);

  // Fire the autonomous stage — skip critic since this is human-initiated
  // Pass priorDraft so runAutonomousStage threads it as the assistant turn
  runAutonomousStage(session.id, workflowId, fromStage, workflow.item_id, brief, shouldAutoApprove, undefined, priorDraft, true)
    .catch(err => logger.error(`Reiteration re-run for stage "${fromStage}" failed: ${err.message}`));

  logger.info(`Reiteration started — session ${session.id} for stage "${fromStage}" in workflow ${workflowId}`);
}

/**
 * Retry the current stage of an active workflow that appears stuck.
 * Only allowed when status is 'active' and there's a current_stage set.
 * Re-generates the stage brief and starts a fresh specialist session.
 */
export async function retryCurrentStage(workflowId: string): Promise<{ stage: string }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'active' && workflow.status !== 'paused_at_checkpoint') {
    throw new Error(`Workflow cannot be retried (status: ${workflow.status})`);
  }
  if (!workflow.current_stage) {
    throw new Error('No current stage to retry');
  }

  const stage = workflow.current_stage;

  logger.info(`Retrying stuck stage "${stage}" for workflow ${workflowId}`);
  insertEvent(workflowId, 'stage_progress', stage,
    stageProgressWorking(stage));

  // Dismiss any pending checkpoint for this stage so the UI clears
  const now = Date.now();
  db.prepare(`
    UPDATE checkpoints SET status = 'revised', resolved_at = ?
    WHERE workflow_id = ? AND stage = ? AND status = 'pending'
  `).run(now, workflowId, stage);

  // Reset workflow status to active on this stage
  stmts.updateWorkflowStageAndStatus.run(stage, 'active', now, workflowId);

  // Generate a fresh brief
  const brief = await getCoordinator().generateStageBrief(workflowId, stage);

  // Create a new specialist session
  const stageMap = stageSession(stage);
  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, workflowId, brief);

  const shouldAutoApprove = SILENT_STAGES.has(stage);

  runAutonomousStage(session.id, workflowId, stage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => logger.error(`Retry re-run for stage "${stage}" failed: ${err.message}`));

  return { stage };
}

/**
 * Restart a stopped/cancelled workflow from the very first stage.
 * Clears the cancel flag, marks all existing checkpoints as revised,
 * and fires a fresh run from stage 0 with no prior draft.
 */
export async function restartWorkflow(workflowId: string): Promise<void> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  if (sequence.length === 0) throw new Error('Workflow has no stages');

  const firstStage = sequence[0];

  // Clear in-memory cancel flag so stages can run again
  clearCancelFlag(workflowId);

  // Collect artifact file paths before deletion (sessions created during this workflow)
  const artifactFiles = db.prepare<[string, number], { file_path: string }>(
    `SELECT a.file_path FROM artifacts a
     JOIN sessions s ON a.session_id = s.id
     WHERE s.item_id = ? AND s.created_at >= ?`
  ).all(workflow.item_id, workflow.created_at) as { file_path: string }[];

  const now = Date.now();

  // Wipe previous stage data in a transaction (keep general/lifecycle events)
  db.transaction(() => {
    // Delete context_diffs linked to this workflow (may reference artifacts)
    db.prepare(`DELETE FROM context_diffs WHERE workflow_id = ?`).run(workflowId);
    // Delete checkpoint audit rows before deleting checkpoints
    db.prepare(`DELETE FROM checkpoint_audit WHERE checkpoint_id IN (SELECT id FROM checkpoints WHERE workflow_id = ?)`).run(workflowId);
    // Delete checkpoints (artifact_ids will be stale after we delete sessions)
    db.prepare(`DELETE FROM checkpoints WHERE workflow_id = ?`).run(workflowId);
    // Wipe all events — the new workflow_started event inserted below becomes the first entry
    db.prepare(`DELETE FROM workflow_events WHERE workflow_id = ?`).run(workflowId);
    // Delete sessions (and their messages/artifacts via cascade) created during this workflow run
    db.prepare(`DELETE FROM sessions WHERE item_id = ? AND created_at >= ?`).run(workflow.item_id, workflow.created_at);
  })();

  // Delete artifact files from disk
  for (const { file_path } of artifactFiles) {
    try {
      const resolved = resolveArtifactPath(file_path);
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    } catch { /* non-fatal */ }
  }

  insertEvent(workflowId, 'workflow_started', null, 'Workflow restarted from the beginning.');

  // Reset workflow state to first stage
  stmts.updateWorkflowStageAndStatus.run(firstStage, 'active', now, workflowId);

  // Generate a fresh brief for the first stage (no prior draft)
  const brief = await getCoordinator().generateStageBrief(workflowId, firstStage);

  const stageMap = stageSession(firstStage);
  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, workflowId, brief);

  const shouldAutoApprove = SILENT_STAGES.has(firstStage);

  runAutonomousStage(session.id, workflowId, firstStage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => logger.error(`Restart run for stage "${firstStage}" failed: ${err.message}`));

  logger.info(`Workflow ${workflowId} restarted from stage "${firstStage}" — wiped ${artifactFiles.length} artifact(s)`);
}
