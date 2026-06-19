/**
 * Workflow DB — shared types, prepared statements, and helpers for workflow modules.
 *
 * This is the leaf dependency in the workflow module graph.
 * No imports from other workflow-* modules.
 */

import * as path from 'path';
import db, { getPolicies } from '../data/database';
import Logger from '../utils/logger';

export const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

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

export interface WorkflowStatus {
  workflow: WorkflowRow;
  checkpoints: CheckpointRow[];
  currentStage: string | null;
  completedStages: string[];
  pendingStage: string | null;
  pendingStages: string[];       // every pending checkpoint's stage (multiple when a wave is mid-review)
  inProgressStages: string[];    // every stage currently running concurrently (the active wave, or [currentStage])
  currentSessionId: string | null;
  productArea?: string;
  strategicTheme?: string;
}

export interface WorkflowEvent {
  id: number;
  workflow_id: string;
  event_type: string;
  stage: string | null;
  summary: string;
  details: string | null;
  created_at: number;
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
  getEventsSince: db.prepare<[string, number], WorkflowEvent>(`
    SELECT * FROM workflow_events WHERE workflow_id = ? AND id > ? ORDER BY id ASC
  `),
  getAllEvents: db.prepare<[string], WorkflowEvent>(
    'SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY id ASC'
  ),
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

export function getWorkflowEvents(workflowId: string, sinceId?: number): WorkflowEvent[] {
  if (sinceId !== undefined && sinceId > 0) {
    return eventStmts.getEventsSince.all(workflowId, sinceId);
  }
  return eventStmts.getAllEvents.all(workflowId);
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
