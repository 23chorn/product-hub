import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { AirtableItem } from '@pap/shared';
import { api } from '../services/api';
import { useSessionStore } from '../stores/sessionStore';
import { useConfigStore } from '../stores/configStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useToast } from '../hooks/useToast';
import { TOGGLEABLE_STAGES } from '../constants/stage-labels';
import { extractReadyPayload } from '../utils/coordinator-helpers';


type WorkflowInfo = { id: string; status: string; currentStage: string | null; summary: string | null };
type EnrichedItem = AirtableItem & { workflow?: WorkflowInfo };
type LaunchPhase = 'analyzing' | 'confirming' | 'launching';
type StatusFilter = 'all' | 'active' | 'review' | 'done' | 'new';

let _cachedLocalItems: EnrichedItem[] = [];

const SAMPLE_TITLE = 'Price Alerts & Watchlist — TradeEasy';
const SAMPLE_DESCRIPTION = `Build a price alert and notification system for retail investors on the TradeEasy mobile trading app.

Who it's for: Retail investors (ages 25–45) who actively monitor 5–20 positions and miss entry/exit opportunities because they can't watch prices throughout the day.

Core problem: Users currently set limit orders as a price-watching workaround, but those orders execute unintentionally. There is no way to be notified when a price threshold is crossed without committing to a trade.

Key outcomes:
- Users can set price alerts (above/below threshold) on any tradable instrument
- Push notifications delivered within 30 seconds of the trigger price being hit
- Reduce unintended limit order executions by 25%

Scope: MVP — iOS and Android push notifications for equities and ETFs only. No options, no recurring alerts. Alert history retained for 30 days.

Constraints:
- Notification copy must not imply investment advice (regulatory requirement)
- Real-time price feed available via internal WebSocket market data service
- Max 30-second delivery latency from trigger to device
- Team: 2 iOS, 2 Android, 2 backend engineers`;

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all',    label: 'All' },
  { key: 'active', label: 'Running' },
  { key: 'review', label: 'Needs review' },
  { key: 'done',   label: 'Done' },
  { key: 'new',    label: 'Not started' },
];

