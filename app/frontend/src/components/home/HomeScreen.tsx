import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { AirtableItem } from '@pap/shared';
import { api } from '../../services/api';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAuthStore, canLaunchWorkflow } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToast } from '../../hooks/useToast';
import { TOGGLEABLE_STAGES, WORKFLOW_PRESETS } from '../../constants/stage-labels';
import { InitiativeCard } from './InitiativeCard';
import { HomeHeader } from './HomeHeader';
import { PageHeaderActions } from '../common/PageHeaderActions';
import { NewInitiativeForm } from './NewInitiativeForm';
import { LaunchPipelineModal } from './LaunchPipelineModal';
import { AssignUserFlyout } from '../common/AssignUserFlyout';
import { effectiveStatus, STATUS_FILTERS, type EnrichedItem, type LaunchPhase, type StatusFilter, type WorkflowPreset } from './types';

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
  const [myPendingCount, setMyPendingCount] = useState(0);
  const [mineWorkflowIds, setMineWorkflowIds] = useState<Set<string>>(new Set());
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const { user, noAuth } = useAuthStore();
  const isAdmin = noAuth || !!user?.is_admin;
  const { isDemoMode } = useSettingsStore();

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formProductArea, setFormProductArea] = useState('');
  const [formTheme, setFormTheme] = useState('');
  const [savingForm, setSavingForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [assignFlyoutItemId, setAssignFlyoutItemId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [launchItem, setLaunchItem] = useState<EnrichedItem | null>(null);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase | null>(null);
  const [launchPreset, setLaunchPreset] = useState<WorkflowPreset>('full');
  const [launchError, setLaunchError] = useState<string | null>(null);

  const { setSelectedItem, clearSession } = useSessionStore();
  const { applyWorkflowStatus, resetWorkflow, addCoordinatorMessage, setPlanningSessionId } = useWorkflowStore();
  const { config } = useConfigStore();
  const toast = useToast();
  const demoTriggerInFlightRef = useRef(false);

  const configEnabledStages = config?.stages?.enabledStages;
  const availableStages = TOGGLEABLE_STAGES.filter(
    s => s.key === 'curator' || !configEnabledStages || configEnabledStages[s.key] !== false
  );
  const smallStages = WORKFLOW_PRESETS.small.filter(
    s => !configEnabledStages || configEnabledStages[s.key] !== false
  );

  const setLocalItems = (d: EnrichedItem[]) => { _cachedLocalItems = d; setLocalItemsRaw(d); };

  const loadLocalItems = useCallback(async (includeArchived = false) => {
    try {
      const data = await api.getInitiatives(includeArchived);
      setLocalItems(data);
    } catch { /* silent */ } finally {
      setLoading(false);
      setItemsLoaded(true);
    }
  }, []);

  useEffect(() => { loadLocalItems(statusFilter === 'archived'); }, [statusFilter, loadLocalItems]);

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

  // Auto-trigger demo webhook once when demo mode is enabled and items are loaded (but no demo item exists yet).
  // Only trigger when viewing the active list (not archived), and only once per session using a ref.
  useEffect(() => {
    if (!isDemoMode || !itemsLoaded || statusFilter === 'archived') return;

    const hasDemoItem = localItems.some(item => item.workflow?.isDemo);
    if (hasDemoItem || demoTriggerInFlightRef.current) return;

    demoTriggerInFlightRef.current = true;
    api.triggerDemoWebhook(0)
      .then(result => {
        window.dispatchEvent(new CustomEvent('demo-run-started', { detail: { title: result.initiative } }));
        window.dispatchEvent(new CustomEvent('refresh-initiatives'));
      })
      .catch(err => {
        toast.error(err.response?.data?.error || err.message || 'Failed to start demo run');
        // On error, reset the ref so user can retry
        demoTriggerInFlightRef.current = false;
      });
    // Don't reset demoTriggerInFlightRef on success — keep it true so we don't re-trigger
  }, [isDemoMode, itemsLoaded, localItems, statusFilter, toast]);

  // Listen for refresh signal from App.tsx (e.g. after Full Demo triggers)
  useEffect(() => {
    const handler = () => {
      loadLocalItems(statusFilter === 'archived');
      loadMyPending();
    };
    window.addEventListener('refresh-initiatives', handler);
    return () => window.removeEventListener('refresh-initiatives', handler);
  }, [loadLocalItems, loadMyPending, statusFilter]);

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
    const id = setInterval(() => {
      loadLocalItems(statusFilter === 'archived');
      loadMyPending();
    }, 4000);
    return () => clearInterval(id);
  }, [localItems, loadLocalItems, loadMyPending, statusFilter]);

  const cancelForm = () => { setFormTitle(''); setFormDesc(''); setFormProductArea(''); setFormTheme(''); setShowForm(false); };

  const handleCreateInitiative = async () => {
    if (!formTitle.trim() || savingForm) return;
    try {
      setSavingForm(true);
      await api.createInitiative(
        formTitle.trim(),
        formDesc.trim() || undefined,
        formProductArea.trim() || undefined,
        formTheme.trim() || undefined,
      );
      await Promise.all([
        loadLocalItems(),
        loadMyPending(),
      ]);
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

  const handleArchiveInitiative = async (item: AirtableItem) => {
    if (archivingId) return;
    setConfirmArchiveId(null);
    const isArchived = item.status === 'archived';
    try {
      setArchivingId(item.id);
      if (isArchived) {
        await api.unarchiveInitiative(item.id);
        toast.success('Initiative unarchived');
      } else {
        await api.archiveInitiative(item.id);
        toast.success('Initiative archived');
      }
      // Reload the current view (archived or active) and refresh pending counts
      await Promise.all([
        loadLocalItems(statusFilter === 'archived'),
        loadMyPending(),
      ]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || `Failed to ${isArchived ? 'unarchive' : 'archive'}`);
    } finally {
      setArchivingId(null);
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

  const handleInitiateLaunch = (item: EnrichedItem) => {
    setLaunchItem(item);
    setLaunchPreset('full');
    setLaunchPhase('confirming');
    setLaunchError(null);
  };

  const handleConfirmLaunch = async () => {
    if (!launchItem) return;
    setLaunchPhase('launching');
    setLaunchError(null);
    try {
      const selectedStages = launchPreset === 'small'
        ? smallStages.map(s => s.key)
        : availableStages.map(s => s.key);
      const goal = launchItem.description
        ? `${launchItem.initiative}\n\n${launchItem.description}`
        : launchItem.initiative;

      setSelectedItem(launchItem);
      clearSession();
      resetWorkflow();

      const result = await api.startWorkflow(
        launchItem.id, goal, undefined,
        selectedStages, undefined,
        undefined,
        launchItem.productArea,
      );
      const status = await api.getWorkflowStatus(result.workflowId);
      applyWorkflowStatus(status);
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
    setLaunchItem(null);
    setLaunchPhase(null);
    setLaunchError(null);
  };

  const handleAssignToMe = async (item: EnrichedItem) => {
    if (!user) return;
    try {
      await api.assignInitiative(item.id, user.id);
      setLocalItems(localItems.map(i =>
        i.id === item.id && !i.assignedUsers?.some(u => u.id === user.id)
          ? { ...i, assignedUsers: [...(i.assignedUsers ?? []), { id: user.id, name: user.name }] }
          : i
      ));
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to assign');
    }
  };

  const handleUnassignFromMe = async (item: EnrichedItem) => {
    if (!user) return;
    try {
      await api.unassignInitiative(item.id, user.id);
      setLocalItems(localItems.map(i =>
        i.id === item.id ? { ...i, assignedUsers: (i.assignedUsers ?? []).filter(u => u.id !== user.id) } : i
      ));
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to unassign');
    }
  };

  const handleToggleUserAssignment = async (item: EnrichedItem, userId: number, assign: boolean) => {
    try {
      if (assign) {
        const { userName } = await api.assignInitiative(item.id, userId);
        setLocalItems(localItems.map(i =>
          i.id === item.id && !i.assignedUsers?.some(u => u.id === userId)
            ? { ...i, assignedUsers: [...(i.assignedUsers ?? []), { id: userId, name: userName }] }
            : i
        ));
      } else {
        await api.unassignInitiative(item.id, userId);
        setLocalItems(localItems.map(i =>
          i.id === item.id ? { ...i, assignedUsers: (i.assignedUsers ?? []).filter(u => u.id !== userId) } : i
        ));
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to update assignment');
    }
  };

  const canCreate = canLaunchWorkflow(user, noAuth);

  const visibleItems = useMemo(
    () => isDemoMode ? localItems : localItems.filter(item => !item.workflow?.isDemo),
    [localItems, isDemoMode]
  );

  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    // Filter items by product area first, so counts reflect current filter
    const filtered = visibleItems.filter(item => {
      if (productAreaFilter !== 'all' && item.productArea !== productAreaFilter) return false;
      return true;
    });

    const c: Record<StatusFilter, number> = { all: filtered.length, active: 0, review: 0, done: 0, stopped: 0, new: 0, mine: 0, archived: 0, paused: 0, assigned: 0 };
    filtered.forEach(item => {
      if (item.status === 'archived') {
        c.archived++;
      } else if (item.isPaused) {
        c.paused++;
      } else {
        const s = item.workflow ? effectiveStatus(item.workflow) : undefined;
        if (s === 'active') c.active++;
        else if (s === 'paused_at_checkpoint') c.review++;
        else if (s === 'cancelled') c.stopped++;
        else if (s === 'complete') c.done++;
        else c.new++;
        if (item.workflow && s !== 'cancelled' && mineWorkflowIds.has(item.workflow.id)) {
          c.mine++;
        }
        if (user && item.assignedUsers?.some(u => u.id === user.id)) {
          c.assigned++;
        }
      }
    });
    return c;
  }, [visibleItems, productAreaFilter, mineWorkflowIds]);

  const filteredLocalItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = visibleItems.filter(item => {
      const isArchived = item.status === 'archived';
      const s = item.workflow ? effectiveStatus(item.workflow) : undefined;

      // Archived filter: only show archived items
      if (statusFilter === 'archived' && !isArchived) return false;
      // All other filters: exclude archived items
      if (statusFilter !== 'archived' && isArchived) return false;

      // Paused filter: only show paused items; other filters exclude paused items
      if (statusFilter === 'paused' && !item.isPaused) return false;
      if (statusFilter !== 'paused' && statusFilter !== 'all' && item.isPaused) return false;

      if (statusFilter === 'assigned' && !item.assignedUsers?.some(u => u.id === (user?.id ?? -1))) return false;
      // Stopped initiatives never count as needing review/approval, even if a
      // checkpoint was left pending at the moment the workflow was cancelled.
      if (statusFilter === 'mine' && (!item.workflow || s === 'cancelled' || !mineWorkflowIds.has(item.workflow.id))) return false;
      if (statusFilter === 'active' && s !== 'active') return false;
      if (statusFilter === 'review' && s !== 'paused_at_checkpoint') return false;
      if (statusFilter === 'done' && s !== 'complete') return false;
      if (statusFilter === 'stopped' && s !== 'cancelled') return false;
      if (statusFilter === 'new' && item.workflow) return false;
      if (productAreaFilter !== 'all' && item.productArea !== productAreaFilter) return false;
      if (!q) return true;
      const qId = q.replace(/^#/, '');
      return item.initiative.toLowerCase().includes(q)
        || (item.description?.toLowerCase().includes(q) ?? false)
        || (qId.length > 0 && item.seqNum != null && String(item.seqNum).includes(qId));
    });

    // Done initiatives always sink to the bottom of the list, regardless of which status
    // filter is active — active/needs-review/not-started ones stay on top where they're
    // actionable. Stable sort (partition, not a full reorder) so relative order within
    // each group — e.g. whatever the backend's default ordering is — is preserved.
    return [...filtered].sort((a, b) => {
      const aDone = a.workflow ? effectiveStatus(a.workflow) === 'complete' : false;
      const bDone = b.workflow ? effectiveStatus(b.workflow) === 'complete' : false;
      return Number(aDone) - Number(bDone);
    });
  }, [visibleItems, statusFilter, searchQuery, mineWorkflowIds, productAreaFilter]);

  const openForm = () => {
    setShowForm(true);
    Promise.resolve().then(() => titleInputRef.current?.focus());
  };

  const hasResults = filteredLocalItems.length > 0;
  const hasActiveFilters = !!searchQuery || statusFilter !== 'all' || productAreaFilter !== 'all';
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setProductAreaFilter('all');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">

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
          showAssignedFilter={!noAuth && !!user}
          isAdmin={isAdmin}
          onCreateInitiative={canCreate ? openForm : undefined}
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
              productArea={formProductArea}
              strategicTheme={formTheme}
              onTitleChange={setFormTitle}
              onDescriptionChange={setFormDesc}
              onProductAreaChange={setFormProductArea}
              onStrategicThemeChange={setFormTheme}
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
              {canCreate && (
                <button
                  onClick={openForm}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  create first initiative →
                </button>
              )}
            </div>
          )}

          {/* Initiatives */}
          {(filteredLocalItems.length > 0 || (loading && localItems.length === 0)) && (
            <section>
              {loading && localItems.length === 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-32 rounded-lg bg-surface-200 dark:bg-surface-800 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredLocalItems.map(item => (
                    <InitiativeCard
                      key={item.id}
                      item={item}
                      isDeleting={deletingId === item.id}
                      isConfirmingDelete={confirmDeleteId === item.id}
                      isArchiving={archivingId === item.id}
                      isConfirmingArchive={confirmArchiveId === item.id}
                      isAnalysing={launchItem?.id === item.id && launchPhase === 'launching'}
                      onLaunch={() => handleInitiateLaunch(item)}
                      onResume={() => handleResumeWorkflow(item)}
                      onRequestDelete={() => setConfirmDeleteId(item.id)}
                      onConfirmDelete={() => handleDeleteInitiative(item)}
                      onCancelDelete={() => setConfirmDeleteId(null)}
                      onRequestArchive={() => setConfirmArchiveId(item.id)}
                      onConfirmArchive={() => handleArchiveInitiative(item)}
                      onCancelArchive={() => setConfirmArchiveId(null)}
                      onAssignToMe={() => handleAssignToMe(item)}
                      onUnassignFromMe={() => handleUnassignFromMe(item)}
                      onOpenAssignFlyout={() => setAssignFlyoutItemId(item.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </div>

      {/* Assign user flyout (admin) */}
      {assignFlyoutItemId && (() => {
        const flyoutItem = localItems.find(i => i.id === assignFlyoutItemId);
        return flyoutItem ? (
          <AssignUserFlyout
            item={flyoutItem}
            onClose={() => setAssignFlyoutItemId(null)}
            onToggle={(userId, assign) => handleToggleUserAssignment(flyoutItem, userId, assign)}
          />
        ) : null;
      })()}

      {/* Launch confirmation modal */}
      {launchItem && launchPhase && (
        <LaunchPipelineModal
          item={launchItem}
          phase={launchPhase}
          selectedPreset={launchPreset}
          fullStages={availableStages}
          smallStages={smallStages}
          onSelectPreset={setLaunchPreset}
          error={launchError}
          onConfirm={handleConfirmLaunch}
          onCancel={handleCancelLaunch}
        />
      )}
    </div>
  );
}

