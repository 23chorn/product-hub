import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { CoordinatorAgent } from '../../app/backend/src/agents/coordinator-agent';

function seedWorkflow(id: string, goal: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at)
     VALUES (?, 'initiative', 'Item', 'active', 'quick_add', ?, ?)`
  ).run(`item-${id}`, now, now);
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, `item-${id}`, goal, now, now);
}

describe('CoordinatorAgent.generateRevisionBrief', () => {
  let coordinator: CoordinatorAgent;

  beforeEach(() => { coordinator = new CoordinatorAgent(); });
  afterEach(() => {
    db.prepare('DELETE FROM workflows').run();
    db.prepare('DELETE FROM items').run();
  });

  it('embeds the workflow goal, the stage label, and a numbered issue list', () => {
    seedWorkflow('wf-1', 'Ship faster checkout');
    const brief = coordinator.generateRevisionBrief('wf-1', 'pm_prd', 'prior draft', [
      'Missing success metrics',
      'No rollback plan',
    ]);

    expect(brief).toContain('# Revision Required: Product Requirements Document (Rex)');
    expect(brief).toContain('Ship faster checkout');
    expect(brief).toContain('1. Missing success metrics');
    expect(brief).toContain('2. No rollback plan');
    // The surgical-edit guardrails must be present.
    expect(brief).toContain('TARGETED EDIT');
    expect(brief).toContain('## Required Output Format');
  });

  it('falls back to a placeholder goal when the workflow is unknown', () => {
    const brief = coordinator.generateRevisionBrief('does-not-exist', 'analyst', 'draft', ['x']);
    expect(brief).toContain('(workflow goal not found)');
    expect(brief).toContain('# Revision Required: Research Brief (Sage)');
  });

  it('uses a generic label/format for a stage with no format spec', () => {
    seedWorkflow('wf-2', 'goal');
    const brief = coordinator.generateRevisionBrief('wf-2', 'mystery_stage', 'draft', ['issue']);
    expect(brief).toContain('# Revision Required: mystery_stage');
    expect(brief).toContain('(no format specification defined for this stage)');
  });
});
