import { useEffect, useState, useMemo, useRef } from 'react';
import type { AirtableItem } from '@pap/shared';
import { api } from '../../services/api';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useToast } from '../../hooks/useToast';
import { InitiativeForm } from './InitiativeForm';
import { LocalInitiativeRow } from './LocalInitiativeRow';
import { RoadmapItemRow } from './RoadmapItemRow';

type WorkflowInfo = { id: string; status: string; currentStage: string | null; summary: string | null };
export type EnrichedItem = AirtableItem & { workflow?: WorkflowInfo };

// Module-level cache so items survive component unmount/remount
let _cachedItems: EnrichedItem[] = [];
let _cachedLocalItems: EnrichedItem[] = [];

export function AirtableItemList() {
  const [items, setItemsState] = useState<EnrichedItem[]>(_cachedItems);
  const [localItems, setLocalItemsState] = useState<EnrichedItem[]>(_cachedLocalItems);
  const [loading, setLoading] = useState(_cachedItems.length === 0);

  const setItems = (data: EnrichedItem[]) => { _cachedItems = data; setItemsState(data); };
  const setLocalItems = (data: EnrichedItem[]) => { _cachedLocalItems = data; setLocalItemsState(data); };

  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Local initiative state
  const [showInitiativeForm, setShowInitiativeForm] = useState(false);
  const [initiativeTitle, setInitiativeTitle] = useState('');
  const [initiativeDesc, setInitiativeDesc] = useState('');
  const [savingInitiative, setSavingInitiative] = useState(false);
  const [deletingInitiativeId, setDeletingInitiativeId] = useState<string | null>(null);
  const [confirmDeleteInitiativeId, setConfirmDeleteInitiativeId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const {
    selectedItem, setSelectedItem,
    clearSession,
  } = useSessionStore();

  const { applyWorkflowStatus, resetWorkflow } = useWorkflowStore();

  const { config } = useConfigStore();
  const showRoadmap = config?.integrations.roadmap !== 'none';
  const toast = useToast();

  useEffect(() => {
    if (showRoadmap) loadItems();
    loadLocalItems();
  }, [showRoadmap]);

  const loadItems = async () => {
    try {
      if (_cachedItems.length === 0) setLoading(true);
      setError(null);
      const data = await api.getItemsNeedingPRD();
      setItems(data);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to load items';
      if (_cachedItems.length === 0) setError(errorMsg);
      console.error('Error loading items:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLocalItems = async () => {
    try {
      if (!showRoadmap && _cachedLocalItems.length === 0) setLoading(true);
      const data = await api.getInitiatives();
      setLocalItems(data);
    } catch (err: any) {
      console.error('Error loading local initiatives:', err);
    } finally {
      if (!showRoadmap) setLoading(false);
    }
  };

  const handleCreateInitiative = async () => {
    if (!initiativeTitle.trim() || savingInitiative) return;
    try {
      setSavingInitiative(true);
      const created = await api.createInitiative(initiativeTitle.trim(), initiativeDesc.trim() || undefined);
      const data = await api.getInitiatives();
      setLocalItems(data);
      const newItem = data.find((i: EnrichedItem) => i.id === created.id);
      if (newItem) {
        setSelectedItem(newItem);
        resetWorkflow();
      }
      setInitiativeTitle('');
      setInitiativeDesc('');
      setShowInitiativeForm(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to create initiative');
    } finally {
      setSavingInitiative(false);
    }
  };

  const handleDeleteInitiative = async (item: AirtableItem) => {
    if (deletingInitiativeId) return;
    setConfirmDeleteInitiativeId(null);
    try {
      setDeletingInitiativeId(item.id);
      await api.deleteInitiative(item.id);
      const updated = localItems.filter(i => i.id !== item.id);
      setLocalItems(updated);
      if (selectedItem?.id === item.id) {
        setSelectedItem(null as any);
        clearSession();
        resetWorkflow();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to delete initiative');
    } finally {
      setDeletingInitiativeId(null);
    }
  };

  const handleSelectItem = async (item: EnrichedItem) => {
    setSelectedItem(item);
    clearSession();
    if (item.workflow) {
      // Restore the existing workflow
      try {
        const status = await api.getWorkflowStatus(item.workflow.id);
        applyWorkflowStatus(status);
      } catch {
        resetWorkflow();
      }
    } else {
      resetWorkflow();
    }
  };

  // Filter roadmap items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item =>
      item.initiative.toLowerCase().includes(query) ||
      (item.description && item.description.toLowerCase().includes(query))
    );
  }, [items, searchQuery]);

  // Status badge helper
  const statusBadge = (wf?: WorkflowInfo) => {
    if (!wf) return null;
    const label = wf.status === 'complete' ? 'done'
      : wf.status === 'paused_at_checkpoint' ? 'paused'
      : wf.status === 'active' ? 'active'
      : wf.status;
    const color = wf.status === 'complete'
      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
      : wf.status === 'paused_at_checkpoint'
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
      : wf.status === 'active'
      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-500';
    return (
      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
        {label}
      </span>
    );
  };

  // Render a local initiative row with workflow status
  const renderLocalRow = (item: EnrichedItem) => (
    <LocalInitiativeRow
      key={item.id}
      item={item}
      isSelected={selectedItem?.id === item.id}
      isDeleting={deletingInitiativeId === item.id}
      isConfirmingDelete={confirmDeleteInitiativeId === item.id}
      onSelect={() => handleSelectItem(item)}
      onRequestDelete={() => setConfirmDeleteInitiativeId(item.id)}
      onConfirmDelete={() => handleDeleteInitiative(item)}
      onCancelDelete={() => setConfirmDeleteInitiativeId(null)}
      statusBadge={statusBadge(item.workflow)}
    />
  );

  // Render a roadmap item row (no delete, with estimate/bv badges + workflow status)
  const renderRoadmapRow = (item: EnrichedItem) => (
    <RoadmapItemRow
      key={item.id}
      item={item}
      isSelected={selectedItem?.id === item.id}
      onSelect={() => handleSelectItem(item)}
      statusBadge={statusBadge(item.workflow)}
    />
  );

  const handleCancelInitiativeForm = () => {
    setShowInitiativeForm(false);
    setInitiativeTitle('');
    setInitiativeDesc('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2">
        {/* Local Initiatives Section */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {showRoadmap ? 'Local Initiatives' : 'Initiatives'}
            </span>
            <button
              onClick={() => { setShowInitiativeForm(true); setTimeout(() => titleInputRef.current?.focus(), 0); }}
              title="New initiative"
              className="flex items-center justify-center w-6 h-6 rounded text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {showInitiativeForm && (
            <InitiativeForm
              title={initiativeTitle}
              onTitleChange={setInitiativeTitle}
              description={initiativeDesc}
              onDescriptionChange={setInitiativeDesc}
              saving={savingInitiative}
              onSubmit={handleCreateInitiative}
              onCancel={handleCancelInitiativeForm}
              titleInputRef={titleInputRef}
            />
          )}

          {loading && localItems.length === 0 ? (
            <div className="animate-pulse space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg" />
              ))}
            </div>
          ) : localItems.length === 0 && !showInitiativeForm ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 pl-1 pb-1">
              No initiatives yet — click + to create one
            </p>
          ) : (
            <div className="space-y-1">
              {localItems.map(item => renderLocalRow(item))}
            </div>
          )}
        </div>

        {/* Roadmap section — only when Airtable is enabled */}
        {showRoadmap && (
          <>
            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-gray-700 mb-3" />

            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Roadmap Items
              </span>
              <button
                onClick={loadItems}
                className="text-blue-600 hover:text-blue-700"
                title="Refresh items"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Search */}
            {!loading && (
              <>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter items..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {!error && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {filteredItems.length === items.length
                      ? `${items.length} item${items.length !== 1 ? 's' : ''}`
                      : `${filteredItems.length} of ${items.length} items`}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Roadmap Item List (scrollable area — only when roadmap is on) */}
      {showRoadmap && (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <h3 className="text-red-800 dark:text-red-300 font-medium mb-2">Error Loading Items</h3>
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              <button onClick={loadItems} className="mt-3 px-4 py-2 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 text-red-800 dark:text-red-300 rounded-md text-sm font-medium">
                Retry
              </button>
            </div>
          ) : filteredItems.length === 0 && searchQuery ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p className="text-sm">No items match your search</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
              <p className="text-gray-600 dark:text-gray-400">No items needing PRDs found</p>
              <button onClick={loadItems} className="mt-3 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-800 dark:text-gray-200 rounded-md text-sm font-medium">
                Refresh
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map(item => renderRoadmapRow(item))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
