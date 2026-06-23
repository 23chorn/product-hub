import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Back the database module with a fresh in-memory DB carrying the real schema.
// change-request.ts builds its prepared statements at import time, so this mock
// must be in place before that import runs (vi.mock is hoisted above it).
vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return {
    default: db,
    getPolicies: (scope: string) =>
      db.prepare('SELECT rule_key, rule_value FROM policies WHERE scope = ?').all(scope),
  };
});

import db from '../../app/backend/src/data/database';
import {
  createChangeRequest,
  getChangeRequest,
  listChangeRequests,
  cancelChangeRequest,
  linkCRArtifactVersion,
  completeChangeRequest,
} from '../../app/backend/src/agents/change-request';

let itemSeq = 0;

/** Seed a workflow (and its item) with the given status; returns the workflow id. */
function seedWorkflow(id: string, status = 'complete'): string {
  const itemId = `itm-${++itemSeq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at)
     VALUES (?, 'initiative', 'Item', 'active', 'airtable', ?, ?)`,
  ).run(itemId, now, now);
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, stage_sequence, created_at, updated_at)
     VALUES (?, ?, 'Ship it', ?, '["analyst","pm_prd"]', ?, ?)`,
  ).run(id, itemId, status, now, now);
  return itemId;
}

/** Seed an artifact (needs a session) so CR-version FKs resolve; returns artifact id. */
function seedArtifact(itemId: string): number {
  const sessionId = `sess-${itemId}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, item_id, agent_id, mode, created_at, updated_at)
     VALUES (?, ?, 'analyst', 'autonomous', ?, ?)`,
  ).run(sessionId, itemId, now, now);
  const res = db.prepare(
    `INSERT INTO artifacts (session_id, type, created_at) VALUES (?, 'prd', ?)`,
  ).run(sessionId, now);
  return res.lastInsertRowid as number;
}

function lastEvent(workflowId: string): { event_type: string; details: string | null } {
  return db
    .prepare(`SELECT event_type, details FROM workflow_events WHERE workflow_id = ? ORDER BY id DESC LIMIT 1`)
    .get(workflowId) as { event_type: string; details: string | null };
}

afterEach(() => {
  db.prepare('DELETE FROM cr_artifact_versions').run();
  db.prepare('DELETE FROM workflow_events').run();
  db.prepare('DELETE FROM change_requests').run();
  db.prepare('DELETE FROM artifacts').run();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM workflows').run();
  db.prepare('DELETE FROM items').run();
});

describe('createChangeRequest', () => {
  beforeEach(() => seedWorkflow('wf-1', 'complete'));

  it('creates a pending CR and emits a cr_created event', () => {
    const cr = createChangeRequest('wf-1', 'scope', 'Tighten the MVP scope');
    expect(cr).toMatchObject({ workflow_id: 'wf-1', type: 'scope', status: 'pending' });
    expect(cr.impact_assessment).toBeNull();

    const evt = lastEvent('wf-1');
    expect(evt.event_type).toBe('cr_created');
    expect(JSON.parse(evt.details!)).toMatchObject({ crId: cr.id, type: 'scope' });
  });

  it('rejects an unknown CR type', () => {
    expect(() => createChangeRequest('wf-1', 'bogus', 'x')).toThrow(/Invalid CR type/);
  });

  it('refuses to create a CR for a missing workflow', () => {
    expect(() => createChangeRequest('nope', 'scope', 'x')).toThrow(/Workflow not found/);
  });

  it('refuses to create a CR for a workflow that is not complete', () => {
    seedWorkflow('wf-active', 'active');
    expect(() => createChangeRequest('wf-active', 'scope', 'x')).toThrow(/is not complete/);
  });
});

describe('getChangeRequest / listChangeRequests', () => {
  beforeEach(() => seedWorkflow('wf-1', 'complete'));

  it('returns undefined for a missing CR', () => {
    expect(getChangeRequest(9999)).toBeUndefined();
  });

  it('lists a workflow\'s CRs newest-first', () => {
    // Advance the clock between creates so created_at differs and the DESC
    // ordering is exercised rather than an insertion-order tiebreak.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const a = createChangeRequest('wf-1', 'scope', 'first');
      vi.setSystemTime(2_000_000);
      const b = createChangeRequest('wf-1', 'technical', 'second');
      const list = listChangeRequests('wf-1');
      expect(list.map(c => c.id)).toEqual([b.id, a.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('scopes the list to the given workflow', () => {
    seedWorkflow('wf-2', 'complete');
    createChangeRequest('wf-1', 'scope', 'belongs to 1');
    createChangeRequest('wf-2', 'scope', 'belongs to 2');
    expect(listChangeRequests('wf-2')).toHaveLength(1);
    expect(listChangeRequests('wf-2')[0].description).toBe('belongs to 2');
  });
});

describe('cancelChangeRequest', () => {
  beforeEach(() => seedWorkflow('wf-1', 'complete'));

  it('cancels a pending CR', () => {
    const cr = createChangeRequest('wf-1', 'scope', 'x');
    cancelChangeRequest(cr.id);
    expect(getChangeRequest(cr.id)!.status).toBe('cancelled');
  });

  it('throws for a missing CR', () => {
    expect(() => cancelChangeRequest(4242)).toThrow(/Change request not found/);
  });

  it('refuses to cancel a CR that is already complete', () => {
    const cr = createChangeRequest('wf-1', 'scope', 'x');
    db.prepare('UPDATE change_requests SET status = ? WHERE id = ?').run('complete', cr.id);
    expect(() => cancelChangeRequest(cr.id)).toThrow(/Cannot cancel/);
  });
});

describe('linkCRArtifactVersion', () => {
  it('versions artifacts per stage, incrementing on each link', () => {
    const itemId = seedWorkflow('wf-1', 'complete');
    const cr = createChangeRequest('wf-1', 'scope', 'x');
    const a1 = seedArtifact(itemId);
    const a2 = seedArtifact(itemId);

    linkCRArtifactVersion(cr.id, 'pm_prd', a1, null);
    linkCRArtifactVersion(cr.id, 'pm_prd', a2, a1);

    const rows = db
      .prepare(`SELECT stage, artifact_id, parent_artifact_id, version FROM cr_artifact_versions WHERE change_request_id = ? ORDER BY version ASC`)
      .all(cr.id) as Array<{ stage: string; artifact_id: number; parent_artifact_id: number | null; version: number }>;
    expect(rows).toEqual([
      { stage: 'pm_prd', artifact_id: a1, parent_artifact_id: null, version: 1 },
      { stage: 'pm_prd', artifact_id: a2, parent_artifact_id: a1, version: 2 },
    ]);
  });

  it('tracks versions independently per stage', () => {
    const itemId = seedWorkflow('wf-1', 'complete');
    const cr = createChangeRequest('wf-1', 'scope', 'x');
    const a1 = seedArtifact(itemId);
    const a2 = seedArtifact(itemId);

    linkCRArtifactVersion(cr.id, 'analyst', a1, null);
    linkCRArtifactVersion(cr.id, 'pm_prd', a2, null);

    const versionFor = (stage: string) =>
      (db
        .prepare(`SELECT version FROM cr_artifact_versions WHERE change_request_id = ? AND stage = ?`)
        .get(cr.id, stage) as { version: number }).version;
    expect(versionFor('analyst')).toBe(1);
    expect(versionFor('pm_prd')).toBe(1);
  });
});

describe('completeChangeRequest', () => {
  it('marks the CR complete, keeps the workflow complete, and emits a cr_complete event', () => {
    seedWorkflow('wf-1', 'complete');
    const cr = createChangeRequest('wf-1', 'scope', 'x');
    db.prepare('UPDATE change_requests SET status = ? WHERE id = ?').run('in_progress', cr.id);

    completeChangeRequest(cr.id, 'wf-1');

    expect(getChangeRequest(cr.id)!.status).toBe('complete');
    const wf = db.prepare('SELECT status FROM workflows WHERE id = ?').get('wf-1') as { status: string };
    expect(wf.status).toBe('complete');
    expect(lastEvent('wf-1').event_type).toBe('cr_complete');
  });
});
