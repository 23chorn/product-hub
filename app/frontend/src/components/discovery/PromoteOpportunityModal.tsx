import { useState } from 'react';
import type { DiscoveryOpportunity } from '@pap/shared';
import { api } from '../../services/api';

interface PromoteOpportunityModalProps {
  opportunity: DiscoveryOpportunity;
  onClose: () => void;
  onPromoted: (opportunityId: number, itemId: string) => void;
}

export function PromoteOpportunityModal({ opportunity, onClose, onPromoted }: PromoteOpportunityModalProps) {
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setPromoting(true);
    setError(null);
    try {
      const result = await api.promoteOpportunity(opportunity.id);
      onPromoted(opportunity.id, result.itemId);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to promote opportunity');
      setPromoting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-surface-50 dark:bg-surface-800 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Promote to pipeline</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            This creates a new Airtable record and adds it to your initiative list, ready to launch through the standard pipeline.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-lg bg-surface-50 dark:bg-surface-900/40 border border-surface-200 dark:border-surface-700 px-3 py-2.5">
            <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{opportunity.title}</p>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{opportunity.description}</p>
          </div>

          {error && (
            <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-900/30">
          <button
            onClick={onClose}
            disabled={promoting}
            className="text-sm px-3.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700/70 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={promoting}
            className="text-sm px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {promoting ? 'Promoting...' : 'Promote'}
          </button>
        </div>
      </div>
    </div>
  );
}
