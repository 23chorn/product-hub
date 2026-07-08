import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

const sumEffortFields = vi.hoisted(() => vi.fn());
const updateWorkItem = vi.hoisted(() => vi.fn());
vi.mock('../../app/backend/src/integrations/azure-devops', () => ({
  getAzureDevOpsClient: () => ({ sumEffortFields, updateWorkItem }),
}));

import db from '../../app/backend/src/data/database';
import {
  recalculateFeatureEffort,
  recalculateEpicEffort,
  recalculateEffortRollupChain,
} from '../../app/backend/src/agents/effort-rollup';

let seq = 0;

function seedWorkflow(): string {
  const workflowId = `wf-${++seq}`;
  const itemId = `itm-${seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at) VALUES (?, 'initiative', ?, 'active', 'local', ?, ?)`
  ).run(itemId, `Item ${itemId}`, now, now);
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, current_stage, created_at, updated_at) VALUES (?, ?, 'goal', 'complete', NULL, ?, ?)`
  ).run(workflowId, itemId, now, now);
  return workflowId;
}

function seedMapping(
  workflowId: string,
  localKey: string,
  adoId: number,
  adoType: 'epic' | 'feature' | 'story',
  parentLocalKey: string | null = null,
): void {
  db.prepare(
    `INSERT INTO ado_work_item_map (workflow_id, ado_id, ado_type, ado_url, local_key, parent_local_key, title, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(workflowId, adoId, adoType, `https://example/${adoId}`, localKey, parentLocalKey, `Title ${localKey}`, Date.now());
}

beforeEach(() => {
  sumEffortFields.mockReset();
  updateWorkItem.mockReset();
  db.prepare('DELETE FROM ado_work_item_map').run();
  db.prepare('DELETE FROM workflows').run();
  db.prepare('DELETE FROM items').run();
});

describe('recalculateFeatureEffort', () => {
  it('sums the feature\'s current child stories and writes the total to its Effort field', async () => {
    const workflowId = seedWorkflow();
    seedMapping(workflowId, 'F1', 200, 'feature', 'epic');
    seedMapping(workflowId, 'F1.S1', 201, 'story', 'F1');
    seedMapping(workflowId, 'F1.S2', 202, 'story', 'F1');
    sumEffortFields.mockResolvedValue(8);

    const total = await recalculateFeatureEffort(workflowId, 'F1');

    expect(sumEffortFields).toHaveBeenCalledWith(expect.arrayContaining([201, 202]));
    expect(updateWorkItem).toHaveBeenCalledWith(200, { effort: 8 });
    expect(total).toBe(8);
  });

  it('returns null when the feature has no ADO mapping', async () => {
    const workflowId = seedWorkflow();
    const total = await recalculateFeatureEffort(workflowId, 'F1');
    expect(total).toBeNull();
    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it('sums to 0 (not skipped) when a feature has no remaining stories', async () => {
    const workflowId = seedWorkflow();
    seedMapping(workflowId, 'F1', 200, 'feature', 'epic');
    sumEffortFields.mockResolvedValue(0);

    const total = await recalculateFeatureEffort(workflowId, 'F1');

    expect(sumEffortFields).toHaveBeenCalledWith([]);
    expect(updateWorkItem).toHaveBeenCalledWith(200, { effort: 0 });
    expect(total).toBe(0);
  });
});

describe('recalculateEpicEffort', () => {
  it('sums the epic\'s current child features and writes the total to its Effort field', async () => {
    const workflowId = seedWorkflow();
    seedMapping(workflowId, 'epic', 100, 'epic', null);
    seedMapping(workflowId, 'F1', 200, 'feature', 'epic');
    seedMapping(workflowId, 'F2', 201, 'feature', 'epic');
    sumEffortFields.mockResolvedValue(21);

    const total = await recalculateEpicEffort(workflowId, 'epic');

    expect(sumEffortFields).toHaveBeenCalledWith(expect.arrayContaining([200, 201]));
    expect(updateWorkItem).toHaveBeenCalledWith(100, { effort: 21 });
    expect(total).toBe(21);
  });

  it('returns null when the epic has no ADO mapping', async () => {
    const workflowId = seedWorkflow();
    const total = await recalculateEpicEffort(workflowId, 'epic');
    expect(total).toBeNull();
  });
});

describe('recalculateEffortRollupChain', () => {
  it('recalculates the feature then cascades to its parent epic', async () => {
    const workflowId = seedWorkflow();
    seedMapping(workflowId, 'epic', 100, 'epic', null);
    seedMapping(workflowId, 'F1', 200, 'feature', 'epic');
    seedMapping(workflowId, 'F1.S1', 201, 'story', 'F1');
    sumEffortFields.mockResolvedValueOnce(5); // feature's story sum
    sumEffortFields.mockResolvedValueOnce(5); // epic's feature sum

    await recalculateEffortRollupChain(workflowId, 'F1');

    expect(updateWorkItem).toHaveBeenCalledWith(200, { effort: 5 }); // feature
    expect(updateWorkItem).toHaveBeenCalledWith(100, { effort: 5 }); // epic
  });

  it('does not attempt an epic update when the feature has no parent mapped', async () => {
    const workflowId = seedWorkflow();
    seedMapping(workflowId, 'F1', 200, 'feature', null);
    sumEffortFields.mockResolvedValue(3);

    await recalculateEffortRollupChain(workflowId, 'F1');

    expect(updateWorkItem).toHaveBeenCalledTimes(1);
    expect(updateWorkItem).toHaveBeenCalledWith(200, { effort: 3 });
  });

  it('swallows errors instead of throwing', async () => {
    const workflowId = seedWorkflow();
    seedMapping(workflowId, 'F1', 200, 'feature', 'epic');
    sumEffortFields.mockRejectedValue(new Error('ADO is down'));

    await expect(recalculateEffortRollupChain(workflowId, 'F1')).resolves.toBeUndefined();
  });
});
