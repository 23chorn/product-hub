import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useContextKeeperStore } from '../../stores/contextKeeperStore';
import { useAuthStore, isViewOnly } from '../../stores/authStore';
import { formatTimestamp } from '../../utils/relative-time';

/**
 * Manual trigger for Airtable status-change detection: checks Airtable initiative
 * statuses against the last-seen snapshot, then (on request) runs the Context Keeper
 * agent to propose context file edits for any material transition (e.g. → Shipped).
 */
export function AirtableSyncPanel() {
  const {
    lastChecked, changes, proposals,
    isChecking, isReviewing,
    setPendingCount, setLastChecked, setChanges, setProposals,
    setIsChecking, setIsReviewing, updateProposalStatus,
  } = useContextKeeperStore();

  const { user, noAuth } = useAuthStore();
  const readOnly = isViewOnly(user, noAuth);

  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getContextKeeperStatus()
      .then((status) => {
        setPendingCount(status.pendingCount);
        setLastChecked(status.lastChecked);
        setChanges(status.changes);
        setProposals(status.proposals);
      })
      .catch(() => { /* Airtable may not be configured — leave defaults */ })
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingProposals = proposals.filter((p) => p.status === 'pending');

  const handleCheck = async () => {
    setError(null);
    setIsChecking(true);
    try {
      const result = await api.checkAirtableStatusChanges();
      setChanges(result.changes);
      setPendingCount(result.pendingCount);
      setLastChecked(Date.now());
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to check Airtable for changes.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleReview = async () => {
    setError(null);
    setIsReviewing(true);
    try {
      const result = await api.runContextKeeperReview();
      // Server only clears its cachedChanges when proposals were actually produced —
      // mirror that here so a zero-proposal review leaves "Generate Proposals" available.
      if (result.proposals.length > 0) {
        setProposals([...proposals, ...result.proposals]);
        setChanges([]);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Context review failed.');
    } finally {
      setIsReviewing(false);
    }
  };

  const handleProposalAction = async (id: number, action: 'confirm' | 'dismiss') => {
    try {
      const result = await api.updateContextKeeperProposal(id, action);
      updateProposalStatus(id, action === 'confirm' ? 'confirmed' : 'dismissed');
      setPendingCount(result.pendingCount);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? `Failed to ${action} proposal.`);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Airtable Sync</h3>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
          Detects initiative status changes in Airtable (e.g. moved to Shipped) and proposes context file
          updates so stale "Active work" entries don't linger. Last checked: {loaded ? formatTimestamp(lastChecked) : '…'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {error && (
          <div className="text-xs px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40">
            {error}
          </div>
        )}

        {readOnly && (
          <div className="text-xs px-3 py-2 rounded-md bg-surface-100 dark:bg-surface-800/60 text-surface-500 dark:text-surface-400 border border-surface-200 dark:border-surface-700">
            View-only accounts can see sync status but cannot trigger a check, review, or apply proposals.
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleCheck}
            disabled={isChecking || readOnly}
            className="text-xs px-4 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >
            {isChecking ? 'Checking…' : 'Check Airtable for Changes'}
          </button>
          {changes.length > 0 && (
            <button
              onClick={handleReview}
              disabled={isReviewing || readOnly}
              className="text-xs px-4 py-1.5 rounded-md bg-surface-700 text-white hover:bg-surface-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              {isReviewing ? 'Reviewing…' : `Generate Proposals (${changes.length})`}
            </button>
          )}
        </div>

        {changes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">
              Detected status changes
            </h4>
            <div className="space-y-1.5">
              {changes.map((c) => (
                <div
                  key={c.airtableId}
                  className="text-sm px-3 py-2 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40"
                >
                  <span className="font-medium text-surface-800 dark:text-surface-200">{c.title}</span>
                  <span className="text-surface-400 mx-1.5">·</span>
                  <span className="text-surface-500 dark:text-surface-400">{c.oldStatus}</span>
                  <span className="text-surface-400 mx-1">→</span>
                  <span className={c.newStatus === 'Shipped' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-surface-600 dark:text-surface-300'}>
                    {c.newStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">
            Pending proposals {pendingProposals.length > 0 && `(${pendingProposals.length})`}
          </h4>
          {pendingProposals.length === 0 ? (
            <p className="text-xs text-surface-400 dark:text-surface-500">
              No pending proposals. Run a check, then generate proposals if any changes are found.
            </p>
          ) : (
            <div className="space-y-3">
              {pendingProposals.map((p) => (
                <div
                  key={p.id}
                  className="rounded-md border border-surface-200 dark:border-surface-700 overflow-hidden"
                >
                  <div className="px-3 py-2 bg-surface-50 dark:bg-surface-800/40 flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="text-sm font-mono text-surface-800 dark:text-surface-200">{p.fileName}</span>
                      {p.sectionHint && (
                        <span className="text-xs text-surface-400 ml-2">{p.sectionHint}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleProposalAction(p.id, 'dismiss')}
                        disabled={readOnly}
                        className="text-xs px-3 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleProposalAction(p.id, 'confirm')}
                        disabled={readOnly}
                        className="text-xs px-3 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  <pre className="text-xs px-3 py-2 whitespace-pre-wrap font-mono text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900/30">
                    {p.proposedText}
                  </pre>
                  <div className="text-xs px-3 py-1.5 text-surface-500 dark:text-surface-400 border-t border-surface-100 dark:border-surface-700/50">
                    {p.rationale}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
