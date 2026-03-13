import { useEffect, useState, useMemo, useRef } from 'react';
import type { AirtableItem } from '@pap/shared';
import { api } from '../services/api';
import { useSessionStore } from '../stores/sessionStore';
import { useConfigStore } from '../stores/configStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useToast } from '../hooks/useToast';

type WorkflowInfo = { id: string; status: string; currentStage: string | null; summary: string | null };
type EnrichedItem = AirtableItem & { workflow?: WorkflowInfo };

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
  const renderLocalRow = (item: EnrichedItem) => {
    const isSelected = selectedItem?.id === item.id;
    const isDeleting = deletingInitiativeId === item.id;
    return (
      <div
        key={item.id}
        className={`rounded-lg border-2 transition-all ${
          isSelected
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm ring-1 ring-blue-200 dark:ring-blue-800'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
        }`}
      >
        <div className="flex items-start">
          <button
            className="flex-1 text-left p-3 min-w-0"
            onClick={() => handleSelectItem(item)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                {isSelected && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />}
                <h3 className={`font-medium text-sm truncate ${isSelected ? 'text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>
                  {item.workflow?.summary || item.initiative}
                </h3>
              </div>
              {statusBadge(item.workflow)}
            </div>
            {item.description && (
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
                {item.description}
              </p>
            )}
          </button>

          {/* Delete button */}
          {confirmDeleteInitiativeId === item.id ? (
            <div className="flex items-center gap-1 p-2 flex-shrink-0">
              <button
                onClick={() => handleDeleteInitiative(item)}
                className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 font-medium"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDeleteInitiativeId(null)}
                className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteInitiativeId(item.id); }}
              disabled={isDeleting}
              className="p-2 text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-500 transition-colors flex-shrink-0"
              title="Delete initiative"
            >
              {isDeleting ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  // Render a roadmap item row (no delete, with estimate/bv badges + workflow status)
  const renderRoadmapRow = (item: EnrichedItem) => {
    const isSelected = selectedItem?.id === item.id;
    return (
      <div
        key={item.id}
        className={`rounded-lg border-2 transition-all ${
          isSelected
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm ring-1 ring-blue-200 dark:ring-blue-800'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
        }`}
      >
        <button
          className="w-full text-left p-3 min-w-0"
          onClick={() => handleSelectItem(item)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              {isSelected && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />}
              <h3 className={`font-medium text-sm truncate ${isSelected ? 'text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>
                {item.initiative}
              </h3>
            </div>
            {statusBadge(item.workflow)}
          </div>
          {item.description && (
            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {item.estimate && (
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                item.estimate === 'XS' || item.estimate === 'S'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                  : item.estimate === 'M'
                  ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
              }`}>
                {item.estimate}
              </span>
            )}
            {item.businessValue !== undefined && (
              <span className="text-xs text-gray-500 dark:text-gray-400">{item.businessValue}/10</span>
            )}
          </div>
        </button>
      </div>
    );
  };

  // Inline form for creating a new initiative
  const renderInitiativeForm = () => (
    showInitiativeForm && (
      <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <input
          ref={titleInputRef}
          type="text"
          value={initiativeTitle}
          onChange={e => setInitiativeTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreateInitiative(); if (e.key === 'Escape') { setShowInitiativeForm(false); setInitiativeTitle(''); setInitiativeDesc(''); } }}
          placeholder="Initiative name"
          className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-2"
        />
        <textarea
          value={initiativeDesc}
          onChange={e => setInitiativeDesc(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none mb-2"
        />
        <div className="flex gap-2">
          <button
            onClick={handleCreateInitiative}
            disabled={!initiativeTitle.trim() || savingInitiative}
            className="flex-1 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            {savingInitiative ? 'Creating...' : 'Create'}
          </button>
          <button
            onClick={() => { setShowInitiativeForm(false); setInitiativeTitle(''); setInitiativeDesc(''); }}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  );

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

          {renderInitiativeForm()}

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
