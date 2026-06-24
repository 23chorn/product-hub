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
  stageProgressWorking, stageStartedNarration, stageProgressBriefing, stageProgressBriefReceived,
} from './stage-metadata';
import { loadArtifactContentById, loadLatestArtifactContent, resolveArtifactPath, isJsonArtifactContent } from './artifact-helpers';
import {
  logger, stmts, insertEvent, workflowOps, createSafetyNetCheckpoint,
} from './workflow-db';
import {
  runAutonomousStage, getCoordinator, SILENT_STAGES, clearCancelFlag,
} from './workflow-stage-runner';
import { parseDecompositionMetadata, findWaveForStage, collapseFeatureDecompositionStages } from './feature-decomposition';

function stageSession(stage: string): { mode: AppMode; agentType: AgentType } {
  return STAGE_SESSION_MAP[stage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
}

/**
 * Propagate human feedback on a checkpoint back to the specialist session.
 * Generates a revised stage brief via the Coordinator and appends it as a user
 * message to the specialist's existing session, then marks the checkpoint as revised.
 */
export async function propagateFeedback(checkpointId: number, feedback: string, requestedBy?: string): Promise<void> {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);

  const workflow = stmts.getWorkflow.get(checkpoint.workflow_id);
  if (!workflow) throw new Error(`Workflow not found: ${checkpoint.workflow_id}`);

  // Load the full prior artifact — passed as the assistant turn in the conversation thread.
  let priorDraft = checkpoint.artifact_id
    ? (await loadArtifactContentById(checkpoint.artifact_id)) ?? undefined
    : undefined;

  // Every artifact is stored as JSON. If this came back as something else, the primary
  // store (disk) was unreadable and readArtifactRow fell back to the wiki's markdown
  // mirror — not the canonical draft. Threading that in as the specialist's "previous
  // response" makes it think the document format changed, which derails the revision.
  // Treat it as no-prior-draft instead so it gets a clean from-scratch brief.
  if (priorDraft && !isJsonArtifactContent(priorDraft)) {
    logger.warn(`propagateFeedback: artifact ${checkpoint.artifact_id} content is not JSON (likely wiki fallback) — generating a from-scratch revision brief instead of threading it as the prior draft`);
    priorDraft = undefined;
  }

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
  // Use the base stage (strip a "_qa" checkpoint suffix) — current_stage must always be
  // a literal stage_sequence member, or advanceStage()'s indexOf() lookup returns -1 and
  // the workflow gets bounced back to stage 0 (sequence[-1 + 1]) once the wave completes.
  const baseStageForCurrent = checkpoint.stage.replace(/_qa$/, '');
  stmts.updateWorkflowStageAndStatus.run(baseStageForCurrent, 'active', now, checkpoint.workflow_id);

  // Create a fresh specialist session and fire an autonomous re-run.
  const stageMap = stageSession(checkpoint.stage);
  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, checkpoint.workflow_id, brief);

  const shouldAutoApprove = SILENT_STAGES.has(checkpoint.stage);

  // Skip critic on human-initiated revisions — the human is now the reviewer
  // Pass priorDraft so runAutonomousStage threads it as the assistant turn
  runAutonomousStage(session.id, checkpoint.workflow_id, checkpoint.stage, workflow.item_id, brief, shouldAutoApprove, undefined, priorDraft, true, requestedBy)
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
  briefOverride?: string,
  requestedBy?: string
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
  let priorDraft = artifactTypeForLoad
    ? (await loadLatestArtifactContent(workflow.item_id, artifactTypeForLoad)) ?? undefined
    : undefined;

  // See propagateFeedback() above — guard against the wiki's markdown mirror leaking
  // through as the "prior draft" when disk content is unreadable.
  if (priorDraft && !isJsonArtifactContent(priorDraft)) {
    logger.warn(`reiterateFromStage: artifact content for stage "${fromStage}" is not JSON (likely wiki fallback) — generating a from-scratch brief instead of threading it as the prior draft`);
    priorDraft = undefined;
  }
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
  runAutonomousStage(session.id, workflowId, fromStage, workflow.item_id, brief, shouldAutoApprove, undefined, priorDraft, true, requestedBy)
    .catch(err => logger.error(`Reiteration re-run for stage "${fromStage}" failed: ${err.message}`));

  logger.info(`Reiteration started — session ${session.id} for stage "${fromStage}" in workflow ${workflowId}`);
}

/**
 * Retry the current stage of an active workflow that appears stuck.
 * Only allowed when status is 'active' and there's a current_stage set.
 * Re-generates the stage brief and starts a fresh specialist session.
 *
 * If current_stage belongs to a multi-member wave (concurrent feature refinement),
 * every member of the wave is retried — not just the representative stage stored in
 * current_stage — so a stuck wave doesn't leave its other in-flight features behind.
 */
