import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { StatsDashboard } from '../../services/api/stats';
import { useStatsStore } from '../../stores/statsStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import { Sparkline, WeeklyBars, HorizontalBarList, formatWeek } from './charts';

const RANGE_OPTIONS = [30, 90, 180, 365];

// Hidden (not removed) during early platform validation: both depend on Airtable
// "Shipped" status tracking well after the pipeline finishes, which is sparse/lagging
// this early. Flip to true once shipped-status data is reliably populated.
const SHOW_SHIPPING_KPIS = false;

function stageLabel(stage: string): string {
  return STAGE_SHORT_LABELS[stage] ?? stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDays(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}d`;
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(0)}%`;
}

function fmtHours(n: number | null): string {
  if (n == null) return '—';
  return n >= 48 ? `${(n / 24).toFixed(1)}d` : `${n.toFixed(0)}h`;
}

function KpiCard({ label, value, sublabel, accent }: { label: string; value: string; sublabel?: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 rounded-xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${accent ?? 'text-surface-900 dark:text-surface-100'}`}>{value}</p>
      {sublabel && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{sublabel}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{title}</h3>
      {subtitle && <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mt-3" />}
      {children}
    </div>
  );
}

export function StatsDashboardPanel() {
  const { closeStats } = useStatsStore();
  const { applyWorkflowStatus } = useWorkflowStore();
  const [days, setDays] = useState(90);
  const [showDemo, setShowDemo] = useState(false);
  const [data, setData] = useState<StatsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: number, demo: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const dashboard = await api.getStatsDashboard(rangeDays, demo);
      setData(dashboard);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days, showDemo); }, [days, showDemo, load]);

  const handleOpenWorkflow = async (workflowId: string) => {
    try {
      const status = await api.getWorkflowStatus(workflowId);
      applyWorkflowStatus(status);
      closeStats();
    } catch { /* silent — leave the dashboard open if the workflow can't be loaded */ }
  };

  return (
    <div className="h-full bg-surface-50 dark:bg-surface-900 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700 flex-shrink-0 bg-white dark:bg-surface-800/60">
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Stats Dashboard</h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            Cycle time, quality, and bottlenecks across the agent pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDemo(v => !v)}
            title="Showcase the dashboard with illustrative sample data instead of real pipeline history"
            className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${
              showDemo
                ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                : 'bg-white dark:bg-surface-800/50 border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-500'
            }`}
          >
            {showDemo ? '◉ Demo Data' : '○ Demo Data'}
          </button>
          <div className="flex items-center bg-surface-100 dark:bg-surface-700/60 rounded-lg p-0.5">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => setDays(opt)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  days === opt
                    ? 'bg-white dark:bg-surface-900 text-brand-700 dark:text-brand-400 shadow-sm'
                    : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
                }`}
              >
                {opt}d
              </button>
            ))}
          </div>
          <button
            onClick={closeStats}
            className="p-2 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && !data && (
          <div className="flex items-center justify-center h-full text-sm text-surface-500 dark:text-surface-400">Loading…</div>
        )}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 mb-4">
            {error}
          </div>
        )}
        {data?.isDemo && (
          <div className="max-w-6xl mx-auto mb-4 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <span className="font-semibold">Demo data</span>
            <span>— illustrative numbers for showcasing the dashboard, not real pipeline history.</span>
          </div>
        )}
        {data && (
          <div className="space-y-5 max-w-6xl mx-auto">
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiCard label="In Flight" value={String(data.wip.active)} sublabel={data.wip.oldestActiveAgeDays != null ? `oldest ${fmtDays(data.wip.oldestActiveAgeDays)}` : undefined} />
              <KpiCard label="Avg Cycle Time" value={fmtDays(data.cycleTime.overallAvgDays)} sublabel={`median ${fmtDays(data.cycleTime.overallMedianDays)} · n=${data.cycleTime.count}`} />
              {SHOW_SHIPPING_KPIS && (
                <KpiCard label="Avg Time to Ship" value={fmtDays(data.timeToShip.overallAvgDays)} sublabel={`${data.timeToShip.shippedCount}/${data.timeToShip.completedCount} shipped`} />
              )}
              <KpiCard
                label="1st-Time Approval"
                value={fmtPct(data.firstTimeApproval.overallRate)}
                sublabel={`n=${data.firstTimeApproval.totalDecisions}`}
                accent={data.firstTimeApproval.overallRate != null && data.firstTimeApproval.overallRate >= 70 ? 'text-brand-600 dark:text-brand-400' : undefined}
              />
              <KpiCard label="Rejection Rate" value={fmtPct(data.rejectionRate.overallRate)} sublabel={`n=${data.rejectionRate.totalResolved}`} />
              {SHOW_SHIPPING_KPIS && (
                <KpiCard
                  label="Post-Ship Change Requests"
                  value={fmtPct(data.qualityRegression.rate)}
                  sublabel={`${data.qualityRegression.completedWithChangeRequest}/${data.qualityRegression.completedTotal} completed`}
                />
              )}
              <KpiCard label="Manual Retries" value={String(data.retries.totalCount)} sublabel="admin-triggered, in range" />
            </div>

            {/* Trends */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section title="Cycle Time" subtitle="Average days from pipeline start to pipeline complete, by week of completion">
                <Sparkline
                  points={data.cycleTime.points.map(p => ({ x: p.weekStart, y: p.avg ?? 0 }))}
                  valueFormat={v => `${v.toFixed(1)}d`}
                />
              </Section>
              <Section title="Time to Ship" subtitle="Average days from pipeline complete to Airtable status = Shipped, by week shipped">
                <Sparkline
                  points={data.timeToShip.points.map(p => ({ x: p.weekStart, y: p.avg ?? 0 }))}
                  color="#7c3aed"
                  valueFormat={v => `${v.toFixed(1)}d`}
                />
              </Section>
              <Section title="First-Time Approval Rate" subtitle="Share of stage outputs approved with no revision cycle, by week decided">
                <Sparkline
                  points={data.firstTimeApproval.points.map(p => ({ x: p.weekStart, y: p.rate }))}
                  color="rgb(var(--brand-600))"
                  valueFormat={v => `${v.toFixed(0)}%`}
                />
              </Section>
              <Section title="Throughput" subtitle="Initiatives started vs. completed, per week">
                <WeeklyBars points={data.throughput.points} />
              </Section>
            </div>

            {/* Bottlenecks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section title="Slowest Stages" subtitle="Avg time a stage stays open (draft + revisions + review), worst first">
                <HorizontalBarList
                  color="bg-amber-500"
                  items={[...data.bottlenecks.stageDurations]
                    .sort((a, b) => b.avgDwellHours - a.avgDwellHours)
                    .slice(0, 8)
                    .map(s => ({ label: stageLabel(s.stage), value: s.avgDwellHours, sublabel: `n=${s.attempts}` }))}
                  valueFormat={fmtHours}
                />
              </Section>
              <Section title="Weakest Stages" subtitle="First-time approval rate by stage, worst first — points at prompts needing work">
                <HorizontalBarList
                  color="bg-rose-500"
                  items={[...data.firstTimeApproval.byStage]
                    .sort((a, b) => a.firstTimeApprovalRate - b.firstTimeApprovalRate)
                    .slice(0, 8)
                    .map(s => ({ label: stageLabel(s.stage), value: s.firstTimeApprovalRate, sublabel: `n=${s.attempts}` }))}
                  valueFormat={fmtPct}
                />
              </Section>
            </div>

            <Section title="Currently Stuck" subtitle="Pending approvals open well beyond that stage's usual review time">
              {data.bottlenecks.stuckNow.length === 0 ? (
                <p className="text-xs text-surface-400 dark:text-surface-600 py-1">Nothing flagged — all pending approvals are within normal range.</p>
              ) : (
                <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {data.bottlenecks.stuckNow.map(item => (
                    <button
                      key={item.checkpointId}
                      onClick={() => { if (!data.isDemo) handleOpenWorkflow(item.workflowId); }}
                      disabled={data.isDemo}
                      className={`w-full flex items-center justify-between gap-3 py-2.5 text-left rounded-lg px-2 -mx-2 transition-colors ${data.isDemo ? 'cursor-default' : 'hover:bg-surface-50 dark:hover:bg-surface-800/60'}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-surface-800 dark:text-surface-200 truncate">{item.itemTitle}</p>
                        <p className="text-[11px] text-surface-500 dark:text-surface-400">
                          {stageLabel(item.stage)}{item.requiredRoles.length > 0 ? ` · needs ${item.requiredRoles.join(', ')}` : ''}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{fmtHours(item.hoursPending)}</p>
                        <p className="text-[11px] text-surface-400 dark:text-surface-500">vs {fmtHours(item.thresholdHours)} usual</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Recent Retries" subtitle="Stages manually retried from the admin retry button">
              {data.retries.recent.length === 0 ? (
                <p className="text-xs text-surface-400 dark:text-surface-600 py-1">No manual retries in range.</p>
              ) : (
                <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
                  {data.retries.recent.map((item, i) => (
                    <button
                      key={`${item.workflowId}-${item.stage}-${item.ts}-${i}`}
                      onClick={() => { if (!data.isDemo) handleOpenWorkflow(item.workflowId); }}
                      disabled={data.isDemo}
                      className={`w-full flex items-center justify-between gap-3 py-2.5 text-left rounded-lg px-2 -mx-2 transition-colors ${data.isDemo ? 'cursor-default' : 'hover:bg-surface-50 dark:hover:bg-surface-800/60'}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-surface-800 dark:text-surface-200 truncate">{item.itemTitle}</p>
                        <p className="text-[11px] text-surface-500 dark:text-surface-400">
                          {stageLabel(item.stage)}{item.triggeredByName ? ` · by ${item.triggeredByName}` : ''}
                        </p>
                      </div>
                      <p className="text-[11px] text-surface-400 dark:text-surface-500 flex-shrink-0">{formatWeek(item.ts)}</p>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <p className="text-[11px] text-surface-400 dark:text-surface-600 text-center pb-2">
              Demo and cancelled workflows excluded. Generated {formatWeek(data.generatedAt)} · range {data.rangeDays}d
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
