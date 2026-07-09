import { useEffect, useState } from 'react';
import type { CompletedInitiativeSummary } from '@pap/shared';
import { api } from '../../services/api';
import { relativeTime } from '../../utils/relative-time';
import { WORK_ITEM_STATE_BUCKETS, WORK_ITEM_STATE_BUCKET_LABELS, WORK_ITEM_STATE_BUCKET_COLORS } from '../../utils/work-item-state-bucket';
import { CompletedInitiativeDetail } from './CompletedInitiativeDetail';
import { PageHeaderTitle } from '../common/PageHeaderTitle';

type View = 'active' | 'archived';

interface Props {
  /** Set when a shared link (?completedItemId=...) opened this page directly on one initiative. */
  initialSelection?: { itemId: string; archived: boolean } | null;
  /** Called once the initial selection has been applied, so the parent can clear it —
   *  otherwise navigating back here after "Back" would reopen the same shared item. */
  onInitialSelectionConsumed?: () => void;
}

/**
 * Top-level page (not an overlay) listing every completed, ADO-pushed initiative with
 * rollup counts and ADO state buckets. Replaces the old Stats dashboard's slot in App.tsx.
 * Opening an initiative replaces this grid in place with CompletedInitiativeDetail — a full
 * page, not a side-panel previewer — and "Back" returns here.
 *
 * Always shows the active list — viewing/unarchiving archived initiatives happens from the
 * Initiatives view's own "Archived" filter, not a separate toggle here. A shared link
 * (initialSelection.archived) can still open one specific archived initiative directly.
 */
export function CompletedInitiativesPage({ initialSelection, onInitialSelectionConsumed }: Props) {
  const view: View = initialSelection?.archived ? 'archived' : 'active';
  const [items, setItems] = useState<CompletedInitiativeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialSelection?.itemId ?? null);

  useEffect(() => {
    if (initialSelection) onInitialSelectionConsumed?.();
    // Only consume once on mount — the initiative itself is opened via selectedItemId's initializer above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadItems = (v: View) => {
    setLoading(true);
    const request = v === 'archived' ? api.getArchivedInitiatives() : api.getCompletedInitiatives();
    request.then(setItems).finally(() => setLoading(false));
  };

  useEffect(() => { loadItems(view); }, [view]);

  if (selectedItemId) {
    return (
      <CompletedInitiativeDetail
        itemId={selectedItemId}
        archived={view === 'archived'}
        onBack={(didRefresh) => { setSelectedItemId(null); if (didRefresh) loadItems(view); }}
        onArchiveChange={() => { setSelectedItemId(null); loadItems(view); }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeaderTitle>
        <p className="text-xs text-surface-500 dark:text-surface-400 truncate">Track ADO progress across completed initiatives</p>
      </PageHeaderTitle>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-surface-400 italic">
            {view === 'archived' ? 'No archived initiatives.' : 'No completed, ADO-pushed initiatives yet.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(item => (
              <button
                key={item.itemId}
                onClick={() => setSelectedItemId(item.itemId)}
                className="text-left rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 overflow-hidden hover:border-brand-400 dark:hover:border-brand-500 transition-colors flex flex-col"
              >
                {/* Title-bar strip: seq number + refresh status, matching the Initiatives card chrome */}
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 flex-shrink-0">
                  <span
                    title={item.seqNum != null ? `Initiative #${item.seqNum}` : undefined}
                    className="font-mono text-[10px] font-semibold text-surface-500 dark:text-surface-400"
                  >
                    {item.seqNum != null ? `#${item.seqNum}` : ''}
                  </span>
                  <span className={`text-[10px] font-mono ${item.lastRefreshedAt == null ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500'}`}>
                    {item.lastRefreshedAt == null
                      ? 'needs refresh'
                      : `${item.percentComplete != null ? `${item.percentComplete}% · ` : ''}refreshed ${relativeTime(item.lastRefreshedAt)}`}
                  </span>
                </div>

                <div className="p-4 pt-3 flex-1 flex flex-col">

                <h3 className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{item.title}</h3>

                <div className="flex gap-1.5 flex-wrap mt-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
                    {item.epicCount} phase{item.epicCount !== 1 ? 's' : ''}
                  </span>
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

                {item.percentComplete != null && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                      <div className="h-full bg-brand-500" style={{ width: `${item.percentComplete}%` }} />
                    </div>
                  </div>
                )}

                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
