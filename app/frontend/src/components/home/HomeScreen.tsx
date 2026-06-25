import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { AirtableItem } from '@pap/shared';
import { api } from '../../services/api';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToast } from '../../hooks/useToast';
import { TOGGLEABLE_STAGES } from '../../constants/stage-labels';
import { extractReadyPayload } from '../../utils/coordinator-helpers';
import { InitiativeCard } from './InitiativeCard';
import { HomeHeader } from './HomeHeader';
import { PageHeaderActions } from '../common/PageHeaderActions';
import { NewInitiativeForm } from './NewInitiativeForm';
import { LaunchPipelineModal } from './LaunchPipelineModal';
import { effectiveStatus, STATUS_FILTERS, type EnrichedItem, type LaunchPhase, type StatusFilter } from './types';

let _cachedLocalItems: EnrichedItem[] = [];

// Survives HomeScreen unmount/remount (e.g. entering an initiative and clicking back)
// so the filter choice sticks. Only resets on a full UI reload or — via
// resetHomeScreenFilter() — when a new login session starts.
let _cachedStatusFilter: StatusFilter = 'mine';

// Whether the initial pending-count check has already decided the default filter
// this session. Prevents re-forcing 'all' every time the count happens to be 0
// after the user has made their own filter choice.
let _defaultFilterResolved = false;

/** Reset the cached status filter back to its default. Call on logout so the next login starts fresh. */
export function resetHomeScreenFilter(): void {
  _cachedStatusFilter = 'mine';
  _defaultFilterResolved = false;
}

