import { useEffect, useState, useCallback } from 'react';
import type { DiscoverySource, DiscoveryOpportunity } from '@pap/shared';
import { api } from '../../services/api';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useAuthStore, canLaunchWorkflow, isViewOnly } from '../../stores/authStore';
import { SourceDocumentsPanel } from './SourceDocumentsPanel';
import { OpportunityFeed } from './OpportunityFeed';
import { PromoteOpportunityModal } from './PromoteOpportunityModal';

export function DiscoveryScreen() {
  const { closeDiscovery } = useDiscoveryStore();
  const { user, noAuth } = useAuthStore();
  const canRun = canLaunchWorkflow(user, noAuth);
  const canMutate = !isViewOnly(user, noAuth);

  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [opportunities, setOpportunities] = useState<DiscoveryOpportunity[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingOpportunities, setLoadingOpportunities] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [promotingOpportunity, setPromotingOpportunity] = useState<DiscoveryOpportunity | null>(null);
  const [promotedToast, setPromotedToast] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const data = await api.getDiscoverySources();
      setSources(data);
    } catch { /* silent */ } finally {
      setLoadingSources(false);
    }
  }, []);

  const loadOpportunities = useCallback(async () => {
    try {
      const data = await api.getDiscoveryOpportunities();
      setOpportunities(data);
    } catch { /* silent */ } finally {
      setLoadingOpportunities(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
    loadOpportunities();
  }, [loadSources, loadOpportunities]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRunDiscovery = async () => {
    if (selectedIds.size === 0 || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const { opportunities: newOpportunities } = await api.runDiscovery(Array.from(selectedIds));
      setOpportunities(prev => [...newOpportunities, ...prev]);
    } catch (err: any) {
      setRunError(err.response?.data?.error || err.message || 'Discovery run failed');
    } finally {
      setRunning(false);
    }
  };

  const handleDismiss = async (id: number) => {
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, status: 'dismissed' } : o));
    try {
      await api.dismissOpportunity(id);
    } catch {
      loadOpportunities(); // re-sync on failure
    }
  };

  const handlePromoted = (opportunityId: number, itemId: string) => {
    setOpportunities(prev => prev.map(o => o.id === opportunityId ? { ...o, status: 'promoted', promotedItemId: itemId } : o));
    setPromotingOpportunity(null);
    setPromotedToast('Promoted — find it on Home to launch the pipeline.');
    window.dispatchEvent(new CustomEvent('refresh-initiatives'));
    setTimeout(() => setPromotedToast(null), 4000);
  };

  return (
    <div className="h-full bg-white dark:bg-surface-800 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Discovery</h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            Surface opportunities from interviews, reviews, and competitor notes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRun ? (
            <button
              onClick={handleRunDiscovery}
              disabled={selectedIds.size === 0 || running}
              className="text-sm px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running discovery...
                </span>
              ) : `Run Discovery${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </button>
          ) : (
            <span title="Only Product or Admin users can run discovery" className="cursor-not-allowed">
              <button disabled className="text-sm px-4 py-2 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-400 dark:text-surface-600 font-medium pointer-events-none">
                Run Discovery
              </button>
            </span>
          )}
          <button
            onClick={closeDiscovery}
            className="p-2 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {runError && (
        <div className="mx-6 mt-3 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex-shrink-0">
          {runError}
        </div>
      )}

      {promotedToast && (
        <div className="mx-6 mt-3 p-2.5 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg text-xs text-brand-700 dark:text-brand-300 flex-shrink-0">
          {promotedToast}
        </div>
      )}

      {/* Body — two columns */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="w-[360px] flex-shrink-0 border-r border-surface-200 dark:border-surface-700 overflow-hidden">
          <SourceDocumentsPanel
            sources={sources}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSourceAdded={(s) => setSources(prev => [s, ...prev])}
            onSourceDeleted={(id) => {
              setSources(prev => prev.filter(s => s.id !== id));
              setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
            }}
            canMutate={canMutate}
            loading={loadingSources}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <OpportunityFeed
            opportunities={opportunities}
            loading={loadingOpportunities}
            canMutate={canMutate}
            canPromote={canRun}
            onDismiss={handleDismiss}
            onPromoteClick={setPromotingOpportunity}
          />
        </div>
      </div>

      {promotingOpportunity && (
        <PromoteOpportunityModal
          opportunity={promotingOpportunity}
          onClose={() => setPromotingOpportunity(null)}
          onPromoted={handlePromoted}
        />
      )}
    </div>
  );
}
