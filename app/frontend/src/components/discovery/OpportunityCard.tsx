import { useState } from 'react';
import type { DiscoveryOpportunity } from '@pap/shared';

interface OpportunityCardProps {
  opportunity: DiscoveryOpportunity;
  canMutate: boolean;
  canPromote: boolean;
  onDismiss: (id: number) => void;
  onPromoteClick: (opportunity: DiscoveryOpportunity) => void;
}

function confidenceBadgeClass(confidence?: number): string {
  if (confidence === undefined) return 'bg-surface-100 text-surface-600 dark:bg-surface-700/50 dark:text-surface-400';
  if (confidence >= 0.7) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (confidence >= 0.4) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

const STATUS_BADGE: Record<string, string> = {
  promoted: 'bg-brand-100 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300',
  dismissed: 'bg-surface-100 text-surface-500 dark:bg-surface-700/50 dark:text-surface-400',
  reviewed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
};

export function OpportunityCard({ opportunity, canMutate, canPromote, onDismiss, onPromoteClick }: OpportunityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = opportunity.status === 'promoted' || opportunity.status === 'dismissed';

  return (
    <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{opportunity.title}</h4>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {opportunity.status !== 'new' && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[opportunity.status] ?? ''}`}>
                {opportunity.status}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${confidenceBadgeClass(opportunity.confidence)}`}>
              {opportunity.confidence !== undefined ? `${Math.round(opportunity.confidence * 100)}% confidence` : 'unscored'}
            </span>
          </div>
        </div>
        <p className="text-sm text-surface-600 dark:text-surface-300 mt-1.5 leading-relaxed">{opportunity.description}</p>

        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-brand-600 dark:text-brand-400 hover:underline mt-2"
        >
          {expanded ? 'Hide rationale & evidence' : 'Show rationale & evidence'}
        </button>

        {expanded && (
          <div className="mt-3 space-y-2.5">
            <p className="text-xs text-surface-500 dark:text-surface-400 italic leading-relaxed">{opportunity.rationale}</p>
            {opportunity.evidence.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">Evidence</p>
                {opportunity.evidence.map((e, i) => (
                  <div key={i} className="text-xs px-2.5 py-2 rounded-lg bg-surface-50 dark:bg-surface-900/40 border border-surface-200 dark:border-surface-700">
                    <p className="font-medium text-surface-700 dark:text-surface-300">
                      {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 hover:underline">{e.sourceTitle}</a> : e.sourceTitle}
                    </p>
                    {e.quote && <p className="text-surface-500 dark:text-surface-400 mt-0.5">"{e.quote}"</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!isResolved && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-900/30">
          {canMutate && (
            <button
              onClick={() => onDismiss(opportunity.id)}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700/70 transition-colors"
            >
              Dismiss
            </button>
          )}
          {canPromote ? (
            <button
              onClick={() => onPromoteClick(opportunity)}
              className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors"
            >
              Promote to pipeline →
            </button>
          ) : (
            <span title="Only Product or Admin users can promote an opportunity" className="cursor-not-allowed">
              <button disabled className="text-xs px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-400 dark:text-surface-600 font-medium pointer-events-none">
                Promote to pipeline →
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
