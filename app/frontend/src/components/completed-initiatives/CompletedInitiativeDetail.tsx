import { useEffect, useState } from 'react';
import type { CompletedInitiativeDetail as CompletedInitiativeDetailData, WorkItemStateBucket } from '@pap/shared';
import { api } from '../../services/api';
import { relativeTime } from '../../utils/relative-time';
import {
  tryParseBacklog, getAllStories, countTicketsByPlatform, PLATFORM_LABELS,
  type BacklogData, type TicketPlatform,
} from '../../utils/backlog-helpers';
import { isDocumentArtifact, convertArtifactToMarkdown } from '../../utils/artifact-to-markdown';
import { mergeBacklogs, mergeQaTests, type QATestSuite } from '../artifact/BacklogOverviewModal';
import { BacklogView } from '../artifact/BacklogView';
import { tryParseQATests, QATestsView, groupByType, typeMeta } from '../artifact/QATestsView';
import { MarkdownContent } from '../common/MarkdownContent';

interface Props {
  itemId: string;
  onBack: () => void;
}

type DocTab = 'research' | 'prd' | 'tickets' | 'tests';
type DocKey = 'research' | 'prd';
type DocState = { content: string; type: string } | null | 'loading';

const TABS: Array<{ key: DocTab; label: string }> = [
  { key: 'research', label: 'Research' },
  { key: 'prd', label: 'PRD' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'tests', label: 'Test Cases' },
];

const PLATFORM_ORDER: TicketPlatform[] = ['backend', 'web', 'ios', 'android'];

