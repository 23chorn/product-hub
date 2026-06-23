/**
 * Stats DB — read-only aggregations behind the management/admin stats dashboard.
 *
 * Goal: show whether the multi-agent pipeline is getting faster and more
 * accurate over time, and surface where work is currently stuck. All queries
 * exclude demo workflows (policy_overrides demo_mode/demo_auto_approve) and
 * cancelled workflows (a 'workflow_cancelled' event) — neither represents
 * real throughput or quality.
 */

import db from '../data/database';
import { parseRoles } from './workflow-db';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HOUR_MS = 60 * 60 * 1000;

// Stages with no real quality gate — always auto-approved, so they'd dilute
// first-time-approval / revision-rate signals rather than inform them.
const QUALITY_GATE_EXCLUDED_STAGES = new Set(['curator']);

const EXCLUDE_DEMO_CANCELLED = `
  (w.policy_overrides IS NULL OR (w.policy_overrides NOT LIKE '%demo_mode%' AND w.policy_overrides NOT LIKE '%demo_auto_approve%'))
  AND NOT EXISTS (SELECT 1 FROM workflow_events we2 WHERE we2.workflow_id = w.id AND we2.event_type = 'workflow_cancelled')
`;

// ── Math helpers ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Strips per-feature wave suffixes (story_decomposition_F3 -> story_decomposition) so stages group sensibly. */
function normalizeStage(stage: string): string {
  return stage.replace(/_F\d+/, '');
}

interface WeeklyPoint { weekStart: number; avg: number | null; median: number | null; count: number }

/** Buckets (timestamp, value) pairs into weekly windows anchored to `now`, oldest-to-newest. */
function bucketWeekly(items: Array<{ ts: number; value: number }>, now: number, rangeDays: number): WeeklyPoint[] {
  const rangeStart = now - rangeDays * DAY_MS;
  const buckets = new Map<number, number[]>();
  for (const { ts, value } of items) {
    if (ts < rangeStart || ts > now) continue;
    const weekStart = rangeStart + Math.floor((ts - rangeStart) / WEEK_MS) * WEEK_MS;
    if (!buckets.has(weekStart)) buckets.set(weekStart, []);
    buckets.get(weekStart)!.push(value);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, values]) => ({
      weekStart,
      avg: round2(mean(values)!),
      median: round2(median(values)!),
      count: values.length,
    }));
}

/** Buckets bare timestamps into weekly counts, returning every week in range (including zero-count weeks). */
function bucketWeeklyCounts(timestamps: number[], now: number, rangeDays: number): Map<number, number> {
  const rangeStart = now - rangeDays * DAY_MS;
  const counts = new Map<number, number>();
  for (let w = rangeStart; w <= now; w += WEEK_MS) counts.set(w, 0);
  for (const ts of timestamps) {
    if (ts < rangeStart || ts > now) continue;
    const weekStart = rangeStart + Math.floor((ts - rangeStart) / WEEK_MS) * WEEK_MS;
    counts.set(weekStart, (counts.get(weekStart) ?? 0) + 1);
  }
  return counts;
}

// ── Row shapes ───────────────────────────────────────────────────────────────

interface CheckpointLite {
  workflow_id: string;
  stage: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
}

interface StageDecision { stage: string; firstTime: boolean; approved: boolean; resolvedAt: number }
interface StageDuration { stage: string; dwellHours: number; humanWaitHours: number | null }

