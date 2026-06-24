import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

const getWorkItemsBatch = vi.hoisted(() => vi.fn());
vi.mock('../../app/backend/src/integrations/azure-devops', () => ({
  getAzureDevOpsClient: () => ({ getWorkItemsBatch }),
}));

import db from '../../app/backend/src/data/database';
import { refreshItemAdoState } from '../../app/backend/src/integrations/ado-state-sync';

let seq = 0;

function seedItemWithWorkflow(): { itemId: string; workflowId: string } {
  const itemId = `itm-${++seq}`;
  const workflowId = `wf-${seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at) VALUES (?, 'initiative', ?, 'active', 'local', ?, ?)`
  ).run(itemId, `Item ${itemId}`, now, now);
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, current_stage, created_at, updated_at) VALUES (?, ?, 'goal', 'complete', NULL, ?, ?)`
  ).run(workflowId, itemId, now, now);
  return { itemId, workflowId };
}

function seedMapping(workflowId: string, localKey: string, adoId: number, adoType: 'epic' | 'feature' | 'story' = 'story'): void {
  db.prepare(
    `INSERT INTO ado_work_item_map (workflow_id, ado_id, ado_type, ado_url, local_key, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(workflowId, adoId, adoType, `https://example/${adoId}`, localKey, `Title ${localKey}`, Date.now());
}

beforeEach(() => {
  getWorkItemsBatch.mockReset();
  db.prepare('DELETE FROM ado_work_item_map').run();
  db.prepare('DELETE FROM workflows').run();
  db.prepare('DELETE FROM items').run();
});

describe('refreshItemAdoState', () => {
  it('writes state and state_synced_at for every matched row', async () => {
    const { itemId, workflowId } = seedItemWithWorkflow();
    seedMapping(workflowId, 'epic', 100, 'epic');
    seedMapping(workflowId, 'F1', 101, 'feature');
    seedMapping(workflowId, 'F1.S1', 102, 'story');

    getWorkItemsBatch.mockResolvedValue([
      { id: 100, fields: { 'System.State': 'Active' } },
      { id: 101, fields: { 'System.State': 'New' } },
      { id: 102, fields: { 'System.State': 'Closed' } },
    ]);

    const result = await refreshItemAdoState(itemId);
    expect(result).toEqual({ refreshed: 3, notFound: 0 });

    const rows = db.prepare('SELECT ado_id, state, state_synced_at FROM ado_work_item_map WHERE workflow_id = ? ORDER BY ado_id').all(workflowId) as Array<{ ado_id: number; state: string | null; state_synced_at: number | null }>;
    expect(rows.map(r => r.state)).toEqual(['Active', 'New', 'Closed']);
    expect(rows.every(r => typeof r.state_synced_at === 'number')).toBe(true);
  });

  it('counts a missing id as notFound and leaves its row unsynced', async () => {
    const { itemId, workflowId } = seedItemWithWorkflow();
    seedMapping(workflowId, 'F1.S1', 200);
    seedMapping(workflowId, 'F1.S2', 201);

    getWorkItemsBatch.mockResolvedValue([{ id: 200, fields: { 'System.State': 'Active' } }]);

    const result = await refreshItemAdoState(itemId);
    expect(result).toEqual({ refreshed: 1, notFound: 1 });

    const row201 = db.prepare('SELECT state FROM ado_work_item_map WHERE ado_id = 201').get() as { state: string | null };
    expect(row201.state).toBeNull();
  });

  it('returns zero counts and skips the ADO call when the item has no mapping rows', async () => {
    const { itemId } = seedItemWithWorkflow();
    const result = await refreshItemAdoState(itemId);
    expect(result).toEqual({ refreshed: 0, notFound: 0 });
    expect(getWorkItemsBatch).not.toHaveBeenCalled();
  });
});