export async function retryCurrentStage(
  workflowId: string,
  triggeredBy?: { id: number; name: string; username: string }
): Promise<{ stage: string }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'active' && workflow.status !== 'paused_at_checkpoint') {
    throw new Error(`Workflow cannot be retried (status: ${workflow.status})`);
  }
  if (!workflow.current_stage) {
    throw new Error('No current stage to retry');
  }

  const stage = workflow.current_stage;
  const decompMeta = parseDecompositionMetadata(workflow.decomposition_metadata);
  const wave = findWaveForStage(decompMeta, stage) ?? [stage];

  for (const memberStage of wave) {
    logger.info(`Retrying stuck stage "${memberStage}" for workflow ${workflowId}`);
    // Distinct from the 'stage_progress' narration event below — kept separate so the
    // stats dashboard can count manual retries without scraping narration text.
    insertEvent(workflowId, 'stage_retried', memberStage,
      `Stage manually retried${triggeredBy ? ` by ${triggeredBy.name}` : ''}`,
      triggeredBy ? { userId: triggeredBy.id, name: triggeredBy.name, username: triggeredBy.username } : undefined);
    insertEvent(workflowId, 'stage_progress', memberStage,
      stageProgressWorking(memberStage));

    // Dismiss any pending checkpoint for this stage (and its QA companion checkpoint,
    // e.g. story_decomposition_F1 + story_decomposition_F1_qa) so the UI clears
    const now = Date.now();
    db.prepare(`
      UPDATE checkpoints SET status = 'revised', resolved_at = ?
      WHERE workflow_id = ? AND (stage = ? OR stage = ?) AND status = 'pending'
    `).run(now, workflowId, memberStage, `${memberStage}_qa`);

    // Generate a fresh brief
    const brief = await getCoordinator().generateStageBrief(workflowId, memberStage);

    // Create a new specialist session
    const stageMap = stageSession(memberStage);
    const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
    sessionManager.updateWorkflow(session.id, workflowId, brief);

    const shouldAutoApprove = SILENT_STAGES.has(memberStage);

    runAutonomousStage(session.id, workflowId, memberStage, workflow.item_id, brief, shouldAutoApprove)
      .catch(err => logger.error(`Retry re-run for stage "${memberStage}" failed: ${err.message}`));
  }

  // Reset workflow status to active on the representative stage (current_stage already
  // points at it — same convention advanceStageCore uses for multi-member waves).
  stmts.updateWorkflowStageAndStatus.run(stage, 'active', Date.now(), workflowId);

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

  // Collapse any story_decomposition_F<n> wave stages left over from the previous run
  // back into a single 'story_decomposition' placeholder — otherwise the sidebar shows
  // last run's feature count immediately, before epic_feature_planner has re-run.
  const collapsedSequence = collapseFeatureDecompositionStages(sequence);
  const firstStage = collapsedSequence[0];

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
    // Drop the previous run's ADO work-item map. It points at last run's epic/feature/story
    // items, and a restart re-runs epic_feature_planner which creates fresh ADO items — without
    // this, the re-push hits "UNIQUE constraint failed: ado_work_item_map.workflow_id, local_key"
    // on the surviving rows (and silently orphans the new duplicate epic it just created in ADO).
    db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ?`).run(workflowId);
    // Same problem as ado_work_item_map above, but for the QA test plan: it points at
    // last run's ADO Test Plan, and pushQATestPlan() treats that row's presence as
    // "this plan is still current" — it reuses the plan and merges new test cases into
    // it instead of starting fresh. Across repeated restarts that plan silently
    // accumulates every prior attempt's test cases (orphaned ones never get pruned),
    // so without this it keeps growing forever. Same trade-off as the ADO map above:
    // we drop the local pointer and let the old plan go stale in ADO rather than
    // deleting it here (deletion needs a network round-trip + Test API, not a fit for
    // this DB transaction — see scripts/cleanup-ado-work-items.js --test-plan for that).
    db.prepare(`DELETE FROM qa_test_plan_map WHERE workflow_id = ?`).run(workflowId);
    // Delete sessions (and their messages/artifacts via cascade) created during this workflow run
    db.prepare(`DELETE FROM sessions WHERE item_id = ? AND created_at >= ?`).run(workflow.item_id, workflow.created_at);
    // Collapse last run's feature-wave stages out of stage_sequence and clear wave
    // metadata, so the sidebar shows a single un-expanded stage until epic_feature_planner
    // re-runs and re-injects this attempt's actual feature count.
    db.prepare(`UPDATE workflows SET stage_sequence = ?, decomposition_metadata = NULL WHERE id = ?`)
      .run(JSON.stringify(collapsedSequence), workflowId);
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

  insertEvent(workflowId, 'stage_started', firstStage, stageStartedNarration(firstStage));

  const stageMap = stageSession(firstStage);
  const policyOverrides: Record<string, string> = workflow.policy_overrides
    ? JSON.parse(workflow.policy_overrides)
    : {};
  const isDemoAutoApprove = policyOverrides['demo_auto_approve'] === 'true';

  // Generate a fresh brief for the first stage (no prior draft) — skip the LLM call for
  // demo workflows, same as the normal advance path, since the demo fixture overrides
  // whatever the brief says anyway.
  insertEvent(workflowId, 'stage_progress', firstStage, stageProgressBriefing(firstStage));
  const brief = policyOverrides.demo_mode === 'true' || isDemoAutoApprove
    ? `## Goal\nDemo mode — running with fixture data.\n\n## Output required\nSee fixture.`
    : await getCoordinator().generateStageBrief(workflowId, firstStage);

  const session = sessionManager.createSpecialistSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, workflowId, brief);
  insertEvent(workflowId, 'stage_progress', firstStage, stageProgressBriefReceived(firstStage));

  const shouldAutoApprove = SILENT_STAGES.has(firstStage) || isDemoAutoApprove;

  runAutonomousStage(session.id, workflowId, firstStage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => {
      logger.error(`Restart run for stage "${firstStage}" failed: ${err.message}`);
      createSafetyNetCheckpoint(workflowId, firstStage, stageMap, err.message);
    });

  logger.info(`Workflow ${workflowId} restarted from stage "${firstStage}" — wiped ${artifactFiles.length} artifact(s)`);
}