function PercentBar({ percent }: { percent: number | null }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">% Complete</span>
        <span className="text-lg font-bold text-surface-900 dark:text-surface-100">{percent != null ? `${percent}%` : '—'}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${percent ?? 0}%` }} />
      </div>
    </div>
  );
}

/** Markdown document render for the Research/PRD tabs — same JSON→markdown conversion the
 *  artifact viewer uses for non-structured document types, just without its checkpoint chrome. */
function DocumentTabContent({ state }: { state: DocState | undefined }) {
  if (state === undefined || state === 'loading') return <p className="text-sm text-surface-400 animate-pulse">Loading...</p>;
  if (state === null) return <p className="text-sm text-surface-400 italic">No document was produced for this stage.</p>;
  const md = isDocumentArtifact(state.type) ? convertArtifactToMarkdown(state.type, state.content) : null;
  return <MarkdownContent>{md ?? state.content}</MarkdownContent>;
}

/**
 * Full-page drill-down for a single completed initiative — replaces the Progress Tracker
 * grid in place (not a side panel). Shows ticket/test-case rollups, ADO % complete, and a
 * tab switcher to cycle through every produced artifact (research, PRD, tickets, test cases).
 * The merged backlog/QA content (read from the same artifacts the ADO push used) loads once
 * from the cached GET; only "Refresh" ever calls ADO, and it swaps in just the new state map —
 * never re-fetches artifact content. Research/PRD documents are whole-initiative artifacts, so
 * they're fetched lazily, only once their tab is opened.
 */
export function CompletedInitiativeDetail({ itemId, onBack }: Props) {
  const [detail, setDetail] = useState<CompletedInitiativeDetailData | null>(null);
  const [backlog, setBacklog] = useState<BacklogData | null>(null);
  const [qa, setQa] = useState<QATestSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<DocTab>('tickets');
  const [docCache, setDocCache] = useState<Partial<Record<DocKey, DocState>>>({});

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setDocCache({});
    setTab('tickets');

    api.getCompletedInitiative(itemId).then(async (data) => {
      if (stale) return;
      setDetail(data);

      const ticketArtifactIds = [...new Set(data.workItems.map(w => w.artifactId).filter((id): id is number => id != null))];
      const testArtifactIds = [...new Set(data.testPlans.map(p => p.artifactId).filter((id): id is number => id != null))];

      const [ticketResults, testResults] = await Promise.all([
        Promise.all(ticketArtifactIds.map((id, num) =>
          api.getArtifactContent(id).then(({ content }) => ({ num, data: tryParseBacklog(content) })).catch(() => null)
        )),
        Promise.all(testArtifactIds.map((id, num) =>
          api.getArtifactContent(id).then(({ content }) => ({ num, data: tryParseQATests(content) })).catch(() => null)
        )),
      ]);
      if (stale) return;
      setBacklog(mergeBacklogs(ticketResults.filter((p): p is { num: number; data: BacklogData } => !!p?.data)));
      setQa(mergeQaTests(testResults.filter((p): p is { num: number; data: QATestSuite } => !!p?.data)));
    }).finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [itemId]);

  useEffect(() => {
    if (tab !== 'research' && tab !== 'prd') return;
    if (docCache[tab] !== undefined) return;
    const artifactId = tab === 'research' ? detail?.researchArtifactId : detail?.prdArtifactId;
    if (!artifactId) { setDocCache(c => ({ ...c, [tab]: null })); return; }
    setDocCache(c => ({ ...c, [tab]: 'loading' }));
    api.getArtifactContent(artifactId)
      .then(({ content, type }) => setDocCache(c => ({ ...c, [tab]: { content, type } })))
      .catch(() => setDocCache(c => ({ ...c, [tab]: null })));
  }, [tab, detail]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await api.refreshCompletedInitiative(itemId);
      setDetail(updated);
    } finally {
      setRefreshing(false);
    }
  };

  const stateByLocalKey = new Map<string, WorkItemStateBucket>(
    (detail?.workItems ?? [])
      .filter(w => w.stateBucket != null)
      .map(w => [w.localKey, w.stateBucket as WorkItemStateBucket])
  );

  const ticketBreakdown = backlog ? countTicketsByPlatform(getAllStories(backlog)) : null;
  const testTypeCounts = qa ? groupByType(qa.test_cases).map(([type, cases]) => ({ type, count: cases.length, meta: typeMeta(type) })) : [];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-50 dark:bg-surface-950">
      <div className="px-6 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Progress Tracker
          </button>
          <span className="text-surface-300 dark:text-surface-600">/</span>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{detail?.title ?? 'Loading...'}</h2>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {detail?.epicAdoUrl && (
            <a href={detail.epicAdoUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
              View Epic ↗
            </a>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="px-2.5 py-1 text-xs font-medium rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700/70 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {loading ? (
          <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Total Tickets</p>
                <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{ticketBreakdown?.total ?? detail?.storyCount ?? 0}</p>
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {PLATFORM_ORDER.filter(p => (ticketBreakdown?.[p] ?? 0) > 0).map(p => (
                    <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
                      {ticketBreakdown![p]} {PLATFORM_LABELS[p]}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Test Cases</p>
                <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{detail?.testCaseCount ?? 0}</p>
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {testTypeCounts.map(({ type, count, meta }) => (
                    <span key={type} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.color}`}>
                      {count} {meta.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 p-4 flex flex-col justify-center">
                <PercentBar percent={detail?.percentComplete ?? null} />
                <p className={`text-[10px] mt-2 ${detail?.lastRefreshedAt == null ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500'}`}>
                  {detail?.lastRefreshedAt == null ? 'Needs refresh' : `Refreshed ${relativeTime(detail.lastRefreshedAt)}`}
                </p>
              </div>
            </div>

            <div>
              <div className="flex border-b border-surface-200 dark:border-surface-700">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-4 py-2 text-xs font-medium transition-colors ${
                      tab === t.key
                        ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-500'
                        : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="pt-4">
                {tab === 'tickets' && (
                  backlog && (backlog.features?.length ?? 0) > 0 ? (
                    <BacklogView data={backlog} stateByLocalKey={stateByLocalKey} />
                  ) : (
                    <p className="text-sm text-surface-400 italic">No backlog content found for this initiative.</p>
                  )
                )}

                {tab === 'tests' && (
                  <div className="space-y-4">
                    {qa && qa.test_cases.length > 0 ? (
                      <QATestsView data={qa} />
                    ) : (
                      <p className="text-sm text-surface-400 italic">No test case content found for this initiative.</p>
                    )}
                    {detail && detail.testPlans.length > 0 && (
                      <div className="border-t border-surface-200 dark:border-surface-700 pt-3 space-y-1">
                        <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Test Plan</p>
                        {detail.testPlans.map(plan => (
                          <a
                            key={plan.planId}
                            href={plan.planUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-xs text-brand-600 dark:text-brand-400 hover:underline"
                          >
                            Plan #{plan.planId}{plan.testCaseCount != null ? ` · ${plan.testCaseCount} test cases` : ''} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(tab === 'research' || tab === 'prd') && <DocumentTabContent state={docCache[tab]} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
