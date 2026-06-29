import * as fs from 'fs';
import db from '../data/database';
import Logger from '../utils/logger';
import type { WorkflowRow, CheckpointRow } from './workflow-types';
import { resolveArtifactPath } from './artifact-helpers';
import { STAGE_SESSION_MAP, STAGE_ARTIFACT_TYPE } from './stage-metadata';

const logger = new Logger('WORKFLOW-LIFECYCLE');

// ── Prepared statements needed for lifecycle operations ──────────────────────

const stmts = {
  getWorkflow: db.prepare<[string], WorkflowRow>(
    'SELECT * FROM workflows WHERE id = ?'
  ),
  getCheckpointsByWorkflow: db.prepare<[string], CheckpointRow>(
    'SELECT * FROM checkpoints WHERE workflow_id = ? ORDER BY created_at ASC'
  ),
  insertCheckpoint: db.prepare(`
    INSERT INTO checkpoints (workflow_id, stage, artifact_id, status, human_feedback, coordinator_action, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `),
  updateWorkflowStatus: db.prepare(`
    UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?
  `),
};

function insertEvent(
  workflowId: string,
  eventType: string,
  stage: string | null,
  summary: string,
  details?: Record<string, unknown>
): void {
  db.prepare(`
    INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    workflowId, eventType, stage, summary,
    details ? JSON.stringify(details) : null,
    Date.now()
  );
}

// ── Delete workflow ─────────────────────────────────────────────────────────

/**
 * Delete a workflow and all associated data:
 * - Artifact files on disk (specialist outputs, critic reviews, diffs)
 * - Sessions created for this workflow (cascades messages + artifact rows)
 * - Checkpoints, context_diffs, workflow_events, coordinator_sessions
 * - The workflow row itself
 */
export function deleteWorkflow(workflowId: string): void {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  // ── 1. Collect session IDs and artifact file paths from checkpoints ──────
  const checkpoints = stmts.getCheckpointsByWorkflow.all(workflowId);

  const sessionIds = new Set<string>();
  const artifactIds = new Set<number>();

  for (const cp of checkpoints) {
    // Collect artifact IDs referenced by checkpoints
    if (cp.artifact_id) artifactIds.add(cp.artifact_id);

    // Parse coordinator_action for session_id and additional artifact IDs
    if (cp.coordinator_action) {
      try {
        const action = JSON.parse(cp.coordinator_action);
        if (action.session_id) sessionIds.add(action.session_id);
        if (action.critic?.critic_artifact_id) artifactIds.add(action.critic.critic_artifact_id);
        if (action.diff_artifact_id) artifactIds.add(action.diff_artifact_id);
        // Also check nested critic object
        if (action.critic_artifact_id) artifactIds.add(action.critic_artifact_id);
      } catch { /* ignore malformed JSON */ }
    }
  }

  // ── 2. Resolve artifact file paths from DB ───────────────────────────────
  const filePaths: string[] = [];
  for (const id of artifactIds) {
    const row = db.prepare<[number], { file_path: string }>(
      'SELECT file_path FROM artifacts WHERE id = ?'
    ).get(id);
    if (row?.file_path) filePaths.push(resolveArtifactPath(row.file_path));
  }

  // Also collect file paths for all artifacts owned by these sessions
  // (catches any artifacts not directly referenced by checkpoints)
  for (const sessionId of sessionIds) {
    const rows = db.prepare<[string], { file_path: string }>(
      'SELECT file_path FROM artifacts WHERE session_id = ?'
    ).all(sessionId);
    for (const row of rows) {
      if (row.file_path) filePaths.push(resolveArtifactPath(row.file_path));
    }
  }

  // ── 3. Delete artifact files from disk ───────────────────────────────────
  let deletedFiles = 0;
  for (const filePath of filePaths) {
    try {
      fs.unlinkSync(filePath);
      deletedFiles++;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not delete artifact file ${filePath}: ${err.message}`);
      }
    }
  }

  // ── 4. Delete sessions (cascades to messages, artifacts) ─────────────────
  for (const sessionId of sessionIds) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  // ── 5. Delete workflow child rows and the workflow itself ─────────────────
  // Foreign keys are enforced at runtime (see database.ts), so every table that
  // references workflows.id — or a row we delete below — must be cleared first,
  // in child-before-parent order, or the final DELETE fails with a FK violation.
  // Only some of these FKs declare ON DELETE CASCADE in the schema; the rest
  // (checkpoints, checkpoint_audit, change_requests, cr_artifact_versions, the
  // ADO/QA maps) must be deleted by hand here. Wrapped in a transaction so a
  // mid-sequence failure can't leave the workflow half-deleted.
  db.transaction(() => {
    // checkpoint_audit → checkpoints, and cr_artifact_versions → change_requests:
    // clear these grandchildren before the rows they point at.
    db.prepare('DELETE FROM checkpoint_audit WHERE checkpoint_id IN (SELECT id FROM checkpoints WHERE workflow_id = ?)').run(workflowId);
    db.prepare('DELETE FROM cr_artifact_versions WHERE change_request_id IN (SELECT id FROM change_requests WHERE workflow_id = ?)').run(workflowId);

    // Rows that reference workflows.id without ON DELETE CASCADE.
    db.prepare('DELETE FROM checkpoints WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM change_requests WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM ado_work_item_map WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM qa_test_plan_map WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM context_diffs WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflow_events WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM coordinator_sessions WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
  })();

  logger.info(`Deleted workflow ${workflowId} — ${deletedFiles} file(s) removed, ${sessionIds.size} session(s) deleted`);
}

