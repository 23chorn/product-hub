import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Back the database module with a fresh in-memory DB carrying the real schema.
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
import { getStatsDashboard } from '../../app/backend/src/agents/stats-db';

const DAY = 24 * 60 * 60 * 1000;
// Freeze time so threshold/age math is deterministic. All fixtures are seeded
// relative to this anchor.
const NOW = new Date('2026-06-01T00:00:00Z').getTime();
const ago = (days: number) => NOW - days * DAY;

let itemSeq = 0;
function addItem(opts: { shippedAt?: number } = {}): string {
  const id = `itm-${++itemSeq}`;
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, metadata, shipped_at, created_at, updated_at)
     VALUES (?, 'initiative', ?, 'active', 'airtable', NULL, ?, ?, ?)`,
  ).run(id, `Item ${id}`, opts.shippedAt ?? null, ago(30), ago(30));
  return id;
}

function addWorkflow(id: string, opts: { status?: string; createdAt?: number; policyOverrides?: string } = {}): void {
  const itemId = addItem();
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, current_stage, stage_sequence, policy_overrides, created_at, updated_at)
     VALUES (?, ?, 'Ship it', ?, NULL, '[]', ?, ?, ?)`,
  ).run(id, itemId, opts.status ?? 'complete', opts.policyOverrides ?? '{}', opts.createdAt ?? ago(12), NOW);
}

