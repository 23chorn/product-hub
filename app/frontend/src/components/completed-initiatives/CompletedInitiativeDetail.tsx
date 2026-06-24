import { useEffect, useState } from 'react';
import type { CompletedInitiativeDetail as CompletedInitiativeDetailData, WorkItemStateBucket } from '@pap/shared';
import { api } from '../../services/api';
import { tryParseBacklog, type BacklogData } from '../../utils/backlog-helpers';
import { mergeBacklogs } from '../artifact/BacklogOverviewModal';
import { BacklogView } from '../artifact/BacklogView';

interface Props {
  itemId: string;
  onClose: () => void;
}

/**
 * Drill-down slide-over for a single completed initiative: the merged backlog (read from
 * the same artifacts the push used) annotated with cached ADO state per story/feature, plus
 * test plan links. Loads once from the cached GET; only "Refresh" ever calls ADO, and it
 * swaps in just the new state map — never re-fetches artifact content.
 */
export function CompletedInitiativeDetail({ itemId, onClose }: Props) {
  const [detail, setDetail] = useState<CompletedInitiativeDetailData | null>(null);
  const [backlog, setBacklog] = useState<BacklogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);

    api.getCompletedInitiative(itemId).then(async (data) => {
      if (stale) return;
      setDetail(data);

      const artifactIds = [...new Set(data.workItems.map(w => w.artifactId).filter((id): id is number => id != null))];
      const parsed = await Promise.all(
        artifactIds.map((id, num) =>
          api.getArtifactContent(id)
            .then(({ content }) => ({ num, data: tryParseBacklog(content) }))
            .catch(() => null)
        )
      );
      if (stale) return;
      const valid = parsed.filter((p): p is { num: number; data: BacklogData } => !!p?.data);
      setBacklog(mergeBacklogs(valid));
    }).finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [itemId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await api.refreshCompletedInitiative(itemId);
      setDetail(updated);
    } finally {
      setRefreshing(false);
    }
  };

  const stateByLocalKey = new Map<string, WorkItemStateBucket>(
    (detail?.workItems ?? [])
      .filter(w => w.stateBucket != null)
      .map(w => [w.localKey, w.stateBucket as WorkItemStateBucket])
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-2xl h-full bg-white dark:bg-surface-800 shadow-xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0 gap-3">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{detail?.title ?? 'Loading...'}</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="px-2.5 py-1 text-xs font-medium rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700/70 transition-colors disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button onClick={onClose} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
          ) : (
            <>
              {detail?.epicAdoUrl && (
                <a href={detail.epicAdoUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline">
                  View Epic in Azure DevOps ↗
                </a>
              )}

              {backlog && (backlog.features?.length ?? 0) > 0 ? (
                <BacklogView data={backlog} stateByLocalKey={stateByLocalKey} />
              ) : (
                <p className="text-sm text-surface-400 italic">No backlog content found for this initiative.</p>
              )}

              {detail && detail.testPlans.length > 0 && (
                <div className="border-t border-surface-200 dark:border-surface-700 pt-3 space-y-1">
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Test Plan</p>
                  {detail.testPlans.map(plan => (
                    <a
                      key={plan.planId}
                      href={plan.planUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-xs text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      Plan #{plan.planId}{plan.testCaseCount != null ? ` · ${plan.testCaseCount} test cases` : ''} ↗
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
