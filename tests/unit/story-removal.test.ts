import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

const deleteWorkItem = vi.hoisted(() => vi.fn());
const deleteTestCase = vi.hoisted(() => vi.fn());
vi.mock('../../app/backend/src/integrations/azure-devops', () => ({
  getAzureDevOpsClient: () => ({ deleteWorkItem, deleteTestCase }),
}));

const recalculateEffortRollupChain = vi.hoisted(() => vi.fn());
vi.mock('../../app/backend/src/agents/effort-rollup', () => ({
  recalculateEffortRollupChain,
}));

import db from '../../app/backend/src/data/database';
import {
  removeStoryFromMergedBacklog,
  deleteMergedBacklogStory,
  cascadeDeleteTestCases,
  pruneMergedBacklogArtifact,
} from '../../app/backend/src/agents/story-removal';

describe('removeStoryFromMergedBacklog', () => {
  const backlog = JSON.stringify({
    epic: { title: 'Epic' },
    features: [
      { title: 'Feature 1', stories: [{ story_id: 'F1.S1', title: 'A' }, { story_id: 'F1.S2', title: 'B' }] },
      { title: 'Feature 2', stories: [{ story_id: 'F2.S1', title: 'C' }] },
    ],
  });

  it('removes the matching story from the correct feature by positional key', () => {
    const updated = removeStoryFromMergedBacklog(backlog, 'F1', 'F1.S2');
    expect(updated).not.toBeNull();
    const parsed = JSON.parse(updated!);
    expect(parsed.features[0].stories.map((s: any) => s.story_id)).toEqual(['F1.S1']);
    expect(parsed.features[1].stories).toHaveLength(1);
  });

  it('returns null when the feature key does not exist', () => {
    expect(removeStoryFromMergedBacklog(backlog, 'F9', 'F1.S1')).toBeNull();
  });

  it('returns null when the story id does not exist under that feature', () => {
    expect(removeStoryFromMergedBacklog(backlog, 'F1', 'F1.S9')).toBeNull();
  });

  it('returns null for unparseable content', () => {
    expect(removeStoryFromMergedBacklog('not json', 'F1', 'F1.S1')).toBeNull();
  });
});

describe('deleteMergedBacklogStory', () => {
  let seq = 0;

  beforeEach(() => {
    deleteWorkItem.mockReset();
    deleteTestCase.mockReset();
    recalculateEffortRollupChain.mockReset();
    db.prepare('DELETE FROM ado_work_item_map').run();
    db.prepare('DELETE FROM artifacts').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM workflows').run();
    db.prepare('DELETE FROM items').run();
  });

  function seedItemAndWorkflow(): { itemId: string; workflowId: string } {
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

  it('deletes the ADO work item, cascades, and recalculates effort when the story was already pushed', async () => {
    const { itemId, workflowId } = seedItemAndWorkflow();
    db.prepare(
      `INSERT INTO ado_work_item_map (workflow_id, ado_id, ado_type, ado_url, local_key, parent_local_key, title, created_at)
       VALUES (?, 500, 'story', 'https://example/500', 'F1.S1', 'F1', 'Title', ?)`
    ).run(workflowId, Date.now());
    deleteWorkItem.mockResolvedValue(undefined);

    await deleteMergedBacklogStory(workflowId, itemId, 'F1', 'F1.S1');

    expect(deleteWorkItem).toHaveBeenCalledWith(500);
    expect(recalculateEffortRollupChain).toHaveBeenCalledWith(workflowId, 'F1');
    const remaining = db.prepare(`SELECT * FROM ado_work_item_map WHERE workflow_id = ?`).all(workflowId);
    expect(remaining).toHaveLength(0);
  });

  it('is a no-op on the ADO side when the story was never pushed', async () => {
    const { itemId, workflowId } = seedItemAndWorkflow();

    await deleteMergedBacklogStory(workflowId, itemId, 'F1', 'F1.S1');

    expect(deleteWorkItem).not.toHaveBeenCalled();
    expect(recalculateEffortRollupChain).not.toHaveBeenCalled();
  });

  it('does not throw when the ADO delete call fails (best-effort)', async () => {
    const { itemId, workflowId } = seedItemAndWorkflow();
    db.prepare(
      `INSERT INTO ado_work_item_map (workflow_id, ado_id, ado_type, ado_url, local_key, parent_local_key, title, created_at)
       VALUES (?, 501, 'story', 'https://example/501', 'F1.S1', 'F1', 'Title', ?)`
    ).run(workflowId, Date.now());
    deleteWorkItem.mockRejectedValue(new Error('ADO unreachable'));

    await expect(deleteMergedBacklogStory(workflowId, itemId, 'F1', 'F1.S1')).resolves.toBeUndefined();
    // Local mapping row + effort rollup still get cleaned up despite the ADO failure.
    expect(recalculateEffortRollupChain).toHaveBeenCalledWith(workflowId, 'F1');
  });
});

describe('cascadeDeleteTestCases', () => {
  it('is a no-op when no story keys are affected', async () => {
    await expect(cascadeDeleteTestCases('wf-x', 'itm-x', new Set())).resolves.toBeUndefined();
    expect(deleteTestCase).not.toHaveBeenCalled();
  });
});

describe('pruneMergedBacklogArtifact', () => {
  it('is a no-op when both key sets are empty', async () => {
    await expect(pruneMergedBacklogArtifact('itm-x', new Set(), new Set())).resolves.toBeUndefined();
  });

  it('is a no-op when there is no merged backlog artifact for the item', async () => {
    db.prepare('DELETE FROM artifacts').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM ado_work_item_map').run();
    db.prepare('DELETE FROM workflows').run();
    db.prepare('DELETE FROM items').run();
    db.prepare(
      `INSERT INTO items (id, type, title, status, source, created_at, updated_at) VALUES ('itm-noartifact', 'initiative', 'Item', 'active', 'local', ?, ?)`
    ).run(Date.now(), Date.now());
    await expect(pruneMergedBacklogArtifact('itm-noartifact', new Set(['F1']), new Set())).resolves.toBeUndefined();
  });
});
