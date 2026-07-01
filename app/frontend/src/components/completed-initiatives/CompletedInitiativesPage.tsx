import { useEffect, useState } from 'react';
import type { CompletedInitiativeSummary } from '@pap/shared';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { relativeTime } from '../../utils/relative-time';
import { WORK_ITEM_STATE_BUCKETS, WORK_ITEM_STATE_BUCKET_LABELS, WORK_ITEM_STATE_BUCKET_COLORS } from '../../utils/work-item-state-bucket';
import { CompletedInitiativeDetail } from './CompletedInitiativeDetail';

type View = 'active' | 'archived';

/**
 * Top-level page (not an overlay) listing every completed, ADO-pushed initiative with
 * rollup counts and ADO state buckets. Replaces the old Stats dashboard's slot in App.tsx.
 * Opening an initiative replaces this grid in place with CompletedInitiativeDetail — a full
 * page, not a side-panel previewer — and "Back" returns here.
 *
 * Admins additionally get an "Archived" toggle to review and unarchive initiatives that
 * were manually archived off the default ("active") list below.
 */
export function CompletedInitiativesPage() {
  const { user, noAuth } = useAuthStore();
  const isAdmin = noAuth || !!user?.is_admin;

  const [view, setView] = useState<View>('active');
  const [items, setItems] = useState<CompletedInitiativeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

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
    <div className="flex flex-col h-full overflow-hidden bg-surface-50 dark:bg-surface-950">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isAdmin && (
          <div className="flex items-center gap-1 mb-4">
            {(['active', 'archived'] as View[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                  view === v
                    ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                    : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                }`}
              >
                {v === 'archived' ? 'Archived Initiatives' : 'Active'}
              </button>
            ))}
          </div>
        )}
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

                {item.percentComplete != null && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                      <div className="h-full bg-brand-500" style={{ width: `${item.percentComplete}%` }} />
                    </div>
                  </div>
                )}

                <p className={`text-[10px] mt-2 ${item.lastRefreshedAt == null ? 'text-amber-600 dark:text-amber-400' : 'text-surface-400 dark:text-surface-500'}`}>
                  {item.lastRefreshedAt == null
                    ? 'Needs refresh'
                    : `${item.percentComplete != null ? `${item.percentComplete}% complete · ` : ''}Refreshed ${relativeTime(item.lastRefreshedAt)}`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
