import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Redirect the database singleton to a fresh in-memory DB carrying the real
// (migration-built) schema. Vitest resolves this to the same module the source
// imports as '../data/database', so every importer binds to this instance.
vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return {
    default: db,
    getPolicies: (scope: string) =>
      db.prepare('SELECT rule_key, rule_value FROM policies WHERE scope = ?').all(scope),
    DATA_DIR: '/tmp/product-hub-test-data',
  };
});

import db from '../../app/backend/src/data/database';
import { createWorkflow, completeStage } from '../../app/backend/src/agents/workflow-router';

function seedItem(id: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at)
     VALUES (?, 'initiative', ?, 'active', 'quick_add', ?, ?)`
  ).run(id, `Item ${id}`, now, now);
}

function seedActiveWorkflow(id: string, itemId: string, stage: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, current_stage, created_at, updated_at)
     VALUES (?, ?, 'goal', 'active', ?, ?, ?)`
  ).run(id, itemId, stage, now, now);
}

afterEach(() => {
  db.prepare('DELETE FROM checkpoints').run();
  db.prepare('DELETE FROM policies').run();
  db.prepare('DELETE FROM workflows').run();
  db.prepare('DELETE FROM items').run();
});

describe('createWorkflow', () => {
  // createWorkflow schedules a 30s LLM summary via setTimeout; fake timers keep it
  // from ever firing (and hitting the network) during the test.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('persists the stage sequence, policy overrides, and item link', () => {
    seedItem('itm-1');
    const wf = createWorkflow('itm-1', 'Build a thing', ['analyst', 'pm_prd', 'solution_architect'], {
      'model:analyst': 'claude-opus-4-8',
    });

    expect(wf.item_id).toBe('itm-1');
    expect(wf.goal).toBe('Build a thing');
    expect(wf.status).toBe('active');
    expect(JSON.parse(wf.stage_sequence)).toEqual(['analyst', 'pm_prd', 'solution_architect']);
    expect(JSON.parse(wf.policy_overrides)).toEqual({ 'model:analyst': 'claude-opus-4-8' });

    const row = db.prepare('SELECT id FROM workflows WHERE id = ?').get(wf.id) as { id: string };
    expect(row.id).toBe(wf.id);
  });

  it('defaults policy overrides to an empty object when none are given', () => {
    seedItem('itm-4');
    const wf = createWorkflow('itm-4', 'goal', ['analyst']);
    expect(JSON.parse(wf.policy_overrides)).toEqual({});
  });
});

describe('completeStage', () => {
  it('creates a pending checkpoint and pauses the workflow at the checkpoint', () => {
    seedItem('itm-c1');
    seedActiveWorkflow('wf-c1', 'itm-c1', 'pm_prd');

    completeStage('wf-c1');

    const cp = db.prepare(
      `SELECT stage, status FROM checkpoints WHERE workflow_id = ?`
    ).get('wf-c1') as { stage: string; status: string };
    expect(cp).toMatchObject({ stage: 'pm_prd', status: 'pending' });

    const wf = db.prepare('SELECT status FROM workflows WHERE id = ?').get('wf-c1') as { status: string };
    expect(wf.status).toBe('paused_at_checkpoint');
  });

  it('throws when the workflow does not exist', () => {
    expect(() => completeStage('nope')).toThrow(/Workflow not found/);
  });

  it('throws when the workflow is not active', () => {
    seedItem('itm-c2');
    const now = Date.now();
    db.prepare(
      `INSERT INTO workflows (id, item_id, goal, status, current_stage, created_at, updated_at)
       VALUES ('wf-c2', 'itm-c2', 'goal', 'paused_at_checkpoint', 'pm_prd', ?, ?)`
    ).run(now, now);
    expect(() => completeStage('wf-c2')).toThrow(/not active/);
  });
});