function StatusBadge({ wf }: { wf?: WorkflowInfo }) {
  if (!wf) return null;
  const label = wf.status === 'complete' ? 'Done'
    : wf.status === 'paused_at_checkpoint' ? 'Review'
    : wf.status === 'active' ? 'Running'
    : wf.status;
  const color = wf.status === 'complete'
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    : wf.status === 'paused_at_checkpoint'
    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    : wf.status === 'active'
    ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400'
    : 'bg-slate-100 dark:bg-slate-700 text-slate-500';
  return (
    <span className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${color}`}>
      {wf.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />}
      {label}
    </span>
  );
}

export function HomeScreen() {
  const [localItems, setLocalItemsRaw] = useState<EnrichedItem[]>(_cachedLocalItems);
  const [loading, setLoading] = useState(_cachedLocalItems.length === 0);
  const [pipelineReadyItems, setPipelineReadyItems] = useState<EnrichedItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [savingForm, setSavingForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [launchItem, setLaunchItem] = useState<EnrichedItem | null>(null);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase | null>(null);
  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>({});
  const [stageRationale, setStageRationale] = useState<string | null>(null);
  const [enrichedContext, setEnrichedContext] = useState<string | null>(null);
  const [kbQueries, setKbQueries] = useState<string[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const planningSessionIdRef = useRef<string | null>(null);

  const { setSelectedItem, clearSession } = useSessionStore();
  const { applyWorkflowStatus, resetWorkflow, addCoordinatorMessage, setPlanningSessionId } = useWorkflowStore();
  const { config } = useConfigStore();
  const toast = useToast();

  const configEnabledStages = config?.stages?.enabledStages;
  const availableStages = TOGGLEABLE_STAGES.filter(
    s => s.key === 'curator' || !configEnabledStages || configEnabledStages[s.key] !== false
  );

  const setLocalItems = (d: EnrichedItem[]) => { _cachedLocalItems = d; setLocalItemsRaw(d); };

  const loadLocalItems = useCallback(async () => {
    try {
      const data = await api.getInitiatives();
      setLocalItems(data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLocalItems(); }, []);

  // Listen for refresh signal from App.tsx (e.g. after Full Demo triggers)
  useEffect(() => {
    const handler = () => loadLocalItems();
    window.addEventListener('refresh-initiatives', handler);
    return () => window.removeEventListener('refresh-initiatives', handler);
  }, [loadLocalItems]);

  // Poll for status updates while any workflow is active
  useEffect(() => {
    const hasActive = localItems.some(
      i => i.workflow?.status === 'active' || i.workflow?.status === 'paused_at_checkpoint'
    );
    if (!hasActive) return;
    const id = setInterval(loadLocalItems, 4000);
    return () => clearInterval(id);
  }, [localItems, loadLocalItems]);

  const handleSyncAirtable = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const data = await api.getItemsPipelineReady();
      setPipelineReadyItems(data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to sync from Airtable');
    } finally {
      setSyncing(false);
    }
  };

  const cancelForm = () => { setFormTitle(''); setFormDesc(''); setShowForm(false); };

  const handleCreateInitiative = async () => {
    if (!formTitle.trim() || savingForm) return;
    try {
      setSavingForm(true);
      await api.createInitiative(formTitle.trim(), formDesc.trim() || undefined);
      await loadLocalItems();
      cancelForm();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to create initiative');
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteInitiative = async (item: AirtableItem) => {
    if (deletingId) return;
    setConfirmDeleteId(null);
    try {
      setDeletingId(item.id);
      await api.deleteInitiative(item.id);
      setLocalItems(localItems.filter(i => i.id !== item.id));
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const handleResumeWorkflow = async (item: EnrichedItem) => {
    setSelectedItem(item);
    clearSession();
    if (item.workflow) {
      try {
        const status = await api.getWorkflowStatus(item.workflow.id);
        applyWorkflowStatus(status);
      } catch { resetWorkflow(); }
    }
  };

  const handleInitiateLaunch = async (item: EnrichedItem) => {
    setLaunchItem(item);
    setLaunchPhase('analyzing');
    setLaunchError(null);
    planningSessionIdRef.current = null;

    const goal = item.description
      ? `${item.initiative}\n\n${item.description}`
      : item.initiative;

    try {
      await api.openCoordinatorPlanning(
        goal,
        (sessionId) => {
          planningSessionIdRef.current = sessionId;
          localStorage.setItem('coordinatorPlanningSessionId', sessionId);
        },
        () => {},
        (fullContent) => {
          const payload = extractReadyPayload(fullContent);
          const recommended = payload.recommendedStages ? new Set(payload.recommendedStages) : null;
          setEnabledStages(Object.fromEntries(
            availableStages.map(s => [s.key, recommended ? recommended.has(s.key) : true])
          ));
          setStageRationale(payload.stageRationale);
          setEnrichedContext(payload.enrichedContext);
          setKbQueries(payload.kbQueries || []);
          setLaunchPhase('confirming');
        },
        (err) => { setLaunchError(err); setLaunchPhase(null); },
      );
    } catch (err: any) {
      setLaunchError(err.message ?? 'Analysis failed');
      setLaunchPhase(null);
    }
  };

  const handleConfirmLaunch = async () => {
    if (!launchItem) return;
    setLaunchPhase('launching');
    setLaunchError(null);
    try {
      const selectedStages = availableStages.filter(s => enabledStages[s.key]).map(s => s.key);
      const goal = launchItem.description
        ? `${launchItem.initiative}\n\n${launchItem.description}`
        : launchItem.initiative;

      setSelectedItem(launchItem);
      clearSession();
      resetWorkflow();

      const result = await api.startWorkflow(
        launchItem.id, goal, enrichedContext ?? undefined,
        selectedStages, undefined,
        planningSessionIdRef.current ?? undefined,
        kbQueries,
      );
      const status = await api.getWorkflowStatus(result.workflowId);
      applyWorkflowStatus(status);
      localStorage.removeItem('coordinatorPlanningSessionId');
      setPlanningSessionId(null);
      addCoordinatorMessage({
        role: 'coordinator',
        content: `Workflow started for **${launchItem.initiative}**. Running ${selectedStages.length} stages — I'll keep you updated.`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      setLaunchError(err.response?.data?.error ?? err.message ?? 'Launch failed');
      setLaunchPhase('confirming');
    }
  };

  const handleCancelLaunch = () => {
    if (planningSessionIdRef.current) localStorage.removeItem('coordinatorPlanningSessionId');
    setLaunchItem(null);
    setLaunchPhase(null);
    setLaunchError(null);
  };

  const enabledCount = Object.values(enabledStages).filter(Boolean).length;

  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    const c: Record<StatusFilter, number> = { all: localItems.length, active: 0, review: 0, done: 0, new: 0 };
    localItems.forEach(item => {
      const s = item.workflow?.status;
      if (s === 'active') c.active++;
      else if (s === 'paused_at_checkpoint') c.review++;
      else if (s === 'complete') c.done++;
      else c.new++;
    });
    return c;
  }, [localItems]);

  const filteredLocalItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return localItems.filter(item => {
      const s = item.workflow?.status;
      if (statusFilter === 'active' && s !== 'active') return false;
      if (statusFilter === 'review' && s !== 'paused_at_checkpoint') return false;
      if (statusFilter === 'done' && s !== 'complete') return false;
      if (statusFilter === 'new' && item.workflow) return false;
      if (!q) return true;
      return item.initiative.toLowerCase().includes(q) || (item.description?.toLowerCase().includes(q) ?? false);
    });
  }, [localItems, statusFilter, searchQuery]);

  const openForm = () => {
    setShowForm(true);
    Promise.resolve().then(() => titleInputRef.current?.focus());
  };

  const hasResults = filteredLocalItems.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">

      {/* Sticky page header with search + filters */}
      <div className="flex-shrink-0 bg-white/90 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-3">

          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Welcome to Product Hub</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl leading-relaxed">
                Describe a new product initiative and a team of AI agents runs the full pipeline — research, PRD, architecture, backlog, and QA — ready for engineering.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleSyncAirtable}
                disabled={syncing}
                title="Sync Pipeline Ready initiatives from Airtable"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? 'Syncing…' : 'Sync Airtable'}
              </button>
              <button
                onClick={openForm}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Initiative
              </button>
            </div>
          </div>

          {/* Search + status filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearchQuery(''); }}
                placeholder="Search initiatives…"
                className="w-full pl-8 pr-7 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_FILTERS.map(f => {
                const count = statusCounts[f.key];
                const isActive = statusFilter === f.key;
                const isReview = f.key === 'review';
                return (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                      isActive
                        ? isReview
                          ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-200 font-medium'
                          : 'bg-teal-50 dark:bg-teal-900/40 border-teal-300 dark:border-teal-600 text-teal-800 dark:text-teal-200 font-medium'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                    }`}
                  >
                    {f.label}
                    {count > 0 && f.key !== 'all' && (
                      <span className={`ml-1 ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                        {count}
                      </span>
                    )}
                    {f.key === 'all' && (
                      <span className={`ml-1 ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-6">

          {/* Creation form */}
          {showForm && (
            <div className="p-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">New Initiative</p>
                <button onClick={cancelForm} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <input
                ref={titleInputRef}
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') cancelForm(); }}
                placeholder="Initiative name"
                className="w-full px-3 py-2 text-sm border border-teal-300 dark:border-teal-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
              <textarea
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder={`Describe the initiative in detail — who it's for, the core problem, key outcomes, scope, and constraints.\n\nThe richer the description, the less the coordinator needs to ask.`}
                rows={6}
                className="w-full px-3 py-2 text-sm border border-teal-300 dark:border-teal-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 resize-none"
              />
              <button
                type="button"
                onClick={() => { setFormTitle(SAMPLE_TITLE); setFormDesc(SAMPLE_DESCRIPTION); }}
                className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
              >
                Load demo sample
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateInitiative}
                  disabled={!formTitle.trim() || savingForm}
                  className="flex-1 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  {savingForm ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={cancelForm}
                  className="px-4 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* No results state */}
          {!loading && (searchQuery || statusFilter !== 'all') && !hasResults && (
            <div className="py-16 text-center">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No initiatives match
                {searchQuery && <> "<span className="font-medium">{searchQuery}</span>"</>}
                {statusFilter !== 'all' && <> with status <span className="font-medium">{STATUS_FILTERS.find(f => f.key === statusFilter)?.label}</span></>}
              </p>
              <button
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                className="mt-2 text-xs text-teal-600 dark:text-teal-400 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Empty state (no initiatives at all) */}
          {!loading && localItems.length === 0 && !showForm && (
            <div className="py-16 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">No initiatives yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 max-w-xs mx-auto">
                Add a detailed description and the pipeline will run autonomously — from research through to backlog.
              </p>
              <button
                onClick={openForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create first initiative
              </button>
            </div>
          )}

          {/* Initiatives */}
          {(filteredLocalItems.length > 0 || pipelineReadyItems.length > 0 || (loading && localItems.length === 0)) && (
            <section>
              {loading && localItems.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredLocalItems.map(item => (
                    <InitiativeCard
                      key={item.id}
                      item={item}
                      isDeleting={deletingId === item.id}
                      isConfirmingDelete={confirmDeleteId === item.id}
                      isAnalysing={launchItem?.id === item.id && (launchPhase === 'analyzing' || launchPhase === 'launching')}
                      onLaunch={() => handleInitiateLaunch(item)}
                      onResume={() => handleResumeWorkflow(item)}
                      onRequestDelete={() => setConfirmDeleteId(item.id)}
                      onConfirmDelete={() => handleDeleteInitiative(item)}
                      onCancelDelete={() => setConfirmDeleteId(null)}
                    />
                  ))}
                  {pipelineReadyItems.map(item => (
                    <AirtableInitiativeCard
                      key={item.id}
                      item={item}
                      isAnalysing={launchItem?.id === item.id && (launchPhase === 'analyzing' || launchPhase === 'launching')}
                      onLaunch={() => handleInitiateLaunch(item)}
                      onResume={() => handleResumeWorkflow(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </div>

      {/* Launch confirmation modal */}
      {launchItem && launchPhase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 px-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                {launchPhase === 'analyzing' ? 'Analysing Brief' : launchPhase === 'launching' ? 'Launching' : 'Configure Pipeline'}
              </p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {launchItem.initiative}
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              {launchPhase === 'analyzing' && (
                <div className="flex items-center gap-3 py-3">
                  <svg className="w-4 h-4 text-teal-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Analysing brief and selecting stages…
                  </p>
                </div>
              )}

              {(launchPhase === 'confirming' || launchPhase === 'launching') && (
                <>
                  {stageRationale && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {stageRationale}
                    </p>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                      Stages
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {availableStages.map(stage => {
                        const enabled = enabledStages[stage.key];
                        const isLastEnabled = enabled && enabledCount === 1;
                        return (
                          <button
                            key={stage.key}
                            type="button"
                            disabled={isLastEnabled || launchPhase === 'launching'}
                            onClick={() => setEnabledStages(prev => ({ ...prev, [stage.key]: !prev[stage.key] }))}
                            title={isLastEnabled ? 'At least one stage required' : `${enabled ? 'Remove' : 'Add'} ${stage.label}`}
                            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                              enabled
                                ? 'bg-teal-50 dark:bg-teal-900/40 border-teal-300 dark:border-teal-600 text-teal-800 dark:text-teal-200 font-medium'
                                : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 line-through'
                            } ${isLastEnabled || launchPhase === 'launching' ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}
                          >
                            {stage.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {launchError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{launchError}</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleConfirmLaunch}
                      disabled={launchPhase === 'launching' || enabledCount === 0}
                      className="flex-1 py-2.5 text-sm font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                    >
                      {launchPhase === 'launching' ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Launching…
                        </span>
                      ) : 'Launch pipeline →'}
                    </button>
                    <button
                      onClick={handleCancelLaunch}
                      disabled={launchPhase === 'launching'}
                      className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Initiative card (local) ──────────────────────────────────────────────────
function InitiativeCard({
  item, isDeleting, isConfirmingDelete, isAnalysing,
  onLaunch, onResume, onRequestDelete, onConfirmDelete, onCancelDelete,
}: {
  item: EnrichedItem;
  isDeleting: boolean;
  isConfirmingDelete: boolean;
  isAnalysing: boolean;
  onLaunch: () => void;
  onResume: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const wf = item.workflow;
  const isActive = wf?.status === 'active' || wf?.status === 'paused_at_checkpoint';
  const isComplete = wf?.status === 'complete';

  return (
    <div
      title={item.description || undefined}
      className="relative group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all"
    >
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words min-w-0">
              {wf?.summary || item.initiative}
            </h3>
            <StatusBadge wf={wf} />
          </div>
          {wf?.currentStage && (wf.status === 'active' || wf.status === 'paused_at_checkpoint') && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              {wf.status === 'paused_at_checkpoint' ? 'Waiting for review' : `Running ${wf.currentStage.replace(/_/g, ' ')}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          {/* Action button */}
          {!isConfirmingDelete && (
            isActive ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium transition-colors">
                Continue →
              </button>
            ) : isComplete ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-teal-300 hover:text-teal-600 dark:hover:text-teal-400 font-medium transition-colors">
                View →
              </button>
            ) : (
              <button onClick={onLaunch} disabled={isAnalysing}
                className="text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-medium transition-colors flex items-center gap-1.5">
                {isAnalysing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Analysing…
                  </>
                ) : 'Launch →'}
              </button>
            )
          )}

          {/* Delete controls */}
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <button onClick={onConfirmDelete} disabled={isDeleting}
                className="text-[10px] px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 font-medium">
                Delete
              </button>
              <button onClick={onCancelDelete}
                className="text-[10px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onRequestDelete(); }} disabled={isDeleting}
              className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-500 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Airtable Pipeline Ready card ─────────────────────────────────────────────
function AirtableInitiativeCard({
  item, isAnalysing, onLaunch, onResume,
}: {
  item: EnrichedItem;
  isAnalysing: boolean;
  onLaunch: () => void;
  onResume: () => void;
}) {
  const wf = item.workflow;
  const isActive = wf?.status === 'active' || wf?.status === 'paused_at_checkpoint';
  const isComplete = wf?.status === 'complete';

  return (
    <div
      title={item.description || undefined}
      className="relative group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all"
    >
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words min-w-0">
              {item.initiative}
            </h3>
            <StatusBadge wf={wf} />
          </div>
          {item.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{item.description}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.productArea && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400">
                {item.productArea}
              </span>
            )}
            {item.strategicTheme && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                {item.strategicTheme}
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 mt-0.5">
          {isActive ? (
            <button onClick={onResume} className="text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium transition-colors">
              Continue →
            </button>
          ) : isComplete ? (
            <button onClick={onResume} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-teal-300 hover:text-teal-600 dark:hover:text-teal-400 font-medium transition-colors">
              View →
            </button>
          ) : (
            <button onClick={onLaunch} disabled={isAnalysing} className="text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-medium transition-colors flex items-center gap-1.5">
              {isAnalysing ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Analysing…
                </>
              ) : 'Launch →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

