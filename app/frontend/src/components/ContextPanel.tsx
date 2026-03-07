import { useState } from 'react';
import { api } from '../services/api';
import { useContextKeeperStore } from '../stores/contextKeeperStore';
import { useModelStore } from '../stores/modelStore';
import { useSessionStore } from '../stores/sessionStore';
import { useToast } from '../hooks/useToast';
import type { ContextChangeProposal } from '@pap/shared';

export function ContextPanel() {
  const {
    pendingCount,
    lastChecked,
    changes,
    proposals,
    isChecking,
    isReviewing,
    setPendingCount,
    setLastChecked,
    setChanges,
    setProposals,
    setIsChecking,
    setIsReviewing,
    setSessionId,
    updateProposalStatus,
  } = useContextKeeperStore();

  const { selectedModelId } = useModelStore();
  const { setMode } = useSessionStore();
  const toast = useToast();

  // Local state for user-edited proposal text
  const [editedTexts, setEditedTexts] = useState<Record<number, string>>({});
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedTestData = async () => {
    setIsSeeding(true);
    try {
      const result = await api.seedContextTestData();
      toast.success(`Dev: seeded ${result.seeded} snapshots with old statuses — click "Check for Changes"`);
    } catch (err: any) {
      toast.error(err.message || 'Seed failed');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleCheck = async () => {
    setIsChecking(true);
    try {
      const result = await api.checkContextChanges();
      setChanges(result.changes);
      setPendingCount(result.pendingCount);
      setLastChecked(Date.now());
      if (result.changes.length === 0) {
        toast.success('No material status changes detected');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to check Airtable status');
    } finally {
      setIsChecking(false);
    }
  };

  const handleReview = async () => {
    setIsReviewing(true);
    try {
      const result = await api.runContextReview(selectedModelId || undefined);
      setSessionId(result.sessionId);
      setProposals(result.proposals);
      setChanges([]);
      if (result.proposals.length === 0) {
        toast.success('AI review complete — no context updates needed');
      }
    } catch (err: any) {
      toast.error(err.message || 'AI review failed');
    } finally {
      setIsReviewing(false);
    }
  };

  const handleConfirm = async (proposal: ContextChangeProposal) => {
    try {
      const customText = editedTexts[proposal.id];
      const result = await api.confirmContextProposal(proposal.id, customText);
      updateProposalStatus(proposal.id, 'confirmed');
      setPendingCount(result.pendingCount);
      toast.success(`Updated ${proposal.fileName}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to confirm proposal');
    }
  };

  const handleDismiss = async (proposal: ContextChangeProposal) => {
    try {
      const result = await api.dismissContextProposal(proposal.id);
      updateProposalStatus(proposal.id, 'dismissed');
      setPendingCount(result.pendingCount);
    } catch (err: any) {
      toast.error(err.message || 'Failed to dismiss proposal');
    }
  };

  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const isEmpty = changes.length === 0 && pendingProposals.length === 0 && !isChecking && !isReviewing;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
      {/* Header */}
      <div className="flex-none border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            🔄 Context Keeper
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheck}
              disabled={isChecking || isReviewing}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isChecking ? 'Checking…' : 'Check for Changes'}
            </button>
            <button
              onClick={() => setMode('prd')}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {lastChecked && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Last checked: {new Date(lastChecked).toLocaleString()}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Detected changes — pre-review */}
        {changes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
              {changes.length} material status change{changes.length !== 1 ? 's' : ''} detected
            </p>
            <div className="space-y-1.5 mb-3">
              {changes.map((c) => (
                <div
                  key={c.airtableId}
                  className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2"
                >
                  <span className="font-medium text-gray-800 dark:text-gray-200">{c.title}</span>
                  <span className="mx-1 text-gray-400">·</span>
                  <span className="text-red-600 dark:text-red-400">{c.oldStatus}</span>
                  <span className="mx-1 text-gray-400">→</span>
                  <span className="text-green-600 dark:text-green-400">{c.newStatus}</span>
                </div>
              ))}
            </div>
            <button
              onClick={handleReview}
              disabled={isReviewing}
              className="w-full text-sm px-3 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isReviewing ? 'Kira is reviewing…' : 'Run AI Context Review'}
            </button>
          </div>
        )}

        {/* Pending proposals */}
        {pendingProposals.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
              {pendingProposals.length} proposed update{pendingProposals.length !== 1 ? 's' : ''} — review and confirm
            </p>
            <div className="space-y-3">
              {pendingProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-700/40"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {proposal.fileName}
                    </span>
                    {proposal.sectionHint && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[120px]">
                        {proposal.sectionHint}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-2">
                    {proposal.rationale}
                  </p>
                  <textarea
                    className="w-full text-xs font-mono border border-gray-200 dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y min-h-[80px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={editedTexts[proposal.id] ?? proposal.proposedText}
                    onChange={(e) =>
                      setEditedTexts((prev) => ({ ...prev, [proposal.id]: e.target.value }))
                    }
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleConfirm(proposal)}
                      className="flex-1 text-xs px-2 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
                    >
                      Confirm &amp; Write
                    </button>
                    <button
                      onClick={() => handleDismiss(proposal)}
                      className="text-xs px-2 py-1.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              Context health looks good
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Click "Check for Changes" to scan Airtable for status transitions that may require context document updates.
            </p>
            {pendingCount === 0 && proposals.filter((p) => p.status === 'confirmed').length > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-3">
                ✓ All proposals reviewed
              </p>
            )}
            <div className="mt-8 pt-6 border-t border-dashed border-gray-200 dark:border-gray-700 w-full">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-300 dark:text-gray-600 mb-2">
                Dev Tools
              </p>
              <button
                onClick={handleSeedTestData}
                disabled={isSeeding}
                className="text-xs px-3 py-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 disabled:opacity-50 transition-colors"
              >
                {isSeeding ? 'Seeding…' : 'Seed test status changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
