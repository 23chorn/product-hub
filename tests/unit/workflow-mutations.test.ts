import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Real schema in-memory DB.
vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return {
    default: db,
    getPolicies: (scope: string) =>
      db.prepare('SELECT rule_key, rule_value FROM policies WHERE scope = ?').all(scope),
  };
});

// Neutralize the LLM/async tail: every mutation ends by firing runAutonomousStage
// (fire-and-forget) after building a coordinator brief and a specialist session.
// We only care about the synchronous DB state machine, so stub all of it.
const runAutonomousStage = vi.hoisted(() => vi.fn(async () => {}));
const coordinator = vi.hoisted(() => ({
  generateStageBrief: vi.fn(async () => 'stage brief'),
  generateRevisionBrief: vi.fn(() => 'revision brief'),
  generateCRBrief: vi.fn(() => 'cr brief'),
}));
const clearCancelFlag = vi.hoisted(() => vi.fn());

vi.mock('../../app/backend/src/agents/workflow-stage-runner', () => ({
  runAutonomousStage,
  getCoordinator: () => coordinator,
  SILENT_STAGES: new Set<string>(['curator']),
  clearCancelFlag,
}));

const createSpecialistSession = vi.hoisted(() => vi.fn(() => ({ id: 'sess-stub' })));
vi.mock('../../app/backend/src/session/session-manager', () => ({
  sessionManager: {
    createSpecialistSession,
    updateWorkflow: vi.fn(),
  },
}));

// Artifact loads hit disk/wiki — stub to "no prior draft" so the from-scratch brief
// path runs without I/O. (The prior-draft threading itself is covered elsewhere.)
vi.mock('../../app/backend/src/agents/artifact-helpers', () => ({
  loadArtifactContentById: vi.fn(async () => undefined),
  loadLatestArtifactContent: vi.fn(async () => undefined),
  resolveArtifactPath: (p: string) => p,
  isJsonArtifactContent: () => true,
}));

import db from '../../app/backend/src/data/database';
import {
  reiterateFromStage,
  retryCurrentStage,
  restartWorkflow,
} from '../../app/backend/src/agents/workflow-mutations';

let itemSeq = 0;

function seedWorkflow(
  id: string,
  opts: { status?: string; currentStage?: string | null; sequence?: string[]; decomp?: string | null } = {},
): string {
  const itemId = `itm-${++itemSeq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at)
     VALUES (?, 'initiative', 'Item', 'active', 'airtable', ?, ?)`,
  ).run(itemId, now, now);
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, current_stage, stage_sequence, decomposition_metadata, created_at, updated_at)
     VALUES (?, ?, 'Ship it', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, itemId, opts.status ?? 'complete', opts.currentStage ?? null,
    JSON.stringify(opts.sequence ?? ['analyst', 'pm_prd', 'solution_architect']),
    opts.decomp ?? null, now, now,
  );
  return itemId;
}

function addCheckpoint(workflowId: string, stage: string, status: string): number {
  const res = db.prepare(
    `INSERT INTO checkpoints (workflow_id, stage, status, created_at) VALUES (?, ?, ?, ?)`,
  ).run(workflowId, stage, status, Date.now());
  return res.lastInsertRowid as number;
}

function checkpointStatus(id: number): string {
  return (db.prepare('SELECT status FROM checkpoints WHERE id = ?').get(id) as { status: string }).status;
}

function events(workflowId: string): Array<{ event_type: string; stage: string | null }> {
  return db
    .prepare('SELECT event_type, stage FROM workflow_events WHERE workflow_id = ? ORDER BY id ASC')
    .all(workflowId) as Array<{ event_type: string; stage: string | null }>;
}

function workflowRow(id: string): { status: string; current_stage: string | null; stage_sequence: string; decomposition_metadata: string | null } {
  return db
    .prepare('SELECT status, current_stage, stage_sequence, decomposition_metadata FROM workflows WHERE id = ?')
    .get(id) as any;
}

beforeEach(() => {
  runAutonomousStage.mockClear();
  coordinator.generateStageBrief.mockClear();
  clearCancelFlag.mockClear();
  createSpecialistSession.mockClear();
});