/** Single pass over checkpoint history, grouped by (workflow_id, stage), feeding both quality and duration metrics. */
function computeStageGroups(): { decisions: StageDecision[]; durations: StageDuration[] } {
  const excludedList = [...QUALITY_GATE_EXCLUDED_STAGES].map(s => `'${s}'`).join(',');
  const rows = db.prepare(`
    SELECT c.workflow_id, c.stage, c.status, c.created_at, c.resolved_at
    FROM checkpoints c
    JOIN workflows w ON w.id = c.workflow_id
    WHERE c.stage NOT IN (${excludedList}) AND ${EXCLUDE_DEMO_CANCELLED}
    ORDER BY c.workflow_id ASC, c.stage ASC, c.created_at ASC
  `).all() as CheckpointLite[];

  const groups = new Map<string, CheckpointLite[]>();
  for (const r of rows) {
    const key = `${r.workflow_id}::${r.stage}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const decisions: StageDecision[] = [];
  const durations: StageDuration[] = [];

  for (const group of groups.values()) {
    const stage = normalizeStage(group[0].stage);

    const finalRow = [...group].reverse().find(r => r.status === 'approved' || r.status === 'rejected');
    if (finalRow && finalRow.resolved_at != null) {
      decisions.push({
        stage,
        firstTime: group.length === 1,
        approved: finalRow.status === 'approved',
        resolvedAt: finalRow.resolved_at,
      });
    }

    const first = group[0];
    const last = group[group.length - 1];
    const endTs = last.resolved_at ?? last.created_at;
    const humanRow = group.find(r => (r.status === 'approved' || r.status === 'rejected') && r.resolved_at != null);
    durations.push({
      stage,
      dwellHours: (endTs - first.created_at) / HOUR_MS,
      humanWaitHours: humanRow ? (humanRow.resolved_at! - humanRow.created_at) / HOUR_MS : null,
    });
  }

  return { decisions, durations };
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface StatsDashboard {
  generatedAt: number;
  rangeDays: number;
  isDemo: boolean;
  wip: { active: number; oldestActiveAgeDays: number | null };
  cycleTime: { points: WeeklyPoint[]; overallAvgDays: number | null; overallMedianDays: number | null; count: number };
  timeToShip: { points: WeeklyPoint[]; overallAvgDays: number | null; overallMedianDays: number | null; shippedCount: number; completedCount: number };
  firstTimeApproval: {
    points: Array<{ weekStart: number; rate: number; count: number }>;
    overallRate: number | null;
    totalDecisions: number;
    byStage: Array<{ stage: string; firstTimeApprovalRate: number; revisionRate: number; attempts: number }>;
  };
  rejectionRate: { overallRate: number | null; totalResolved: number };
  throughput: { points: Array<{ weekStart: number; started: number; completed: number }> };
  bottlenecks: {
    stageDurations: Array<{ stage: string; attempts: number; avgDwellHours: number; medianDwellHours: number; avgHumanWaitHours: number | null; avgLlmSeconds: number | null }>;
    stuckNow: Array<{
      checkpointId: number; workflowId: string; itemId: string; itemTitle: string; stage: string;
      requiredRoles: string[]; pendingSince: number; hoursPending: number; thresholdHours: number;
    }>;
  };
  qualityRegression: { completedWithChangeRequest: number; completedTotal: number; rate: number | null };
  retries: {
    totalCount: number;
    byStage: Array<{ stage: string; count: number }>;
    recent: Array<{ workflowId: string; itemId: string; itemTitle: string; stage: string; ts: number; triggeredByName: string | null }>;
  };
}

// ── Dashboard builder ────────────────────────────────────────────────────────

export function getStatsDashboard(rangeDays: number): StatsDashboard {
  const now = Date.now();
  const rangeStart = now - rangeDays * DAY_MS;

  // WIP
  const wipRow = db.prepare(`
    SELECT COUNT(*) as cnt, MIN(w.created_at) as oldest
    FROM workflows w
    WHERE w.status IN ('active', 'paused_at_checkpoint', 'awaiting_user_input') AND ${EXCLUDE_DEMO_CANCELLED}
  `).get() as { cnt: number; oldest: number | null };

  // Cycle time: workflow created -> first 'workflow_complete' event
  const cycleRows = db.prepare(`
    SELECT w.created_at as startedAt, wc.completedAt as completedAt
    FROM workflows w
    JOIN (
      SELECT workflow_id, MIN(created_at) as completedAt
      FROM workflow_events WHERE event_type = 'workflow_complete'
      GROUP BY workflow_id
    ) wc ON wc.workflow_id = w.id
    WHERE ${EXCLUDE_DEMO_CANCELLED} AND wc.completedAt >= ?
  `).all(rangeStart) as Array<{ startedAt: number; completedAt: number }>;
  const cycleDays = cycleRows.map(r => (r.completedAt - r.startedAt) / DAY_MS);

  // Time to ship: completion -> items.shipped_at (only items.source = 'airtable', the only path that gets a real Shipped signal)
  const shipRows = db.prepare(`
    SELECT wc.completedAt as completedAt, i.shipped_at as shippedAt
    FROM workflows w
    JOIN (
      SELECT workflow_id, MIN(created_at) as completedAt
      FROM workflow_events WHERE event_type = 'workflow_complete'
      GROUP BY workflow_id
    ) wc ON wc.workflow_id = w.id
    JOIN items i ON i.id = w.item_id
    WHERE i.shipped_at IS NOT NULL AND i.shipped_at >= wc.completedAt
      AND ${EXCLUDE_DEMO_CANCELLED} AND i.shipped_at >= ?
  `).all(rangeStart) as Array<{ completedAt: number; shippedAt: number }>;
  const shipDays = shipRows.map(r => (r.shippedAt - r.completedAt) / DAY_MS);

  const completedCountRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM workflows w
    JOIN (
      SELECT workflow_id, MIN(created_at) as completedAt
      FROM workflow_events WHERE event_type = 'workflow_complete'
      GROUP BY workflow_id
    ) wc ON wc.workflow_id = w.id
    WHERE ${EXCLUDE_DEMO_CANCELLED} AND wc.completedAt >= ?
  `).get(rangeStart) as { cnt: number };

  // Quality / duration (single pass)
  const { decisions, durations } = computeStageGroups();
  const decisionsInRange = decisions.filter(d => d.resolvedAt >= rangeStart);
  const firstTimeApprovedFlags = decisionsInRange.map(d => (d.firstTime && d.approved ? 1 : 0));
  const approvedFlags = decisionsInRange.map(d => (d.approved ? 1 : 0));

  const byStageMap = new Map<string, StageDecision[]>();
  for (const d of decisionsInRange) {
    if (!byStageMap.has(d.stage)) byStageMap.set(d.stage, []);
    byStageMap.get(d.stage)!.push(d);
  }
  const byStage = [...byStageMap.entries()]
    .map(([stage, ds]) => ({
      stage,
      firstTimeApprovalRate: round2(mean(ds.map(d => (d.firstTime && d.approved ? 1 : 0)))! * 100),
      revisionRate: round2(mean(ds.map(d => (d.firstTime ? 0 : 1)))! * 100),
      attempts: ds.length,
    }))
    .sort((a, b) => b.attempts - a.attempts);

  // Average LLM compute time per stage — the seconds the model spent streaming the
  // artifact, captured in each 'stage_completed' event's details (see workflow-stage-runner).
  // Distinct from dwellHours (which includes human review wait). Demo/cancelled excluded.
  const llmTimingRows = db.prepare(`
    SELECT we.stage as stage, we.details as details
    FROM workflow_events we
    JOIN workflows w ON w.id = we.workflow_id
    WHERE we.event_type = 'stage_completed' AND we.details IS NOT NULL AND ${EXCLUDE_DEMO_CANCELLED}
  `).all() as Array<{ stage: string | null; details: string }>;
  const llmSecondsByStage = new Map<string, number[]>();
  for (const r of llmTimingRows) {
    if (!r.stage) continue;
    let seconds: number | undefined;
    try { seconds = JSON.parse(r.details).llm_seconds; } catch { /* malformed details — skip */ }
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) continue;
    const stage = normalizeStage(r.stage);
    if (!llmSecondsByStage.has(stage)) llmSecondsByStage.set(stage, []);
    llmSecondsByStage.get(stage)!.push(seconds);
  }

  // dwell/human-wait have no natural single timestamp to range-filter on — reflects all history for stable medians
  const durationsByStage = new Map<string, StageDuration[]>();
  for (const d of durations) {
    if (!durationsByStage.has(d.stage)) durationsByStage.set(d.stage, []);
    durationsByStage.get(d.stage)!.push(d);
  }
  const stageDurations = [...durationsByStage.entries()]
    .map(([stage, ds]) => {
      const dwellValues = ds.map(d => d.dwellHours);
      const humanWaitValues = ds.map(d => d.humanWaitHours).filter((v): v is number => v != null);
      const llmSeconds = llmSecondsByStage.get(stage) ?? [];
      return {
        stage,
        attempts: ds.length,
        avgDwellHours: round2(mean(dwellValues)!),
        medianDwellHours: round2(median(dwellValues)!),
        avgHumanWaitHours: humanWaitValues.length > 0 ? round2(mean(humanWaitValues)!) : null,
        avgLlmSeconds: llmSeconds.length > 0 ? round2(mean(llmSeconds)!) : null,
      };
    })
    .sort((a, b) => b.avgDwellHours - a.avgDwellHours);

  // Median human-wait per stage, used as the stuck-ticket threshold baseline
  const medianHumanWaitByStage = new Map<string, number>();
  for (const [stage, ds] of durationsByStage) {
    const values = ds.map(d => d.humanWaitHours).filter((v): v is number => v != null);
    const med = median(values);
    if (med != null) medianHumanWaitByStage.set(stage, med);
  }

  // Currently stuck: pending checkpoints open longer than max(24h, 1.5x median wait for that stage)
  const pendingRows = db.prepare(`
    SELECT c.id as checkpointId, c.workflow_id as workflowId, c.stage as stage, c.created_at as createdAt,
           c.required_role as requiredRole, w.item_id as itemId, i.title as itemTitle
    FROM checkpoints c
    JOIN workflows w ON w.id = c.workflow_id
    JOIN items i ON i.id = w.item_id
    WHERE c.status = 'pending' AND ${EXCLUDE_DEMO_CANCELLED}
  `).all() as Array<{ checkpointId: number; workflowId: string; stage: string; createdAt: number; requiredRole: string | null; itemId: string; itemTitle: string }>;

  const stuckNow = pendingRows
    .map(r => {
      const stage = normalizeStage(r.stage);
      const med = medianHumanWaitByStage.get(stage);
      const thresholdHours = Math.max(24, med != null ? med * 1.5 : 24);
      const hoursPending = (now - r.createdAt) / HOUR_MS;
      return {
        checkpointId: r.checkpointId,
        workflowId: r.workflowId,
        itemId: r.itemId,
        itemTitle: r.itemTitle,
        stage,
        requiredRoles: parseRoles(r.requiredRole),
        pendingSince: r.createdAt,
        hoursPending: round2(hoursPending),
        thresholdHours: round2(thresholdHours),
        isStuck: hoursPending > thresholdHours,
      };
    })
    .filter(r => r.isStuck)
    .sort((a, b) => b.hoursPending - a.hoursPending)
    .map(({ isStuck: _isStuck, ...rest }) => rest);

  // Throughput: started (workflow created) vs completed (first workflow_complete event), per week
  const startedRows = db.prepare(`SELECT w.created_at as ts FROM workflows w WHERE ${EXCLUDE_DEMO_CANCELLED}`).all() as Array<{ ts: number }>;
  const completedRows = db.prepare(`
    SELECT wc.completedAt as ts
    FROM (
      SELECT workflow_id, MIN(created_at) as completedAt
      FROM workflow_events WHERE event_type = 'workflow_complete'
      GROUP BY workflow_id
    ) wc
    JOIN workflows w ON w.id = wc.workflow_id
    WHERE ${EXCLUDE_DEMO_CANCELLED}
  `).all() as Array<{ ts: number }>;
  const startedBuckets = bucketWeeklyCounts(startedRows.map(r => r.ts), now, rangeDays);
  const completedBuckets = bucketWeeklyCounts(completedRows.map(r => r.ts), now, rangeDays);
  const allWeekStarts = [...new Set([...startedBuckets.keys(), ...completedBuckets.keys()])].sort((a, b) => a - b);
  const throughputPoints = allWeekStarts.map(weekStart => ({
    weekStart,
    started: startedBuckets.get(weekStart) ?? 0,
    completed: completedBuckets.get(weekStart) ?? 0,
  }));

  // Change-request-after-completion rate — proxy for "did the completed output actually hold up"
  const crRow = db.prepare(`
    SELECT COUNT(DISTINCT cr.workflow_id) as cnt
    FROM change_requests cr
    JOIN workflows w ON w.id = cr.workflow_id
    WHERE ${EXCLUDE_DEMO_CANCELLED}
  `).get() as { cnt: number };

  // Manual stage retries (admin "retry" button) — counted from the distinct 'stage_retried'
  // event, not the 'stage_progress' narration, so this never double-counts normal stage runs.
  const retryRows = db.prepare(`
    SELECT we.workflow_id as workflowId, we.stage as stage, we.created_at as ts, we.details as details,
           w.item_id as itemId, i.title as itemTitle
    FROM workflow_events we
    JOIN workflows w ON w.id = we.workflow_id
    JOIN items i ON i.id = w.item_id
    WHERE we.event_type = 'stage_retried' AND ${EXCLUDE_DEMO_CANCELLED} AND we.created_at >= ?
    ORDER BY we.created_at DESC
  `).all(rangeStart) as Array<{ workflowId: string; stage: string; ts: number; details: string | null; itemId: string; itemTitle: string }>;

  const retryByStageMap = new Map<string, number>();
  for (const r of retryRows) {
    const stage = normalizeStage(r.stage);
    retryByStageMap.set(stage, (retryByStageMap.get(stage) ?? 0) + 1);
  }
  const retryByStage = [...retryByStageMap.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  const retriesRecent = retryRows.slice(0, 20).map(r => {
    let triggeredByName: string | null = null;
    if (r.details) {
      try { triggeredByName = (JSON.parse(r.details).name as string) ?? null; } catch { /* malformed details — show no attribution */ }
    }
    return {
      workflowId: r.workflowId,
      itemId: r.itemId,
      itemTitle: r.itemTitle,
      stage: normalizeStage(r.stage),
      ts: r.ts,
      triggeredByName,
    };
  });

  return {
    generatedAt: now,
    rangeDays,
    isDemo: false,
    wip: {
      active: wipRow.cnt,
      oldestActiveAgeDays: wipRow.oldest != null ? round2((now - wipRow.oldest) / DAY_MS) : null,
    },
    cycleTime: {
      points: bucketWeekly(cycleRows.map(r => ({ ts: r.completedAt, value: (r.completedAt - r.startedAt) / DAY_MS })), now, rangeDays),
      overallAvgDays: cycleDays.length > 0 ? round2(mean(cycleDays)!) : null,
      overallMedianDays: cycleDays.length > 0 ? round2(median(cycleDays)!) : null,
      count: cycleDays.length,
    },
    timeToShip: {
      points: bucketWeekly(shipRows.map(r => ({ ts: r.shippedAt, value: (r.shippedAt - r.completedAt) / DAY_MS })), now, rangeDays),
      overallAvgDays: shipDays.length > 0 ? round2(mean(shipDays)!) : null,
      overallMedianDays: shipDays.length > 0 ? round2(median(shipDays)!) : null,
      shippedCount: shipDays.length,
      completedCount: completedCountRow.cnt,
    },
    firstTimeApproval: {
      points: bucketWeekly(decisionsInRange.map(d => ({ ts: d.resolvedAt, value: d.firstTime && d.approved ? 1 : 0 })), now, rangeDays)
        .map(p => ({ weekStart: p.weekStart, rate: round2((p.avg ?? 0) * 100), count: p.count })),
      overallRate: firstTimeApprovedFlags.length > 0 ? round2(mean(firstTimeApprovedFlags)! * 100) : null,
      totalDecisions: decisionsInRange.length,
      byStage,
    },
    rejectionRate: {
      overallRate: approvedFlags.length > 0 ? round2((1 - mean(approvedFlags)!) * 100) : null,
      totalResolved: decisionsInRange.length,
    },
    throughput: { points: throughputPoints },
    bottlenecks: { stageDurations, stuckNow },
    qualityRegression: {
      completedWithChangeRequest: crRow.cnt,
      completedTotal: completedCountRow.cnt,
      rate: completedCountRow.cnt > 0 ? round2((crRow.cnt / completedCountRow.cnt) * 100) : null,
    },
    retries: {
      totalCount: retryRows.length,
      byStage: retryByStage,
      recent: retriesRecent,
    },
  };
}
