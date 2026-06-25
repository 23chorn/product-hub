import { useEffect, useState } from 'react';
import type { CompletedInitiativeDetail as CompletedInitiativeDetailData, WorkItemStateBucket } from '@pap/shared';
import { api } from '../../services/api';
import { relativeTime } from '../../utils/relative-time';
import {
  tryParseBacklog, getAllStories, countTicketsByPlatform, PLATFORM_LABELS,
  type BacklogData, type TicketPlatform,
} from '../../utils/backlog-helpers';
import { isDocumentArtifact, convertArtifactToMarkdown } from '../../utils/artifact-to-markdown';
import { mergeQaTests, type QATestSuite } from '../artifact/BacklogOverviewModal';
import { BacklogView } from '../artifact/BacklogView';
import { tryParseQATests, QATestsView, groupByType, typeMeta } from '../artifact/QATestsView';
import { MarkdownContent } from '../common/MarkdownContent';

interface Props {
  itemId: string;
  onBack: () => void;
}

type SingleDocTab = 'research' | 'prd' | 'architecture' | 'figma';
type DocTab = SingleDocTab | 'tickets' | 'tests';
type DocState = { content: string; type: string } | null | 'loading';

const SINGLE_DOC_TABS: SingleDocTab[] = ['research', 'prd', 'architecture', 'figma'];

const TABS: Array<{ key: DocTab; label: string }> = [
  { key: 'research', label: 'Research' },
  { key: 'prd', label: 'PRD' },
  { key: 'architecture', label: 'Architecture' },
  { key: 'figma', label: 'Figma' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'tests', label: 'Test Cases' },
];

const PLATFORM_ORDER: TicketPlatform[] = ['backend', 'web', 'ios', 'android'];

function singleDocArtifactId(detail: CompletedInitiativeDetailData | null, tab: SingleDocTab): number | null {
  if (!detail) return null;
  switch (tab) {
    case 'research': return detail.researchArtifactId;
    case 'prd': return detail.prdArtifactId;
    case 'architecture': return detail.architectureArtifactId;
    case 'figma': return detail.figmaArtifactId;
  }
}

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

/** Markdown document render for the Research/PRD/Architecture tabs — same JSON→markdown
 *  conversion the artifact viewer uses for non-structured document types, just without its
 *  checkpoint chrome. Constrained to a comfortable reading width rather than the full page —
 *  long-form prose stretched across the whole browser is hard to read. */
function DocumentTabContent({ state }: { state: DocState | undefined }) {
  if (state === undefined || state === 'loading') return <p className="text-sm text-surface-400 animate-pulse">Loading...</p>;
  if (state === null) return <p className="text-sm text-surface-400 italic">No document was produced for this stage.</p>;
  const md = isDocumentArtifact(state.type) ? convertArtifactToMarkdown(state.type, state.content) : null;
  return (
    <div className="max-w-4xl mx-auto">
      <MarkdownContent>{md ?? state.content}</MarkdownContent>
    </div>
  );
}

function FigmaTabContent({ state }: { state: DocState | undefined }) {
  if (state === undefined || state === 'loading') return <p className="text-sm text-surface-400 animate-pulse">Loading...</p>;
  if (state === null) return <p className="text-sm text-surface-400 italic">No Figma design was produced for this initiative.</p>;

  let figmaUrl: string | null = null;
  try {
    const cleaned = state.content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    figmaUrl = JSON.parse(cleaned).figma_file_url ?? null;
  } catch { /* non-JSON artifact */ }

  if (!figmaUrl) return <p className="text-sm text-surface-400 italic">No Figma link found in this artifact.</p>;

  return (
    <a
      href={figmaUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2 bg-[#1E1E1E] hover:bg-[#333] text-white text-sm font-medium rounded-lg transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 28.5A9.5 9.5 0 1 1 28.5 19 9.5 9.5 0 0 1 19 28.5Z" fill="#1ABCFE"/>
        <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19V47.5A9.5 9.5 0 0 1 0 47.5Z" fill="#0ACF83"/>
        <path d="M19 0V19H28.5A9.5 9.5 0 0 0 19 0Z" fill="#FF7262"/>
        <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="#F24E1E"/>
        <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="#FF7262"/>
      </svg>
      Open in Figma ↗
    </a>
  );
}

/**
 * Full-page drill-down for a single completed initiative — replaces the Progress Tracker
 * grid in place (not a side panel). Shows ticket/test-case rollups, ADO % complete, and a
 * tab switcher to cycle through every produced artifact (research, PRD, architecture, Figma,
 * tickets, test cases).
 *
 * Every document is resolved from artifacts/checkpoints directly, not from the ADO
 * push-tracking tables (ado_work_item_map / qa_test_plan_map) — their `artifact_id` columns
 * are unreliable for any workflow that went through the multi-feature pipeline (see
 * getDocumentArtifactIds in completed-initiatives-routes.ts), so this page never depends on
 * them. Tickets are the single backlog_merge artifact (already combines every feature); test
 * cases are one qa_tests artifact per feature, merged client-side the same way the live
 * Stories/Tests view does. Research/PRD/Architecture/Figma are whole-initiative documents,
 * fetched lazily once their tab is opened.
 */
export function CompletedInitiativeDetail({ itemId, onBack }: Props) {
  const [detail, setDetail] = useState<CompletedInitiativeDetailData | null>(null);
  const [backlog, setBacklog] = useState<BacklogData | null>(null);
  const [qa, setQa] = useState<QATestSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<DocTab>('tickets');
  const [docCache, setDocCache] = useState<Partial<Record<SingleDocTab, DocState>>>({});

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setDocCache({});
    setTab('tickets');

    api.getCompletedInitiative(itemId).then(async (data) => {
      if (stale) return;
      setDetail(data);

      const [ticketResult, testResults] = await Promise.all([
        data.ticketArtifactId != null
          ? api.getArtifactContent(data.ticketArtifactId).then(({ content }) => tryParseBacklog(content)).catch(() => null)
          : Promise.resolve(null),
        Promise.all(data.testArtifactIds.map((id, num) =>
          api.getArtifactContent(id).then(({ content }) => ({ num, data: tryParseQATests(content) })).catch(() => null)
        )),
      ]);
      if (stale) return;
      setBacklog(ticketResult);
      setQa(mergeQaTests(testResults.filter((p): p is { num: number; data: QATestSuite } => !!p?.data)));
    }).finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [itemId]);

  useEffect(() => {
    if (!SINGLE_DOC_TABS.includes(tab as SingleDocTab)) return;
    const key = tab as SingleDocTab;
    if (docCache[key] !== undefined) return;
    const artifactId = singleDocArtifactId(detail, key);
    if (!artifactId) { setDocCache(c => ({ ...c, [key]: null })); return; }
    setDocCache(c => ({ ...c, [key]: 'loading' }));
    api.getArtifactContent(artifactId)
      .then(({ content, type }) => setDocCache(c => ({ ...c, [key]: { content, type } })))
      .catch(() => setDocCache(c => ({ ...c, [key]: null })));
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

                {tab === 'figma' && <FigmaTabContent state={docCache.figma} />}
                {(tab === 'research' || tab === 'prd' || tab === 'architecture') && <DocumentTabContent state={docCache[tab]} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