afterEach(() => {
  for (const t of ['checkpoint_audit', 'context_diffs', 'ado_work_item_map', 'qa_test_plan_map', 'checkpoints', 'workflow_events', 'artifacts', 'sessions', 'workflows', 'items']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

describe('reiterateFromStage', () => {
  it('rejects a workflow that is not complete', async () => {
    seedWorkflow('wf-1', { status: 'active' });
    await expect(reiterateFromStage('wf-1', 'pm_prd', 'fix')).rejects.toThrow(/is not complete/);
  });

  it('rejects a stage outside the workflow sequence', async () => {
    seedWorkflow('wf-1', { status: 'complete' });
    await expect(reiterateFromStage('wf-1', 'nonexistent', 'fix')).rejects.toThrow(/not in the workflow/);
  });

  it('marks the from-stage and all downstream approved checkpoints as revised', async () => {
    seedWorkflow('wf-1', { status: 'complete', sequence: ['analyst', 'pm_prd', 'solution_architect'] });
    const upstream = addCheckpoint('wf-1', 'analyst', 'approved');     // before fromStage — untouched
    const fromCp = addCheckpoint('wf-1', 'pm_prd', 'approved');        // fromStage — revised
    const downstream = addCheckpoint('wf-1', 'solution_architect', 'approved'); // after — revised

    await reiterateFromStage('wf-1', 'pm_prd', 'tighten scope');

    expect(checkpointStatus(upstream)).toBe('approved');
    expect(checkpointStatus(fromCp)).toBe('revised');
    expect(checkpointStatus(downstream)).toBe('revised');

    const wf = workflowRow('wf-1');
    expect(wf.status).toBe('active');
    expect(wf.current_stage).toBe('pm_prd');
    expect(events('wf-1').some(e => e.event_type === 'reiteration' && e.stage === 'pm_prd')).toBe(true);
    expect(runAutonomousStage).toHaveBeenCalledOnce();
  });

  it('uses a provided brief override instead of calling the coordinator', async () => {
    seedWorkflow('wf-1', { status: 'complete' });
    await reiterateFromStage('wf-1', 'pm_prd', 'fix', 'CUSTOM BRIEF');
    expect(coordinator.generateStageBrief).not.toHaveBeenCalled();
  });
});

describe('retryCurrentStage', () => {
  it('rejects a workflow that is neither active nor paused', async () => {
    seedWorkflow('wf-1', { status: 'complete', currentStage: 'pm_prd' });
    await expect(retryCurrentStage('wf-1')).rejects.toThrow(/cannot be retried/);
  });

  it('rejects when there is no current stage', async () => {
    seedWorkflow('wf-1', { status: 'active', currentStage: null });
    await expect(retryCurrentStage('wf-1')).rejects.toThrow(/No current stage/);
  });

  it('dismisses the pending checkpoint and emits retry + progress events', async () => {
    seedWorkflow('wf-1', { status: 'active', currentStage: 'pm_prd' });
    const pending = addCheckpoint('wf-1', 'pm_prd', 'pending');

    const result = await retryCurrentStage('wf-1', { id: 7, name: 'Alice', username: 'alice' });

    expect(result).toEqual({ stage: 'pm_prd' });
    expect(checkpointStatus(pending)).toBe('revised');
    const evts = events('wf-1');
    expect(evts.some(e => e.event_type === 'stage_retried' && e.stage === 'pm_prd')).toBe(true);
    expect(evts.some(e => e.event_type === 'stage_progress' && e.stage === 'pm_prd')).toBe(true);
    expect(runAutonomousStage).toHaveBeenCalledOnce();
  });

  it('retries every member of a multi-feature wave, not just the current stage', async () => {
    const decomp = JSON.stringify({
      featureCount: 2,
      waves: [['story_decomposition_F1', 'story_decomposition_F2']],
    });
    seedWorkflow('wf-1', {
      status: 'active',
      currentStage: 'story_decomposition_F1',
      sequence: ['story_decomposition_F1', 'story_decomposition_F2'],
      decomp,
    });

    await retryCurrentStage('wf-1');

    // Both wave members get their own autonomous run.
    expect(runAutonomousStage).toHaveBeenCalledTimes(2);
    const retried = events('wf-1').filter(e => e.event_type === 'stage_retried').map(e => e.stage);
    expect(retried).toEqual(['story_decomposition_F1', 'story_decomposition_F2']);
  });
});

describe('restartWorkflow', () => {
  it('wipes prior checkpoints/events, clears the cancel flag, and resets to the first stage', async () => {
    seedWorkflow('wf-1', { status: 'active', currentStage: 'solution_architect', sequence: ['analyst', 'pm_prd', 'solution_architect'] });
    addCheckpoint('wf-1', 'analyst', 'approved');
    addCheckpoint('wf-1', 'pm_prd', 'approved');
    db.prepare(`INSERT INTO workflow_events (workflow_id, event_type, stage, summary, created_at) VALUES ('wf-1','stage_progress','pm_prd','old',?)`).run(Date.now());

    await restartWorkflow('wf-1');

    // All prior checkpoints gone.
    const cpCount = (db.prepare('SELECT COUNT(*) c FROM checkpoints WHERE workflow_id = ?').get('wf-1') as { c: number }).c;
    expect(cpCount).toBe(0);

    // Cancel flag cleared and a fresh run fired from stage 0.
    expect(clearCancelFlag).toHaveBeenCalledWith('wf-1');
    const wf = workflowRow('wf-1');
    expect(wf.status).toBe('active');
    expect(wf.current_stage).toBe('analyst');

    // Old events were wiped; the restart narration is now present.
    const evts = events('wf-1');
    expect(evts.some(e => e.event_type === 'stage_progress' && e.stage === 'pm_prd')).toBe(false);
    expect(evts.some(e => e.event_type === 'workflow_started')).toBe(true);
    expect(runAutonomousStage).toHaveBeenCalledOnce();
  });

  it('drops the stale qa_test_plan_map row so a re-push starts a fresh ADO test plan', async () => {
    seedWorkflow('wf-1', { status: 'active', currentStage: 'solution_architect', sequence: ['analyst', 'pm_prd', 'solution_architect'] });
    db.prepare(`
      INSERT INTO qa_test_plan_map (workflow_id, plan_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
      VALUES ('wf-1', 999, 'https://dev.azure.com/org/proj/_testPlans/define?planId=999', '{}', '{}', 5, ?)
    `).run(Date.now());

    await restartWorkflow('wf-1');

    const row = db.prepare('SELECT * FROM qa_test_plan_map WHERE workflow_id = ?').get('wf-1');
    expect(row).toBeUndefined();
  });

  it('collapses leftover feature-wave stages back to a single placeholder', async () => {
    seedWorkflow('wf-1', {
      status: 'active',
      sequence: ['analyst', 'epic_feature_planner', 'story_decomposition_F1', 'story_decomposition_F2'],
      decomp: JSON.stringify({ featureCount: 2, waves: [] }),
    });

    await restartWorkflow('wf-1');

    const wf = workflowRow('wf-1');
    const seq: string[] = JSON.parse(wf.stage_sequence);
    // The F1/F2 wave stages collapse to a single story_decomposition entry.
    expect(seq.filter(s => s.startsWith('story_decomposition')).length).toBe(1);
    expect(wf.decomposition_metadata).toBeNull();
  });
});
