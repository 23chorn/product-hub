import { useEffect, useState } from 'react';
import type { CompletedInitiativeSummary } from '@pap/shared';
import { api } from '../../services/api';
import { WORK_ITEM_STATE_BUCKETS, WORK_ITEM_STATE_BUCKET_LABELS, WORK_ITEM_STATE_BUCKET_COLORS } from '../../utils/work-item-state-bucket';
import { CompletedInitiativeDetail } from './CompletedInitiativeDetail';

/** "3h ago" / "2d ago" — coarse, since the dashboard only needs a sense of staleness. */
function relativeTime(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Top-level page (not an overlay) listing every completed, ADO-pushed initiative with
 * rollup counts and ADO state buckets. Replaces the old Stats dashboard's slot in App.tsx.
 */
export function CompletedInitiativesPage() {
  const [items, setItems] = useState<CompletedInitiativeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    api.getCompletedInitiatives().then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-50 dark:bg-surface-950">
      <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-800 flex-shrink-0">
        <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Completed Initiatives</h2>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
          Azure DevOps ticket state for initiatives whose pipeline has finished.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-surface-400 italic">No completed, ADO-pushed initiatives yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(item => (
              <button
                key={item.itemId}
                onClick={() => setSelectedItemId(item.itemId)}
                className="text-left rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 p-4 hover:border-brand-400 dark:hover:border-brand-500 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-1.5 min-w-0">
                    {item.seqNum != null && (
                      <span
                        title={`Initiative #${item.seqNum}`}
                        className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400"
                      >
                        #{item.seqNum}
                      </span>
                    )}
                    <h3 className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{item.title}</h3>
                  </div>
                  {item.epicAdoUrl && (
                    <a
                      href={item.epicAdoUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex-shrink-0 text-[10px] text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      Epic ↗
                    </a>
                  )}
                </div>

                <div className="flex gap-1.5 flex-wrap mt-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
                    {item.featureCount} feature{item.featureCount !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
                    {item.storyCount} stor{item.storyCount !== 1 ? 'ies' : 'y'}
                  </span>
                  {item.testCaseCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
                      {item.testCaseCount} test{item.testCaseCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="flex gap-1.5 flex-wrap mt-2">
                  {WORK_ITEM_STATE_BUCKETS.filter(b => item.stateBuckets[b] > 0).map(bucket => (
                    <span key={bucket} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${WORK_ITEM_STATE_BUCKET_COLORS[bucket]}`}>
                      {item.stateBuckets[bucket]} {WORK_ITEM_STATE_BUCKET_LABELS[bucket]}
                    </span>
                  ))}
                </div>

                <p className={`text-[10px] mt-2 ${item.lastRefreshedAt == null ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500'}`}>
                  {item.lastRefreshedAt == null ? 'Needs refresh' : `Refreshed ${relativeTime(item.lastRefreshedAt)}`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedItemId && (
        <CompletedInitiativeDetail itemId={selectedItemId} onClose={() => setSelectedItemId(null)} />
      )}
    </div>
  );
}
