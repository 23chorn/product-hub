import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

import db from '../../app/backend/src/data/database';
import { getCandidateItems, filterCompleted } from '../../app/backend/src/routes/completed-initiatives-routes';

let seq = 0;

function seedItem(opts: { status?: string } = {}): string {
  const id = `itm-${++seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at) VALUES (?, 'initiative', ?, ?, 'local', ?, ?)`
  ).run(id, `Item ${id}`, opts.status ?? 'active', now, now);
  return id;
}

function seedWorkflow(itemId: string, opts: { status?: string } = {}): string {
  const id = `wf-${++seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, current_stage, created_at, updated_at) VALUES (?, ?, 'goal', ?, NULL, ?, ?)`
  ).run(id, itemId, opts.status ?? 'complete', now, now);
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
