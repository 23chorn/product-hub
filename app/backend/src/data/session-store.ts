import { v4 as uuidv4 } from 'uuid';
import db from './database';
import { resolveArtifactPath } from '../agents/artifact-helpers';
import { nextItemSeqNum } from '../agents/item-metadata';
import type { Session, AppMode } from '@pap/shared';

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmts = {
  // Sessions
  insertSession: db.prepare(
    `INSERT INTO sessions (id, item_id, agent_id, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ),
  getSession: db.prepare(
    `SELECT id, item_id, agent_id, mode, status, parent_session_id,
            workflow_context, intended_output, created_at, updated_at
     FROM sessions WHERE id = ?`
  ),
  findActiveSession: db.prepare(
    `SELECT id, item_id, agent_id, mode, status, parent_session_id,
            workflow_context, intended_output, created_at, updated_at
     FROM sessions WHERE item_id = ? AND mode = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`
  ),
  getActiveSessions: db.prepare(
    `SELECT id, item_id, agent_id, mode, status, parent_session_id,
            workflow_context, intended_output, created_at, updated_at
     FROM sessions WHERE status = 'active' ORDER BY created_at DESC`
  ),
  getSessionsByItem: db.prepare(
    `SELECT id, item_id, agent_id, mode, status, parent_session_id,
            workflow_context, intended_output, created_at, updated_at
     FROM sessions WHERE item_id = ? ORDER BY created_at DESC`
  ),
  getSessionIdsByItem: db.prepare(
    `SELECT id, mode FROM sessions WHERE item_id = ? ORDER BY created_at DESC`
  ),
  completeSession: db.prepare(
    `UPDATE sessions SET status = 'completed', updated_at = ? WHERE id = ?`
  ),
  deleteSession: db.prepare(
    `DELETE FROM sessions WHERE id = ?`
  ),
  updateWorkflow: db.prepare(
    `UPDATE sessions SET workflow_context = ?, updated_at = ? WHERE id = ?`
  ),

  // Artifacts
  insertArtifact: db.prepare(
    `INSERT INTO artifacts (session_id, type, file_path, status, created_at)
     VALUES (?, ?, ?, 'draft', ?)`
  ),
  getArtifacts: db.prepare(
    `SELECT type, file_path as filePath, created_at as createdAt
     FROM artifacts WHERE session_id = ? ORDER BY created_at DESC`
  ),
  getLatestArtifactByType: db.prepare(
    `SELECT a.file_path FROM artifacts a
     JOIN sessions s ON a.session_id = s.id
     WHERE s.item_id = ? AND a.type = ?
     ORDER BY a.created_at DESC LIMIT 1`
  ),

  // Items
  getItem: db.prepare(
    `SELECT id, source, title FROM items WHERE id = ?`
  ),
  upsertItem: db.prepare(
    `INSERT INTO items (id, type, title, description, status, source, airtable_id, seq_num, created_at, updated_at)
     VALUES (?, 'initiative', ?, NULL, 'active', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
  ),

  // Stats
  countSessions: db.prepare(`SELECT COUNT(*) as count FROM sessions`),
  countActiveSessions: db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE status = 'active'`),
  countItems: db.prepare(`SELECT COUNT(*) as count FROM items`),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  item_id: string;
  agent_id: string;
  mode: string;
  status: string;
  parent_session_id: string | null;
  workflow_context: string | null;
  intended_output: string | null;
  created_at: number;
  updated_at: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    itemId: row.item_id,
    type: (row.mode === 'prd' || row.mode === 'backlog') ? row.mode : 'prd',
    status: row.status as Session['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    agentId: row.agent_id,
    mode: row.mode as AppMode,
    workflowContext: row.workflow_context ?? undefined,
    parentSessionId: row.parent_session_id ?? undefined,
    intendedOutput: row.intended_output ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

class SessionStore {
  createSession(itemId: string, mode: AppMode | string, agentId: string): Session {
    const id = uuidv4();
    const now = Date.now();
    stmts.insertSession.run(id, itemId, agentId, mode, now, now);
    const row = stmts.getSession.get(id) as SessionRow;
    return rowToSession(row);
  }

  findActiveSession(itemId: string, mode: AppMode | string): Session | null {
    const row = stmts.findActiveSession.get(itemId, mode) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  getSession(sessionId: string): Session | undefined {
    const row = stmts.getSession.get(sessionId) as SessionRow | undefined;
    if (!row) return undefined;
    return rowToSession(row);
  }

  completeSession(sessionId: string): void {
    stmts.completeSession.run(Date.now(), sessionId);
  }

  deleteSession(sessionId: string): void {
    stmts.deleteSession.run(sessionId);
  }

  getActiveSessions(): Session[] {
    const rows = stmts.getActiveSessions.all() as SessionRow[];
    return rows.map(r => rowToSession(r));
  }

  getSessionsByItem(itemId: string): Session[] {
    const rows = stmts.getSessionsByItem.all(itemId) as SessionRow[];
    return rows.map(r => rowToSession(r));
  }

  getSessionIdsByItem(itemId: string): Array<{ id: string; mode: string }> {
    return stmts.getSessionIdsByItem.all(itemId) as Array<{ id: string; mode: string }>;
  }

  // Workflow state

  updateWorkflow(sessionId: string, _activeWorkflow: string | undefined, workflowContext: string | undefined): void {
    stmts.updateWorkflow.run(workflowContext ?? null, Date.now(), sessionId);
  }

  updateConversationPath(_sessionId: string, _conversationPath: string): void {
    // conversation_path is not in the DB schema — no-op
  }

  // Artifacts

  addArtifact(sessionId: string, type: string, filePath: string): void {
    stmts.insertArtifact.run(sessionId, type, filePath, Date.now());
  }

  getArtifacts(sessionId: string): Array<{ type: string; filePath: string; createdAt: number }> {
    return stmts.getArtifacts.all(sessionId) as Array<{ type: string; filePath: string; createdAt: number }>;
  }

  getLatestPrdArtifactPath(itemId: string): string | null {
    const row = stmts.getLatestArtifactByType.get(itemId, 'prd') as { file_path: string } | undefined;
    return row ? resolveArtifactPath(row.file_path) : null;
  }

  getLatestAnalystArtifactPath(itemId: string): string | null {
    const row = stmts.getLatestArtifactByType.get(itemId, 'analyst') as { file_path: string } | undefined;
    return row ? resolveArtifactPath(row.file_path) : null;
  }

  // Items

  upsertItem(itemId: string, title: string, source: string, sourceId?: string): void {
    const now = Date.now();
    stmts.upsertItem.run(itemId, title, source, sourceId ?? null, nextItemSeqNum(), now, now);
  }

  getItemSource(itemId: string): string | null {
    const row = stmts.getItem.get(itemId) as { id: string; source: string; title: string } | undefined;
    return row?.source ?? null;
  }

  getItemTitle(itemId: string): string | null {
    const row = stmts.getItem.get(itemId) as { id: string; source: string; title: string } | undefined;
    return row?.title ?? null;
  }

  // Stats

  getStats() {
    const total = (stmts.countSessions.get() as { count: number }).count;
    const active = (stmts.countActiveSessions.get() as { count: number }).count;
    const items = (stmts.countItems.get() as { count: number }).count;
    return { totalSessions: total, activeSessions: active, totalItems: items };
  }
}

export const sessionStore = new SessionStore();
