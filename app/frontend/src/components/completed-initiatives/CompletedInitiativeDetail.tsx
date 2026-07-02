import { useEffect, useState } from 'react';
import type { CompletedInitiativeDetail as CompletedInitiativeDetailData, WorkItemStateBucket } from '@pap/shared';
import {
  tryParseBacklog, getAllStories, countTicketsByPlatform, PLATFORM_LABELS, tryParseQATests, mergeQaTests,
  type BacklogData, type TicketPlatform, type QATestSuite,
} from '@pap/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { relativeTime } from '../../utils/relative-time';
import { isDocumentArtifact, renderArtifactMarkdown } from '@pap/shared';
import { BacklogView } from '../artifact/BacklogView';
import { tryParseEpicFeatures, type EpicFeaturesData } from '../artifact/EpicFeaturesView';
import { PageHeaderTitle } from '../common/PageHeaderTitle';
import { PageHeaderActions } from '../common/PageHeaderActions';
import { QATestsView, groupByType, typeMeta } from '../artifact/QATestsView';
import { MarkdownContent } from '../common/MarkdownContent';
import { ArchiveConfirmModal } from '../common/ArchiveConfirmModal';
import { WorkItemManagePanel } from './WorkItemManagePanel';
import { FigmaScreenPreviewer } from '../artifact/FigmaDesignActions';
import { parseFigmaDesignContent } from '../../utils/figma-design';

interface Props {
  itemId: string;
  /** True when reviewing this item from the admin-only Archived Initiatives list. */
  archived?: boolean;
  /** Called when navigating back. Receives true if at least one refresh happened (so parent can reload its list). */
  onBack: (didRefresh: boolean) => void;
  /** Called after a successful archive/unarchive — parent should navigate back and refresh its list. */
  onArchiveChange?: () => void;
}

type SingleDocTab = 'research' | 'prd' | 'architecture' | 'figma';
type DocTab = SingleDocTab | 'tickets' | 'tests' | 'manage';
type DocState = { content: string; type: string } | null | 'loading';

const SINGLE_DOC_TABS: SingleDocTab[] = ['research', 'prd', 'architecture', 'figma'];

const TABS: Array<{ key: DocTab; label: string }> = [
  { key: 'research', label: 'Research' },
  { key: 'prd', label: 'PRD' },
  { key: 'architecture', label: 'Architecture' },
  { key: 'figma', label: 'Figma' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'tests', label: 'Test Cases' },
  { key: 'manage', label: 'Manage' },
];

const PLATFORM_ORDER: TicketPlatform[] = ['backend', 'web', 'ios', 'android'];

/** Tabs that have content for a given detail object. Manage is always visible. */
function visibleTabsFor(detail: CompletedInitiativeDetailData): Set<DocTab> {
  const s = new Set<DocTab>(['manage'] as DocTab[]);
  if (detail.researchArtifactId != null) s.add('research');
  if (detail.prdArtifactId != null) s.add('prd');
  if (detail.architectureArtifactId != null) s.add('architecture');
  if (detail.figmaArtifactId != null) s.add('figma');
  if (detail.ticketArtifactId != null) s.add('tickets');
  if (detail.testArtifactIds.length > 0) s.add('tests');
  return s;
}

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
  const md = isDocumentArtifact(state.type) ? renderArtifactMarkdown(state.type, state.content, 'display') : null;
  return (
    <div className="max-w-4xl mx-auto">
      <MarkdownContent>{md ?? state.content}</MarkdownContent>
    </div>
  );
}