// ── Stale workflow recovery ─────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes with no update = stale

interface StaleWorkflowRow {
  id: string;
  current_stage: string | null;
  updated_at: number;
}

/**
 * Recover workflows stuck in 'active' status with no recent updates.
 * Creates an error checkpoint so the user can retry or dismiss.
 * Safe to call on startup and periodically.
 */
export function recoverStaleWorkflows(): number {
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  const stale = db.prepare<[number], StaleWorkflowRow>(
    `SELECT id, current_stage, updated_at FROM workflows
     WHERE status = 'active' AND updated_at < ?`
  ).all(cutoff);

  let recovered = 0;
  for (const wf of stale) {
    const stage = wf.current_stage ?? 'unknown';
    const staleMinutes = Math.round((Date.now() - wf.updated_at) / 60_000);
    const now = Date.now();

    insertEvent(wf.id, 'error', stage,
      `Stage "${stage}" appears stuck (no activity for ${staleMinutes} minutes). You can retry or dismiss this stage.`,
      { error: 'stale_workflow_recovery', stale_minutes: staleMinutes });

    // Try to recover the artifact_id that the specialist may have already written.
    // Filter by STAGE_ARTIFACT_TYPE to avoid picking up critic artifacts stored
    // in the same session (e.g. qa_engineer_critic instead of qa_tests).
    let artifactId: number | null = null;
    const stageMap = STAGE_SESSION_MAP[stage];
    const artifactType = STAGE_ARTIFACT_TYPE[stage];
    if (stageMap && artifactType) {
      const latestArtifact = db.prepare<[string, string, string], { id: number }>(
        `SELECT a.id FROM artifacts a
         JOIN sessions s ON a.session_id = s.id
         WHERE s.item_id = (SELECT item_id FROM workflows WHERE id = ?)
           AND s.mode = ?
           AND a.type = ?
         ORDER BY a.created_at DESC LIMIT 1`
      ).get(wf.id, stageMap.mode, artifactType);
      artifactId = latestArtifact?.id ?? null;
    }

    stmts.insertCheckpoint.run(
      wf.id, stage, artifactId, 'pending',
      JSON.stringify({ error: `Stage stalled after ${staleMinutes} minutes of inactivity`, autonomous: true, stale_recovery: true }),
      now
    );
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, wf.id);

    logger.warn(`Recovered stale workflow ${wf.id} — stage "${stage}" stuck for ${staleMinutes}m`);
    recovered++;
  }

  if (recovered > 0) {
    logger.info(`Stale workflow recovery: ${recovered} workflow(s) recovered`);
  }
  return recovered;
}

/**
 * One-time heal: stale-recovery checkpoints created before the artifact-type
 * filter fix may have been assigned a critic artifact_id instead of the
 * specialist artifact_id. Find and correct them on startup.
 */
function healStaleRecoveryCheckpoints(): void {
  const bad = db.prepare<[], { id: number; stage: string; workflow_id: string; art_type: string }>(
    `SELECT c.id, c.stage, c.workflow_id, a.type as art_type
     FROM checkpoints c
     JOIN artifacts a ON a.id = c.artifact_id
     WHERE c.coordinator_action LIKE '%"stale_recovery":true%'
       AND a.type = 'critic_review'`
  ).all();

  if (bad.length === 0) return;

  let healed = 0;
  for (const row of bad) {
    const stageMap = STAGE_SESSION_MAP[row.stage];
    const artifactType = STAGE_ARTIFACT_TYPE[row.stage];
    if (!stageMap || !artifactType) continue;

    const correct = db.prepare<[string, string, string], { id: number }>(
      `SELECT a.id FROM artifacts a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.item_id = (SELECT item_id FROM workflows WHERE id = ?)
         AND s.mode = ?
         AND a.type = ?
       ORDER BY a.created_at DESC LIMIT 1`
    ).get(row.workflow_id, stageMap.mode, artifactType);

    if (correct) {
      db.prepare('UPDATE checkpoints SET artifact_id = ? WHERE id = ?')
        .run(correct.id, row.id);
      logger.info(`Healed checkpoint ${row.id} (stage=${row.stage}): replaced critic artifact with specialist artifact ${correct.id}`);
      healed++;
    }
  }

  if (healed > 0) logger.info(`Healed ${healed} stale-recovery checkpoint(s) with wrong artifact_id`);
}

/** Start stale recovery on module load (server startup) and every 5 minutes. */
export function startStaleRecoveryTimer(): void {
  healStaleRecoveryCheckpoints();
  recoverStaleWorkflows();
  setInterval(recoverStaleWorkflows, 5 * 60 * 1000);
}