export function HomeScreen() {
  const [localItems, setLocalItemsRaw] = useState<EnrichedItem[]>(_cachedLocalItems);
  const [loading, setLoading] = useState(_cachedLocalItems.length === 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilterRaw] = useState<StatusFilter>(_cachedStatusFilter);
  const setStatusFilter = (f: StatusFilter) => { _cachedStatusFilter = f; setStatusFilterRaw(f); };
  const [productAreaFilter, setProductAreaFilter] = useState<string>('all');
  const [themeFilter, setThemeFilter] = useState<string>('all');
  const [myPendingCount, setMyPendingCount] = useState(0);
  const [mineWorkflowIds, setMineWorkflowIds] = useState<Set<string>>(new Set());
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const { user, noAuth } = useAuthStore();
  const { isDemoMode } = useSettingsStore();

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
  const [launchError, setLaunchError] = useState<string | null>(null);
  const planningSessionIdRef = useRef<string | null>(null);

  const { setSelectedItem, clearSession } = useSessionStore();
  const { applyWorkflowStatus, resetWorkflow, addCoordinatorMessage, setPlanningSessionId } = useWorkflowStore();
  const { config } = useConfigStore();
  const toast = useToast();
  const demoTriggerInFlightRef = useRef(false);

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
      setItemsLoaded(true);
    }
  }, []);

  useEffect(() => { loadLocalItems(); }, []);

  // Fetch my pending approvals count (only when authenticated)
  const loadMyPending = useCallback(async () => {
    if (!user && !noAuth) return;
    try {
      const [countData, listData] = await Promise.all([
        api.getMyPendingCount(),
        api.getWorkflowListFiltered(true),
      ]);
      setMyPendingCount(countData.count);
      setMineWorkflowIds(new Set(listData.workflows.map((w: any) => w.id)));
      if (!_defaultFilterResolved) {
        _defaultFilterResolved = true;
        if (countData.count === 0 && _cachedStatusFilter === 'mine') setStatusFilter('all');
      }
    } catch { /* */ }
  }, [user, noAuth]);

  useEffect(() => { loadMyPending(); }, [loadMyPending]);

  useEffect(() => {
    const hasDemoItem = localItems.some(item => item.workflow?.isDemo);
    if (!isDemoMode || !itemsLoaded || hasDemoItem || demoTriggerInFlightRef.current) return;

    demoTriggerInFlightRef.current = true;
    api.triggerDemoWebhook(0)
      .then(result => {
        window.dispatchEvent(new CustomEvent('demo-run-started', { detail: { title: result.initiative } }));
        window.dispatchEvent(new CustomEvent('refresh-initiatives'));
        return loadLocalItems();
      })
      .catch(err => {
        toast.error(err.response?.data?.error || err.message || 'Failed to start demo run');
      })
      .finally(() => {
        demoTriggerInFlightRef.current = false;
      });
  }, [isDemoMode, itemsLoaded, localItems, loadLocalItems, toast]);

  // Listen for refresh signal from App.tsx (e.g. after Full Demo triggers)
  useEffect(() => {
    const handler = () => loadLocalItems();
    window.addEventListener('refresh-initiatives', handler);
    return () => window.removeEventListener('refresh-initiatives', handler);
  }, [loadLocalItems]);

  // Poll for status updates while any workflow or pipeline is active
  useEffect(() => {
    const hasActive = localItems.some(i => {
      const wf = i.workflow;
      if (!wf) return false;
      if (wf.status === 'active' || wf.status === 'paused_at_checkpoint') return true;
      if (wf.status === 'complete' && wf.pipelineStatus && wf.pipelineStatus !== 'complete') return true;
      return false;
    });
    if (!hasActive) return;
    const id = setInterval(loadLocalItems, 4000);
    return () => clearInterval(id);
  }, [localItems, loadLocalItems]);

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
    if ((item as EnrichedItem).workflow?.isDemo) return;
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
        launchItem.productArea,
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

  const visibleItems = useMemo(
    () => isDemoMode ? localItems : localItems.filter(item => !item.workflow?.isDemo),
    [localItems, isDemoMode]
  );

  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    const c: Record<StatusFilter, number> = { all: visibleItems.length, active: 0, review: 0, done: 0, stopped: 0, new: 0, mine: myPendingCount };
    visibleItems.forEach(item => {
      const s = item.workflow ? effectiveStatus(item.workflow) : undefined;
      if (s === 'active') c.active++;
      else if (s === 'paused_at_checkpoint') c.review++;
      else if (s === 'cancelled') c.stopped++;
      else if (s === 'complete') c.done++;
      else c.new++;
    });
    return c;
  }, [visibleItems, myPendingCount]);

  const productAreas = useMemo(
    () => Array.from(new Set(visibleItems.map(i => i.productArea).filter((v): v is string => !!v))).sort(),
    [visibleItems]
  );
  const themes = useMemo(
    () => Array.from(new Set(visibleItems.map(i => i.strategicTheme).filter((v): v is string => !!v))).sort(),
    [visibleItems]
  );

  const filteredLocalItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return visibleItems.filter(item => {
      const s = item.workflow ? effectiveStatus(item.workflow) : undefined;
      // Stopped initiatives never count as needing review/approval, even if a
      // checkpoint was left pending at the moment the workflow was cancelled.
      if (statusFilter === 'mine' && (!item.workflow || s === 'cancelled' || !mineWorkflowIds.has(item.workflow.id))) return false;
      if (statusFilter === 'active' && s !== 'active') return false;
      if (statusFilter === 'review' && s !== 'paused_at_checkpoint') return false;
      if (statusFilter === 'done' && s !== 'complete') return false;
      if (statusFilter === 'stopped' && s !== 'cancelled') return false;
      if (statusFilter === 'new' && item.workflow) return false;
      if (productAreaFilter !== 'all' && item.productArea !== productAreaFilter) return false;
      if (themeFilter !== 'all' && item.strategicTheme !== themeFilter) return false;
      if (!q) return true;
      const qId = q.replace(/^#/, '');
      return item.initiative.toLowerCase().includes(q)
        || (item.description?.toLowerCase().includes(q) ?? false)
        || (qId.length > 0 && item.seqNum != null && String(item.seqNum).includes(qId));
    });
  }, [visibleItems, statusFilter, searchQuery, mineWorkflowIds, productAreaFilter, themeFilter]);

  const openForm = () => {
    setShowForm(true);
    Promise.resolve().then(() => titleInputRef.current?.focus());
  };

  const hasResults = filteredLocalItems.length > 0;
  const hasActiveFilters = !!searchQuery || statusFilter !== 'all' || productAreaFilter !== 'all' || themeFilter !== 'all';
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setProductAreaFilter('all');
    setThemeFilter('all');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-50 dark:bg-surface-950">

      {/* Search + filters, portaled into the shared PageHeader */}
      <PageHeaderActions>
        <HomeHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchInputRef={searchInputRef}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          statusCounts={statusCounts}
          myPendingCount={myPendingCount}
          showMineFilter={!noAuth && !!user}
          productAreas={productAreas}
          productAreaFilter={productAreaFilter}
          onProductAreaFilterChange={setProductAreaFilter}
          themes={themes}
          themeFilter={themeFilter}
          onThemeFilterChange={setThemeFilter}
        />
      </PageHeaderActions>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-6">

          {/* Creation form */}
          {showForm && (
            <NewInitiativeForm
              title={formTitle}
              description={formDesc}
              onTitleChange={setFormTitle}
              onDescriptionChange={setFormDesc}
              saving={savingForm}
              onCreate={handleCreateInitiative}
              onCancel={cancelForm}
              titleInputRef={titleInputRef}
            />
          )}

          {/* No results state */}
          {!loading && hasActiveFilters && !hasResults && (
            <div className="py-16 text-center">
              <p className="text-sm text-surface-400 dark:text-surface-500">
                No initiatives match
                {searchQuery && <> "<span className="font-medium">{searchQuery}</span>"</>}
                {statusFilter !== 'all' && <> with status <span className="font-medium">{STATUS_FILTERS.find(f => f.key === statusFilter)?.label}</span></>}
                {productAreaFilter !== 'all' && <> in <span className="font-medium">{productAreaFilter}</span></>}
                {themeFilter !== 'all' && <> themed <span className="font-medium">{themeFilter}</span></>}
              </p>
              <button
                onClick={clearFilters}
                className="mt-2 text-xs text-brand-600 dark:text-brand-400 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Empty state (no initiatives at all) */}
          {!loading && visibleItems.length === 0 && !showForm && (
            <div className="py-16 rounded-xl border-2 border-dashed border-surface-200 dark:border-surface-700 text-center">
              <p className="text-sm font-medium text-surface-500 dark:text-surface-400 mb-1">No initiatives yet</p>
              <p className="text-xs text-surface-400 dark:text-surface-500 mb-4 max-w-xs mx-auto">
                Add a detailed description and the pipeline will run autonomously — from research through to backlog.
              </p>
              <button
                onClick={openForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create first initiative
              </button>
            </div>
          )}

          {/* Initiatives */}
          {(filteredLocalItems.length > 0 || (loading && localItems.length === 0)) && (
            <section>
              {loading && localItems.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-surface-200 dark:bg-surface-800 animate-pulse" />
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
                </div>
              )}
            </section>
          )}

        </div>
      </div>

      {/* Launch confirmation modal */}
      {launchItem && launchPhase && (
        <LaunchPipelineModal
          item={launchItem}
          phase={launchPhase}
          stageRationale={stageRationale}
          availableStages={availableStages}
          enabledStages={enabledStages}
          enabledCount={enabledCount}
          error={launchError}
          onToggleStage={(key) => setEnabledStages(prev => ({ ...prev, [key]: !prev[key] }))}
          onConfirm={handleConfirmLaunch}
          onCancel={handleCancelLaunch}
        />
      )}
    </div>
  );
}

