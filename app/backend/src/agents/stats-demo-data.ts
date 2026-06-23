/**
 * Stats demo data — fabricated dashboard payload for showcasing the stats UI
 * before there's enough real pipeline history to chart. Never touches the DB.
 * Every payload carries isDemo: true so the UI can bannerize it unmistakably.
 */

import type { StatsDashboard } from './stats-db';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function jitter(base: number, spread: number): number {
  return base + (Math.random() * 2 - 1) * spread;
}

// Same stage tells the bottleneck and weakest-stage panels a consistent story:
// solution_architect is both the slowest stage and the one most likely to bounce.
const DEMO_STAGES: Array<{ stage: string; baseDwellHours: number; baseApprovalRate: number }> = [
  { stage: 'analyst', baseDwellHours: 6, baseApprovalRate: 82 },
  { stage: 'pm_prd', baseDwellHours: 9, baseApprovalRate: 74 },
  { stage: 'solution_architect', baseDwellHours: 34, baseApprovalRate: 52 },
  { stage: 'figma_design', baseDwellHours: 11, baseApprovalRate: 70 },
  { stage: 'story_decomposition', baseDwellHours: 16, baseApprovalRate: 65 },
  { stage: 'qa_engineer', baseDwellHours: 8, baseApprovalRate: 80 },
];

export function getDemoStatsDashboard(rangeDays: number): StatsDashboard {
  const now = Date.now();
  const weekCount = Math.max(4, Math.min(26, Math.round(rangeDays / 7)));
  const weeks = Array.from({ length: weekCount }, (_, i) => now - (weekCount - 1 - i) * WEEK_MS);

  // Each series improves from the first week (progress 0) to the most recent (progress 1) —
  // the story being demoed is "this method gets faster and more accurate over time."
  const cycleTime = weeks.map((weekStart, i) => {
    const progress = i / (weekCount - 1 || 1);
    const avg = Math.max(2, round2(jitter(13 - progress * 7.5, 1.2)));
    return { weekStart, avg, median: round2(avg * 0.9), count: Math.max(1, Math.round(jitter(4, 1.5))) };
  });

  const timeToShip = weeks.map((weekStart, i) => {
    const progress = i / (weekCount - 1 || 1);
    const avg = Math.max(4, round2(jitter(22 - progress * 10, 2)));
    return { weekStart, avg, median: round2(avg * 0.92), count: Math.max(1, Math.round(jitter(2, 1))) };
  });

  const approvalTrend = weeks.map((weekStart, i) => {
    const progress = i / (weekCount - 1 || 1);
    const rate = Math.max(20, Math.min(92, round2(jitter(44 + progress * 36, 5))));
    return { weekStart, rate, count: Math.max(1, Math.round(jitter(8, 2))) };
  });

  const throughput = weeks.map((weekStart, i) => {
    const progress = i / (weekCount - 1 || 1);
    const started = Math.max(1, Math.round(jitter(4 + progress * 1.5, 1.5)));
    const completed = Math.min(started + 1, Math.max(0, Math.round(jitter(2 + progress * 3.5, 1.5))));
    return { weekStart, started, completed };
  });

  const byStage = DEMO_STAGES.map(s => {
    const firstTimeApprovalRate = Math.max(30, Math.min(95, round2(jitter(s.baseApprovalRate, 4))));
    return {
      stage: s.stage,
      firstTimeApprovalRate,
      revisionRate: round2(100 - firstTimeApprovalRate),
      attempts: Math.max(4, Math.round(jitter(14, 4))),
    };
  });

  const stageDurations = DEMO_STAGES.map(s => ({
    stage: s.stage,
    attempts: Math.max(4, Math.round(jitter(14, 4))),
    avgDwellHours: round2(jitter(s.baseDwellHours, s.baseDwellHours * 0.15)),
    medianDwellHours: round2(jitter(s.baseDwellHours * 0.85, s.baseDwellHours * 0.1)),
    avgHumanWaitHours: round2(jitter(s.baseDwellHours * 0.4, 2)),
    avgLlmSeconds: round2(jitter(45, 15)),
  }));

  const stuckNow = [
    {
      checkpointId: -1, workflowId: 'demo-workflow-1', itemId: 'demo-item-1',
      itemTitle: 'Real-time inventory sync', stage: 'solution_architect',
      requiredRoles: ['tech_lead'], pendingSince: now - 52 * 60 * 60 * 1000,
      hoursPending: 52, thresholdHours: 24,
    },
    {
      checkpointId: -2, workflowId: 'demo-workflow-2', itemId: 'demo-item-2',
      itemTitle: 'Bulk CSV export for reporting', stage: 'qa_engineer',
      requiredRoles: ['qa'], pendingSince: now - 31 * 60 * 60 * 1000,
      hoursPending: 31, thresholdHours: 18,
    },
  ];

  const totalDecisions = byStage.reduce((sum, s) => sum + s.attempts, 0);
  const overallApprovalRate = round2(
    byStage.reduce((sum, s) => sum + s.firstTimeApprovalRate * s.attempts, 0) / totalDecisions
  );
  const completedCount = cycleTime.reduce((sum, p) => sum + p.count, 0);
  const shippedCount = timeToShip.reduce((sum, p) => sum + p.count, 0);

  return {
    generatedAt: now,
    rangeDays,
    isDemo: true,
    wip: { active: 5, oldestActiveAgeDays: 6.4 },
    cycleTime: {
      points: cycleTime,
      overallAvgDays: round2(cycleTime.reduce((s, p) => s + p.avg, 0) / cycleTime.length),
      overallMedianDays: round2(cycleTime.reduce((s, p) => s + p.median, 0) / cycleTime.length),
      count: completedCount,
    },
    timeToShip: {
      points: timeToShip,
      overallAvgDays: round2(timeToShip.reduce((s, p) => s + p.avg, 0) / timeToShip.length),
      overallMedianDays: round2(timeToShip.reduce((s, p) => s + p.median, 0) / timeToShip.length),
      shippedCount,
      completedCount: completedCount + 4,
    },
    firstTimeApproval: {
      points: approvalTrend,
      overallRate: overallApprovalRate,
      totalDecisions,
      byStage,
    },
    rejectionRate: { overallRate: 9.5, totalResolved: totalDecisions },
    throughput: { points: throughput },
    bottlenecks: { stageDurations, stuckNow },
    qualityRegression: { completedWithChangeRequest: 3, completedTotal: 34, rate: round2((3 / 34) * 100) },
    retries: {
      totalCount: 4,
      byStage: [
        { stage: 'solution_architect', count: 2 },
        { stage: 'qa_engineer', count: 1 },
        { stage: 'figma_design', count: 1 },
      ],
      recent: [
        { workflowId: 'demo-workflow-1', itemId: 'demo-item-1', itemTitle: 'Real-time inventory sync', stage: 'solution_architect', ts: now - 18 * 60 * 60 * 1000, triggeredByName: 'Demo Admin' },
        { workflowId: 'demo-workflow-2', itemId: 'demo-item-2', itemTitle: 'Bulk CSV export for reporting', stage: 'qa_engineer', ts: now - 2 * DAY_MS, triggeredByName: 'Demo Admin' },
      ],
    },
  };
}
