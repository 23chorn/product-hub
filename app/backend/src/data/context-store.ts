import db from './database';
import type { ContextChangeProposal } from '@pap/shared';

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmts = {
  // Snapshots (item_status_snapshots)
  getAllSnapshots: db.prepare(
    `SELECT airtable_id as airtableId, title, status, last_checked as lastChecked
     FROM item_status_snapshots`
  ),
  upsertSnapshot: db.prepare(
    `INSERT INTO item_status_snapshots (airtable_id, title, status, last_checked)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(airtable_id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       last_checked = excluded.last_checked`
  ),

  // Proposals (context_change_proposals)
  insertProposal: db.prepare(
    `INSERT INTO context_change_proposals (session_id, file_name, section_hint, proposed_text, rationale, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ),
  getPendingProposals: db.prepare(
    `SELECT id, session_id as sessionId, file_name as fileName,
            section_hint as sectionHint, proposed_text as proposedText,
            rationale, status, created_at as createdAt, reviewed_at as reviewedAt
     FROM context_change_proposals WHERE status = 'pending'
     ORDER BY created_at ASC`
  ),
  updateProposalStatus: db.prepare(
    `UPDATE context_change_proposals SET status = ?, reviewed_at = ? WHERE id = ?`
  ),
  countPending: db.prepare(
    `SELECT COUNT(*) as count FROM context_change_proposals WHERE status = 'pending'`
  ),
};

// ---------------------------------------------------------------------------
// ContextStore
// ---------------------------------------------------------------------------

interface SnapshotRow {
  airtableId: string;
  title: string;
  status: string;
  lastChecked: number;
}

class ContextStore {
  // Snapshots

  getAllSnapshots(): SnapshotRow[] {
    return stmts.getAllSnapshots.all() as SnapshotRow[];
  }

  upsertSnapshot(airtableId: string, title: string, status: string): void {
    stmts.upsertSnapshot.run(airtableId, title, status, Date.now());
  }

  // Proposals

  insertProposal(
    sessionId: string,
    fileName: string,
    sectionHint: string | null,
    proposedText: string,
    rationale: string
  ): void {
    stmts.insertProposal.run(sessionId, fileName, sectionHint, proposedText, rationale, Date.now());
  }

  getPendingProposals(): ContextChangeProposal[] {
    return stmts.getPendingProposals.all() as ContextChangeProposal[];
  }

  updateProposalStatus(id: number, status: 'confirmed' | 'dismissed'): void {
    stmts.updateProposalStatus.run(status, Date.now(), id);
  }

  getPendingCount(): number {
    const row = stmts.countPending.get() as { count: number };
    return row.count;
  }
}

export const contextStore = new ContextStore();