function addCheckpoint(opts: {
  workflowId: string; stage: string; status: string;
  createdAt: number; resolvedAt?: number | null; requiredRole?: string | null;
}): void {
  db.prepare(
    `INSERT INTO checkpoints (workflow_id, stage, status, required_role, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(opts.workflowId, opts.stage, opts.status, opts.requiredRole ?? null, opts.createdAt, opts.resolvedAt ?? null);
}

function addEvent(workflowId: string, eventType: string, opts: { stage?: string; createdAt?: number; details?: string } = {}): void {
  db.prepare(
    `INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
     VALUES (?, ?, ?, 'evt', ?, ?)`,
  ).run(workflowId, eventType, opts.stage ?? null, opts.details ?? null, opts.createdAt ?? ago(8));
}

function addChangeRequest(workflowId: string): void {
  db.prepare(
    `INSERT INTO change_requests (workflow_id, type, description, status, created_at, updated_at)
     VALUES (?, 'scope', 'change it', 'complete', ?, ?)`,
  ).run(workflowId, ago(5), ago(5));
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  // wf1 — real, completed, first-time approval at pm_prd, has a change request.
  addWorkflow('wf1', { status: 'complete', createdAt: ago(12) });
  addCheckpoint({ workflowId: 'wf1', stage: 'pm_prd', status: 'approved', createdAt: ago(10), resolvedAt: ago(9) });
  addEvent('wf1', 'workflow_complete', { createdAt: ago(8) });
  addChangeRequest('wf1');
  // Two LLM-timing samples for pm_prd (20s + 40s → avg 30s) plus a malformed one that must be skipped.
  addEvent('wf1', 'stage_completed', { stage: 'pm_prd', createdAt: ago(10), details: JSON.stringify({ llm_seconds: 20 }) });
  addEvent('wf1', 'stage_completed', { stage: 'pm_prd', createdAt: ago(10), details: JSON.stringify({ llm_seconds: 40 }) });
  addEvent('wf1', 'stage_completed', { stage: 'pm_prd', createdAt: ago(10), details: 'not json' });

  // wf2 — real, a revised-then-approved analyst stage (NOT first-time), plus a manual retry.
  addWorkflow('wf2', { status: 'complete', createdAt: ago(20) });
  addCheckpoint({ workflowId: 'wf2', stage: 'analyst', status: 'revised', createdAt: ago(15), resolvedAt: ago(14) });
  addCheckpoint({ workflowId: 'wf2', stage: 'analyst', status: 'approved', createdAt: ago(14), resolvedAt: ago(13) });
  addEvent('wf2', 'stage_retried', { stage: 'analyst', createdAt: ago(2), details: JSON.stringify({ name: 'Alice' }) });

  // wf3 — real, a rejected solution_architect decision.
  addWorkflow('wf3', { status: 'complete', createdAt: ago(11) });
  addCheckpoint({ workflowId: 'wf3', stage: 'solution_architect', status: 'rejected', createdAt: ago(9), resolvedAt: ago(8) });

  // wf-curator — curator stage is excluded from quality metrics entirely.
  addWorkflow('wf-curator', { status: 'complete', createdAt: ago(10) });
  addCheckpoint({ workflowId: 'wf-curator', stage: 'curator', status: 'approved', createdAt: ago(9), resolvedAt: ago(9) });

  // wf-stuck — active, a pending checkpoint open far beyond the 24h floor.
  addWorkflow('wf-stuck', { status: 'paused_at_checkpoint', createdAt: ago(5) });
  addCheckpoint({ workflowId: 'wf-stuck', stage: 'pm_prd', status: 'pending', createdAt: ago(5), requiredRole: '["pm"]' });

  // wf-demo — demo workflow, must be excluded from every metric.
  addWorkflow('wf-demo', { status: 'active', createdAt: ago(6), policyOverrides: '{"demo_mode":true}' });
  addCheckpoint({ workflowId: 'wf-demo', stage: 'pm_prd', status: 'approved', createdAt: ago(5), resolvedAt: ago(5) });
  addEvent('wf-demo', 'workflow_complete', { createdAt: ago(4) });
  // A demo LLM-timing sample that must NOT pollute the pm_prd average.
  addEvent('wf-demo', 'stage_completed', { stage: 'pm_prd', createdAt: ago(5), details: JSON.stringify({ llm_seconds: 999 }) });

  // wf-cancelled — cancelled workflow, must be excluded from every metric.
  addWorkflow('wf-cancelled', { status: 'active', createdAt: ago(7) });
  addCheckpoint({ workflowId: 'wf-cancelled', stage: 'pm_prd', status: 'approved', createdAt: ago(6), resolvedAt: ago(6) });
  addEvent('wf-cancelled', 'workflow_cancelled', { createdAt: ago(5) });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('getStatsDashboard', () => {
  let dash: ReturnType<typeof getStatsDashboard>;
  beforeEach(() => { dash = getStatsDashboard(90); });

  it('counts only active, non-demo, non-cancelled workflows as WIP', () => {
    // Only wf-stuck is active and not excluded; wf-demo and wf-cancelled are active but filtered out.
    expect(dash.wip.active).toBe(1);
    expect(dash.wip.oldestActiveAgeDays).toBe(5);
  });

  it('computes first-time-approval and revision rates, excluding curator', () => {
    // Decisions in range: pm_prd (first-time approved), analyst (revised→approved), solution_architect (rejected).
    expect(dash.firstTimeApproval.totalDecisions).toBe(3);
    expect(dash.firstTimeApproval.overallRate).toBe(33.33); // 1 of 3 first-time approved

    const byStage = Object.fromEntries(dash.firstTimeApproval.byStage.map(s => [s.stage, s]));
    expect(byStage.pm_prd).toMatchObject({ firstTimeApprovalRate: 100, revisionRate: 0, attempts: 1 });
    expect(byStage.analyst).toMatchObject({ firstTimeApprovalRate: 0, revisionRate: 100, attempts: 1 });
    expect(byStage.solution_architect).toMatchObject({ firstTimeApprovalRate: 0, revisionRate: 0, attempts: 1 });
    // curator must never appear in quality metrics.
    expect(byStage.curator).toBeUndefined();
  });

  it('derives rejection rate from approved-vs-rejected final decisions', () => {
    // 1 rejected out of 3 resolved decisions.
    expect(dash.rejectionRate.totalResolved).toBe(3);
    expect(dash.rejectionRate.overallRate).toBe(33.33);
  });

  it('flags a pending checkpoint open past its threshold as stuck', () => {
    expect(dash.bottlenecks.stuckNow).toHaveLength(1);
    const stuck = dash.bottlenecks.stuckNow[0];
    expect(stuck.workflowId).toBe('wf-stuck');
    expect(stuck.stage).toBe('pm_prd');
    expect(stuck.requiredRoles).toEqual(['pm']);
    expect(stuck.hoursPending).toBe(120); // 5 days
    // pm_prd median human wait is 24h (from wf1), so threshold = max(24, 24*1.5) = 36h.
    expect(stuck.thresholdHours).toBe(36);
  });

  it('reports change-request-after-completion as a quality-regression proxy', () => {
    expect(dash.qualityRegression.completedTotal).toBe(1); // only wf1 has a workflow_complete event
    expect(dash.qualityRegression.completedWithChangeRequest).toBe(1);
    expect(dash.qualityRegression.rate).toBe(100);
  });

  it('counts manual stage retries and attributes them from event details', () => {
    expect(dash.retries.totalCount).toBe(1);
    expect(dash.retries.byStage).toEqual([{ stage: 'analyst', count: 1 }]);
    expect(dash.retries.recent[0]).toMatchObject({ stage: 'analyst', workflowId: 'wf2', triggeredByName: 'Alice' });
  });

  it('averages LLM compute time per stage, skipping malformed and demo samples', () => {
    const pmPrd = dash.bottlenecks.stageDurations.find(s => s.stage === 'pm_prd');
    // 20s + 40s = avg 30s; the 'not json' sample and the demo workflow's 999s are excluded.
    expect(pmPrd?.avgLlmSeconds).toBe(30);
    // analyst had no stage_completed timing events → null, not 0.
    const analyst = dash.bottlenecks.stageDurations.find(s => s.stage === 'analyst');
    expect(analyst?.avgLlmSeconds).toBeNull();
  });

  it('computes cycle time from creation to first workflow_complete event', () => {
    // Only wf1 completed: created 12d ago, completed 8d ago → 4 days.
    expect(dash.cycleTime.count).toBe(1);
    expect(dash.cycleTime.overallAvgDays).toBe(4);
  });
});
