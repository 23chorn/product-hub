import * as fs from 'fs';
import db from '../data/database';
import Logger from '../utils/logger';
import type { WorkflowRow, CheckpointRow } from './workflow-types';

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
    if (row?.file_path) filePaths.push(row.file_path);
  }

  // Also collect file paths for all artifacts owned by these sessions
  // (catches any artifacts not directly referenced by checkpoints)
  for (const sessionId of sessionIds) {
    const rows = db.prepare<[string], { file_path: string }>(
      'SELECT file_path FROM artifacts WHERE session_id = ?'
    ).all(sessionId);
    for (const row of rows) {
      if (row.file_path) filePaths.push(row.file_path);
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

  // ── 4. Delete sessions (cascades to messages, artifacts, staged_decisions) ─
  for (const sessionId of sessionIds) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  // ── 5. Delete workflow child rows and the workflow itself ─────────────────
  db.prepare('DELETE FROM checkpoints WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM context_diffs WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM workflow_events WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM coordinator_sessions WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);

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

    stmts.insertCheckpoint.run(
      wf.id, stage, null, 'pending',
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

/** Start stale recovery on module load (server startup) and every 5 minutes. */
export function startStaleRecoveryTimer(): void {
  recoverStaleWorkflows();
  setInterval(recoverStaleWorkflows, 5 * 60 * 1000);
}
