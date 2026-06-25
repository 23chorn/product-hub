import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

import db from '../../app/backend/src/data/database';
import {
  getCandidateItems,
  filterCompleted,
  getCompletedItemOrUndefined,
  computePercentComplete,
} from '../../app/backend/src/routes/completed-initiatives-routes';

function workItemRow(opts: { adoType: 'epic' | 'feature' | 'story'; state: string | null }) {
  return {
    itemId: 'itm-x',
    ado_id: Math.floor(Math.random() * 1_000_000),
    ado_type: opts.adoType,
    ado_url: null,
    local_key: 'F1',
    title: 'Row',
    state: opts.state,
    state_synced_at: opts.state != null ? Date.now() : null,
    artifact_id: null,
    created_at: Date.now(),
  };
}

let seq = 0;

function seedItem(opts: { status?: string; title?: string } = {}): string {
  const id = `itm-${++seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at) VALUES (?, 'initiative', ?, ?, 'local', ?, ?)`
  ).run(id, opts.title ?? `Item ${id}`, opts.status ?? 'active', now, now);
  return id;
}

function seedWorkflow(itemId: string, opts: { status?: string; summary?: string } = {}): string {
  const id = `wf-${++seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, summary, current_stage, created_at, updated_at) VALUES (?, ?, 'goal', ?, ?, NULL, ?, ?)`
  ).run(id, itemId, opts.status ?? 'complete', opts.summary ?? null, now, now);
  return id;
}

function seedMapping(workflowId: string): void {
  db.prepare(
    `INSERT INTO ado_work_item_map (workflow_id, ado_id, ado_type, ado_url, local_key, title, created_at) VALUES (?, ?, 'epic', ?, 'epic', 'Epic', ?)`
  ).run(workflowId, Math.floor(Math.random() * 1_000_000), 'https://example/epic', Date.now());
}

beforeEach(() => {
  db.prepare('DELETE FROM ado_work_item_map').run();
  db.prepare('DELETE FROM workflows').run();
  db.prepare('DELETE FROM items').run();
});

describe('completed-initiatives completion gate', () => {
  it('excludes an item whose latest workflow is not complete, even with ADO mapping rows', () => {
    const itemId = seedItem();
    const workflowId = seedWorkflow(itemId, { status: 'active' });
    seedMapping(workflowId);

    const completed = filterCompleted(getCandidateItems());
    expect(completed.map(c => c.id)).not.toContain(itemId);
  });

  it('excludes an item with zero ADO mapping rows, even when its workflow is complete', () => {
    const itemId = seedItem();
    seedWorkflow(itemId, { status: 'complete' });
    // No ado_work_item_map row seeded — never pushed to ADO.

    expect(getCandidateItems().map(c => c.id)).not.toContain(itemId);
  });

  it('includes an item that is both complete and pushed to ADO', () => {
    const itemId = seedItem();
    const workflowId = seedWorkflow(itemId, { status: 'complete' });
    seedMapping(workflowId);

    const completed = filterCompleted(getCandidateItems());
    expect(completed.map(c => c.id)).toContain(itemId);
  });
});

describe('completed-initiatives archive/unarchive gate', () => {
  it('excludes an archived item from the default (active) candidate list', () => {
    const itemId = seedItem({ status: 'archived' });
    const workflowId = seedWorkflow(itemId, { status: 'complete' });
    seedMapping(workflowId);

    expect(getCandidateItems().map(c => c.id)).not.toContain(itemId);
    expect(getCandidateItems(true).map(c => c.id)).toContain(itemId);
  });

  it('only finds an archived item via getCompletedItemOrUndefined when archived=true is passed', () => {
    const itemId = seedItem({ status: 'archived' });
    const workflowId = seedWorkflow(itemId, { status: 'complete' });
    seedMapping(workflowId);

    expect(getCompletedItemOrUndefined(itemId)).toBeUndefined();
    expect(getCompletedItemOrUndefined(itemId, true)?.id).toBe(itemId);
  });

  it('does not surface a non-archived item in the archived-only list', () => {
    const itemId = seedItem({ status: 'active' });
    const workflowId = seedWorkflow(itemId, { status: 'complete' });
    seedMapping(workflowId);

    expect(getCandidateItems(true).map(c => c.id)).not.toContain(itemId);
  });
});

describe('completed-initiatives display title', () => {
  it('prefers the latest workflow summary over the raw item title, matching the Home page', () => {
    const itemId = seedItem({ title: 'Limit Up & Down' });
    const workflowId = seedWorkflow(itemId, { status: 'complete', summary: 'Display Limit Up Down on Trade Screen' });
    seedMapping(workflowId);

    expect(getCompletedItemOrUndefined(itemId)?.title).toBe('Display Limit Up Down on Trade Screen');
  });

  it('falls back to the raw item title when the workflow has no AI-generated summary', () => {
    const itemId = seedItem({ title: 'Limit Up & Down' });
    const workflowId = seedWorkflow(itemId, { status: 'complete' });
    seedMapping(workflowId);

    expect(getCompletedItemOrUndefined(itemId)?.title).toBe('Limit Up & Down');
  });
});

describe('computePercentComplete', () => {
  it('averages over stories, ignoring the epic row entirely', () => {
    const rows = [
      workItemRow({ adoType: 'epic', state: 'Active' }),
      workItemRow({ adoType: 'story', state: 'Done' }),
      workItemRow({ adoType: 'story', state: 'New' }),
    ];
    // Done=100, New=0 → average 50, regardless of the epic's own state.
    expect(computePercentComplete(rows)).toBe(50);
  });

  it('falls back to feature rows when an initiative has no stories', () => {
    const rows = [
      workItemRow({ adoType: 'epic', state: 'Active' }),
      workItemRow({ adoType: 'feature', state: 'Active' }),
      workItemRow({ adoType: 'feature', state: 'Done' }),
    ];
    // Active=25, Done=100 → average 62.5, rounded to 63.
    expect(computePercentComplete(rows)).toBe(63);
  });

  it('returns null when nothing has synced yet', () => {
    const rows = [
      workItemRow({ adoType: 'story', state: null }),
      workItemRow({ adoType: 'story', state: null }),
    ];
    expect(computePercentComplete(rows)).toBeNull();
  });

  it('ignores unsynced stories but averages the ones that have synced', () => {
    const rows = [
      workItemRow({ adoType: 'story', state: 'Done' }),
      workItemRow({ adoType: 'story', state: null }),
    ];
    expect(computePercentComplete(rows)).toBe(100);
  });
});
