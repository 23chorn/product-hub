/**
 * Workflow DB — shared types, prepared statements, and helpers for workflow modules.
 *
 * This is the leaf dependency in the workflow module graph.
 * No imports from other workflow-* modules.
 */

import * as path from 'path';
import db, { getPolicies } from '../data/database';
import Logger from '../utils/logger';
import { STAGE_ARTIFACT_TYPE } from './stage-metadata';
import type { AppMode, AgentType } from '@pap/shared';
import { findRepoRoot } from '../utils/find-repo-root';

export const PROJECT_ROOT = findRepoRoot(__dirname);

export const logger = new Logger('WORKFLOW-ROUTER');

// ── Row types ──────────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  summary: string | null;    // AI-generated brief name
  status: string;
  current_stage: string | null;
  stage_sequence: string;    // JSON string[]
  policy_overrides: string;  // JSON Record<string,string>
  decomposition_metadata: string | null;  // JSON DecompositionMetadata (feature wave membership)
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
  token_usage: string | null;       // JSON: StageTokenData
  required_role: string | null;     // role name required to approve
  resolved_by_user_id: number | null;
  resolved_by_name: string | null;
  created_at: number;
  resolved_at: number | null;
}

/** Token usage breakdown stored per-stage on the checkpoint row. */
export interface StageTokenData {
  specialist: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    searchCount: number;
  };
  critic?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

// ── Policy helpers ─────────────────────────────────────────────────────────────

export function loadGlobalPolicies(): Map<string, string> {
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

export const stmts = {
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
  updateWorkflowStageSequence: db.prepare(`
    UPDATE workflows SET stage_sequence = ?, updated_at = ? WHERE id = ?
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
  getCheckpointsByWorkflow: db.prepare<[string], CheckpointRow>(`
    SELECT c.*, u.name AS resolved_by_name
    FROM checkpoints c
    LEFT JOIN users u ON u.id = c.resolved_by_user_id
    WHERE c.workflow_id = ?
    ORDER BY c.created_at ASC
  `),
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

export const eventStmts = {
  insertEvent: db.prepare(`
    INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
};

// ── Helper functions ───────────────────────────────────────────────────────────

/**
 * Strip the per-feature index from a stage name before looking up configured roles.
 * Per-feature stages (story_decomposition_F1, story_decomposition_F2, ...) and their
 * _qa siblings (story_decomposition_F1_qa, ...) all share one role configuration —
 * the feature count varies per initiative, so role access can't be keyed per index.
 * "story_decomposition_F3"    → "story_decomposition"
 * "story_decomposition_F3_qa" → "story_decomposition_qa"
 */
export function normalizeStageForRoles(stage: string): string {
  return stage.replace(/_F\d+/, '');
}

/**
 * Resolve the literal stage_sequence member a checkpoint's stage name refers to.
 * Most checkpoint stage names ARE the sequence member (e.g. "epic_qa" is its own
 * entry, injected standalone by injectFeatureDecompositionStages). A few legacy
 * checkpoints are named "<stage>_qa" as a paired sibling of "<stage>" itself
 * (e.g. "story_decomposition_F1_qa" pairs with "story_decomposition_F1") — for
 * those, strip the suffix to get back to the sequence member.
 *
 * current_stage must always be set to a value in stage_sequence, or
 * advanceStage()'s sequence.indexOf() lookup returns -1 and the workflow gets
 * bounced back to stage 0 (sequence[-1 + 1]) on the next advance.
 */
export function resolveStageSequenceMember(stage: string, sequence: string[]): string {
  if (sequence.includes(stage)) return stage;
  const stripped = stage.replace(/_qa$/, '');
  return sequence.includes(stripped) ? stripped : stage;
}

export function getStageRoles(stage: string): string[] {
  return db.prepare<[string], { role_name: string }>(
    'SELECT role_name FROM stage_roles WHERE stage = ?'
  ).all(normalizeStageForRoles(stage)).map(r => r.role_name);
}

/** Serialize stage roles to a JSON string for storage in checkpoints.required_role. Returns null if no roles configured. */
export function rolesJson(stage: string): string | null {
  const roles = getStageRoles(stage);
  return roles.length > 0 ? JSON.stringify(roles) : null;
}

/** Parse required_role from a checkpoint row — handles both JSON arrays and legacy plain strings. */
export function parseRoles(val: string | null | undefined): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [val];
  }
}

export function insertEvent(
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
 * Touch a workflow's updated_at without changing its status.
 * Call periodically from long-running stages to prevent stale-recovery from firing.
 */
export function touchWorkflow(workflowId: string): void {
  db.prepare('UPDATE workflows SET updated_at = ? WHERE id = ?').run(Date.now(), workflowId);
}

/** Write token usage JSON to a checkpoint row. */
export function setCheckpointTokenUsage(checkpointRowId: number, data: StageTokenData): void {
  db.prepare('UPDATE checkpoints SET token_usage = ? WHERE id = ?')
    .run(JSON.stringify(data), checkpointRowId);
}

/**
 * Safety net: if runAutonomousStage's inner try/catch didn't create a checkpoint for a
 * failed stage, create one here so the workflow doesn't get stuck in 'active' forever.
 * Shared by every path that kicks a stage off in the background (the normal advance
 * path's kickoffMemberStage, every member of a multi-member wave, and restartWorkflow) —
 * one failing launch gets its own visible error checkpoint instead of silently wedging
 * the workflow.
 */
export function createSafetyNetCheckpoint(
  workflowId: string,
  stage: string,
  stageMap: { mode: AppMode; agentType: AgentType } | undefined,
  errorMessage: string
): void {
  try {
    const wf = stmts.getWorkflow.get(workflowId);
    // Terminal workflows have nothing left to pause (a stopped/rejected workflow also
    // lands on 'complete' — see "Show rejected workflows as Stopped" commit).
    if (!wf || wf.status === 'complete') return;
    // If this stage already produced a checkpoint, it actually succeeded (or a safety net
    // already fired) — don't pile a duplicate on top. We can't gate on the overall
    // workflow status being 'active': in a parallel feature wave (story_decomposition_F1
    // .. _Fn run together) a sibling feature completing flips the whole workflow to
    // 'paused_at_checkpoint' while this stage is still running, so an 'active'-only guard
    // would wrongly swallow this stage's failure and leave it stuck "in progress" with no
    // checkpoint or error state.
    if (stmts.getPendingCheckpointForStage.get(workflowId, stage)) return;
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

// ── Late-binding registry for circular dependency resolution ───────────────────
//
// advanceStage() and runAutonomousStage() call each other. Rather than creating
// circular imports, each module registers its function here at load time. All
// actual calls happen asynchronously (after the event loop tick), so registrations
// are guaranteed to be complete before any function is invoked.

export const workflowOps = {
  advanceStage: null as unknown as (workflowId: string) => Promise<{ stage: string; sessionId: string | null }>,
  runAutonomousStage: null as unknown as (
    sessionId: string,
    workflowId: string,
    stage: string,
    itemId: string,
    brief: string,
    autoApprove: boolean,
    priorCriticIssues?: string[],
    priorDraftContent?: string,
    skipCritic?: boolean
  ) => Promise<void>,
};