function FigmaTabContent({ state }: { state: DocState | undefined }) {
  if (state === undefined || state === 'loading') return <p className="text-sm text-surface-400 animate-pulse">Loading...</p>;
  if (state === null) return <p className="text-sm text-surface-400 italic">No Figma design was produced for this initiative.</p>;

  const figmaDesign = parseFigmaDesignContent(state.content);
  const links = Object.fromEntries(figmaDesign.screens.map(s => [s.name, s.frame_url ?? '']));

  return (
    <div className="max-w-4xl mx-auto h-[560px] border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
      <FigmaScreenPreviewer
        figmaDesign={figmaDesign}
        links={links}
        onLinkChange={() => {}}
        readonly
      />
    </div>
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
export function CompletedInitiativeDetail({ itemId, archived = false, onBack, onArchiveChange }: Props) {
  const { user, noAuth } = useAuthStore();
  const isAdmin = noAuth || !!user?.is_admin;

  const [detail, setDetail] = useState<CompletedInitiativeDetailData | null>(null);
  const [backlog, setBacklog] = useState<BacklogData | null>(null);
  const [epicFeatures, setEpicFeatures] = useState<EpicFeaturesData | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [qa, setQa] = useState<QATestSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [everRefreshed, setEverRefreshed] = useState(false);
  const [tab, setTab] = useState<DocTab>('tickets');
  const [docCache, setDocCache] = useState<Partial<Record<SingleDocTab, DocState>>>({});
  const [frMap, setFrMap] = useState<Record<string, string>>({});
  const [nfrMap, setNfrMap] = useState<Record<string, string>>({});
  const [testCountByArtifactId, setTestCountByArtifactId] = useState<Map<number, number>>(new Map());
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setDocCache({});
    setSelectedPhase(null);

    api.getCompletedInitiative(itemId, archived).then(async (data) => {
      if (stale) return;
      setDetail(data);
      // Pick the first tab that actually has content for this initiative
      const visible = visibleTabsFor(data);
      const firstTab = (['tickets', 'tests', 'research', 'prd', 'architecture', 'figma', 'manage'] as DocTab[])
        .find(k => visible.has(k)) ?? 'manage';
      setTab(firstTab);

      const [ticketResult, epicFeaturesResult, testResults, prdContent] = await Promise.all([
        data.ticketArtifactId != null
          ? api.getArtifactContent(data.ticketArtifactId).then(({ content }) => tryParseBacklog(content)).catch(() => null)
          : Promise.resolve(null),
        data.epicFeaturesArtifactId != null
          ? api.getArtifactContent(data.epicFeaturesArtifactId).then(({ content }) => tryParseEpicFeatures(content)).catch(() => null)
          : Promise.resolve(null),
        Promise.all(data.testArtifactIds.map((id, num) =>
          api.getArtifactContent(id).then(({ content }) => ({ num, data: tryParseQATests(content) })).catch(() => null)
        )),
        data.prdArtifactId != null
          ? api.getArtifactContent(data.prdArtifactId).then(({ content }) => content).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (stale) return;
      setBacklog(ticketResult);
      setEpicFeatures(epicFeaturesResult);
      const validTests = testResults.filter((p): p is { num: number; data: QATestSuite } => !!p?.data);
      setQa(mergeQaTests(validTests));
      const countMap = new Map<number, number>();
      for (const r of validTests) countMap.set(data.testArtifactIds[r.num], r.data.test_cases.length);
      setTestCountByArtifactId(countMap);
      if (prdContent) {
        try {
          const stripped = prdContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
          const prd = JSON.parse(stripped);
          const normId = (id: string) => id.replace(/-0*(\d+)$/, '$1');
          const frs: Record<string, string> = {};
          for (const fr of prd.functional_requirements ?? []) { if (fr.id && fr.requirement) frs[normId(fr.id)] = fr.requirement; }
          const nfrs: Record<string, string> = {};
          for (const nfr of prd.non_functional_requirements ?? []) { if (nfr.id && nfr.requirement) nfrs[normId(nfr.id)] = `[${nfr.category ?? nfr.priority ?? ''}] ${nfr.requirement}`.trim(); }
          setFrMap(frs);
          setNfrMap(nfrs);
        } catch { /* non-JSON or missing fields — tooltips just won't show */ }
      }
    }).finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [itemId, archived]);

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
      const updated = await api.refreshCompletedInitiative(itemId, archived);
      setDetail(updated);
      setEverRefreshed(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleArchiveToggle = async () => {
    setArchiving(true);
    try {
      if (archived) await api.unarchiveCompletedInitiative(itemId);
      else await api.archiveCompletedInitiative(itemId);
      setShowArchiveConfirm(false);
      onArchiveChange?.();
    } finally {
      setArchiving(false);
    }
  };

  // Build set of active feature indices (0-based) from the DB layer (ado_work_item_map).
  // The artifact may have more features than what's currently tracked — deleted features
  // should not appear in the Tickets tab. F1 = index 0, F5 = index 4, etc.
  const activeFeatureIndices = new Set<number>(
    (detail?.workItems ?? [])
      .filter(w => w.adoType === 'feature')
      .map(w => { const m = /^F(\d+)$/.exec(w.localKey); return m ? parseInt(m[1], 10) - 1 : -1; })
      .filter(i => i >= 0)
  );

  // Build the filtered backlog: only include features still present in the DB.
  // If all features are present (nothing deleted), skip rebuilding.
  const artifactFeatureCount = backlog?.features?.length ?? 0;
  const filteredBacklog: BacklogData | null = backlog && backlog.features && activeFeatureIndices.size < artifactFeatureCount
    ? { ...backlog, features: backlog.features.filter((_, i) => activeFeatureIndices.has(i)) }
    : backlog;

  // Remap stateByLocalKey to match the new 0-based indices in filteredBacklog.
  // e.g. if F5 becomes the 3rd feature after filtering, its stories need key 'F3.Sx' not 'F5.Sx'.
  const indexRemap = new Map<number, number>();
  let remapIdx = 0;
  for (let i = 0; i < artifactFeatureCount; i++) {
    if (activeFeatureIndices.has(i)) indexRemap.set(i, remapIdx++);
  }
  const stateByLocalKey = new Map<string, WorkItemStateBucket>(
    (detail?.workItems ?? [])
      .filter(w => w.stateBucket != null)
      .map(w => {
        const fm = /^F(\d+)$/.exec(w.localKey);
        if (fm) {
          const ni = indexRemap.get(parseInt(fm[1], 10) - 1);
          return ni != null ? [`F${ni + 1}`, w.stateBucket as WorkItemStateBucket] : null;
        }
        const sm = /^F(\d+)(\.S\d+)$/.exec(w.localKey);
        if (sm) {
          const ni = indexRemap.get(parseInt(sm[1], 10) - 1);
          return ni != null ? [`F${ni + 1}${sm[2]}`, w.stateBucket as WorkItemStateBucket] : null;
        }
        return [w.localKey, w.stateBucket as WorkItemStateBucket];
      })
      .filter(Boolean) as [string, WorkItemStateBucket][]
  );

  // ── Phase selector data ──────────────────────────────────────────────────────
  // Ordered phase list: use epicFeatures canonical order, fall back to backlog order.
  const phaseLabels: string[] = (() => {
    if (epicFeatures?.phases?.length) return epicFeatures.phases.map(p => p.label);
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const f of filteredBacklog?.features ?? []) {
      if (f.phase && !seen.has(f.phase)) { seen.add(f.phase); labels.push(f.phase); }
    }
    return labels;
  })();

  // Map each position in filteredBacklog.features → original feature key ("F1", "F3", …)
  // needed to match QA story_refs (always use original numbering, e.g. "F3.S2").
  const sortedActiveIndices = [...activeFeatureIndices].sort((a, b) => a - b);
  const filteredFeatureKeys = (filteredBacklog?.features ?? []).map((_, j) =>
    sortedActiveIndices[j] != null ? `F${sortedActiveIndices[j] + 1}` : `F${j + 1}`
  );

  // Feature keys belonging to the selected phase.
  // Source of truth: epicFeatures phase structure — each phase owns N consecutive features
  // by position, giving original F-keys without relying on the backlog's phase field.
  // Fall back to the backlog's own phase field when epicFeatures is absent.
  const phaseFeatureKeys = new Set<string>((() => {
    if (selectedPhase == null) return filteredFeatureKeys;
    if (epicFeatures?.phases?.length) {
      const keys: string[] = [];
      let epicIdx = 0;
      for (const phase of epicFeatures.phases) {
        const count = phase.features?.length ?? 0;
        if (phase.label === selectedPhase) {
          for (let i = epicIdx; i < epicIdx + count; i++) {
            if (activeFeatureIndices.size === 0 || activeFeatureIndices.has(i)) {
              keys.push(`F${i + 1}`);
            }
          }
        }
        epicIdx += count;
      }
      return keys;
    }
    return (filteredBacklog?.features ?? []).flatMap((f, j) =>
      f.phase === selectedPhase ? [filteredFeatureKeys[j]] : []
    );
  })());

  // Phase-scoped backlog (filter by feature key position, not by the backlog's phase field).
  const phaseBacklog: BacklogData | null = filteredBacklog && selectedPhase != null
    ? { ...filteredBacklog, features: (filteredBacklog.features ?? []).filter((_, j) => phaseFeatureKeys.has(filteredFeatureKeys[j])) }
    : filteredBacklog;

  // Phase-scoped ticket breakdown.
  const phaseTicketBreakdown = phaseBacklog ? countTicketsByPlatform(getAllStories(phaseBacklog)) : null;

  // Phase-scoped QA tests (filter by story_ref prefix matching phase feature keys).
  const phaseQa = qa && selectedPhase != null
    ? { ...qa, test_cases: qa.test_cases.filter(tc => {
        const prefix = typeof tc.story_ref === 'string' ? tc.story_ref.split('.')[0] : null;
        return prefix != null && phaseFeatureKeys.has(prefix);
      }) }
    : qa;

  // Phase-scoped test type breakdown.
  const phaseTestTypeCounts = phaseQa
    ? groupByType(phaseQa.test_cases).map(([type, cases]) => ({ type, count: cases.length, meta: typeMeta(type) }))
    : [];

  // Phase-scoped % complete — mirrors server logic: average statePercent across stories
  // (falling back to features if no stories), excluding removed items without a synced state.
  const phasePercentComplete: number | null = (() => {
    if (selectedPhase == null) return detail?.percentComplete ?? null;
    const phaseItems = (detail?.workItems ?? []).filter(w => {
      const prefix = w.localKey.includes('.') ? w.localKey.split('.')[0] : w.localKey;
      return phaseFeatureKeys.has(prefix) && w.statePercent != null && w.stateBucket !== 'removed';
    });
    const stories = phaseItems.filter(w => w.localKey.includes('.'));
    const items = stories.length > 0 ? stories : phaseItems.filter(w => /^F\d+$/.test(w.localKey));
    if (items.length === 0) return null;
    return Math.round(items.reduce((sum, w) => sum + (w.statePercent ?? 0), 0) / items.length);
  })();

  // ── Existing derived values ───────────────────────────────────────────────────
  const ticketBreakdown = phaseTicketBreakdown;
  const testTypeCounts = phaseTestTypeCounts;
  const visibleTabs = detail ? TABS.filter(t => visibleTabsFor(detail).has(t.key)) : TABS;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-50 dark:bg-surface-950">
      <PageHeaderTitle>
        <button
          onClick={() => onBack(everRefreshed)}
          className="flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Progress Tracker
        </button>
        <span className="text-surface-300 dark:text-surface-600">/</span>
        <span className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{detail?.title ?? 'Loading...'}</span>
      </PageHeaderTitle>
      <PageHeaderActions>
        {detail && detail.workItems.filter(w => w.adoType === 'epic' && w.adoUrl).map((e, i, arr) => (
          <a key={e.adoId} href={e.adoUrl!} target="_blank" rel="noreferrer" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
            {arr.length === 1 ? 'View Epic ↗' : `Epic ${i + 1} ↗`}
          </a>
        ))}
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-2.5 py-1 text-xs font-medium rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700/70 transition-colors disabled:opacity-50"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowArchiveConfirm(true)}
            disabled={loading}
            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors disabled:opacity-50 ${
              archived
                ? 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                : 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
            }`}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
      </PageHeaderActions>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {loading ? (
          <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
        ) : (
          <>
            {phaseLabels.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setSelectedPhase(null)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedPhase == null
                      ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                      : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'
                  }`}
                >
                  All phases
                </button>
                {phaseLabels.map(label => (
                  <button
                    key={label}
                    onClick={() => setSelectedPhase(label)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedPhase === label
                        ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                        : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

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
                <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{phaseQa?.test_cases.length ?? detail?.testCaseCount ?? 0}</p>
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {testTypeCounts.map(({ type, count, meta }) => (
                    <span key={type} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.color}`}>
                      {count} {meta.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 p-4 flex flex-col justify-center">
                <PercentBar percent={phasePercentComplete} />
                <p className={`text-[10px] mt-2 ${detail?.lastRefreshedAt == null ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500'}`}>
                  {detail?.lastRefreshedAt == null ? 'Needs refresh' : `Refreshed ${relativeTime(detail.lastRefreshedAt)}`}
                </p>
              </div>
            </div>

            <div>
              <div className="flex border-b border-surface-200 dark:border-surface-700">
                {visibleTabs.map(t => (
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
                  <div className="max-w-4xl mx-auto">
                    {phaseBacklog && (phaseBacklog.features?.length ?? 0) > 0 ? (
                      <BacklogView data={phaseBacklog} stateByLocalKey={stateByLocalKey} epicFeatures={epicFeatures ?? undefined} frMap={frMap} nfrMap={nfrMap} />
                    ) : (
                      <p className="text-sm text-surface-400 italic">No backlog content found for this initiative.</p>
                    )}
                  </div>
                )}

                {tab === 'tests' && (
                  <div className="max-w-4xl mx-auto space-y-4">
                    {phaseQa && phaseQa.test_cases.length > 0 ? (
                      <QATestsView data={phaseQa} />
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
                            Plan #{plan.planId}{(() => { const c = plan.artifactId != null ? (testCountByArtifactId.get(plan.artifactId) ?? plan.testCaseCount) : plan.testCaseCount; return c != null ? ` · ${c} test cases` : ''; })()} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'figma' && <FigmaTabContent state={docCache.figma} />}
                {(tab === 'research' || tab === 'prd' || tab === 'architecture') && <DocumentTabContent state={docCache[tab]} />}
                {tab === 'manage' && detail && (
                  <WorkItemManagePanel
                    items={detail.workItems}
                    itemId={itemId}
                    archived={archived}
                    onUpdate={updated => { setDetail(updated); setEverRefreshed(true); }}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {showArchiveConfirm && (
        <ArchiveConfirmModal
          mode={archived ? 'unarchive' : 'archive'}
          itemTitle={detail?.title ?? ''}
          loading={archiving}
          onCancel={() => setShowArchiveConfirm(false)}
          onConfirm={handleArchiveToggle}
        />
      )}
    </div>
  );
}
