import { effectiveStatus, type EnrichedItem } from './types';
import { StatusBadge } from './StatusBadge';

/** Card for one initiative in the HomeScreen grid: title, status, tags, and launch/resume/delete actions. */
export function InitiativeCard({
  item, isDeleting, isConfirmingDelete, isAnalysing,
  onLaunch, onResume, onRequestDelete, onConfirmDelete, onCancelDelete,
}: {
  item: EnrichedItem;
  isDeleting: boolean;
  isConfirmingDelete: boolean;
  isAnalysing: boolean;
  onLaunch: () => void;
  onResume: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const wf = item.workflow;
  const eff = wf ? effectiveStatus(wf) : undefined;
  const isActive = eff === 'active' || eff === 'paused_at_checkpoint';
  const isComplete = eff === 'complete';
  const isCancelled = eff === 'cancelled';
  const isDemo = !!wf?.isDemo;

  return (
    <div
      title={item.description || undefined}
      className="relative group rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all"
    >
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug break-words min-w-0">
              {wf?.summary || item.initiative}
            </h3>
            {wf?.isDemo && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700">
                Demo
              </span>
            )}
            <StatusBadge wf={wf} />
          </div>
          {wf?.currentStage && (wf.status === 'active' || wf.status === 'paused_at_checkpoint') ? (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              {wf.status === 'paused_at_checkpoint' ? 'Waiting for review' : `Running ${wf.currentStage.replace(/_/g, ' ')}`}
            </p>
          ) : item.description ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{item.description}</p>
          ) : null}
          {(item.productArea || item.strategicTheme) && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.productArea && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400">
                  {item.productArea}
                </span>
              )}
              {item.strategicTheme && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  {item.strategicTheme}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          {/* Action button */}
          {!isConfirmingDelete && (
            isActive ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium transition-colors">
                Continue →
              </button>
            ) : isCancelled ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors">
                Restart →
              </button>
            ) : isComplete ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-teal-300 hover:text-teal-600 dark:hover:text-teal-400 font-medium transition-colors">
                View →
              </button>
            ) : (
              <button onClick={onLaunch} disabled={isAnalysing}
                className="text-xs px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-medium transition-colors flex items-center gap-1.5">
                {isAnalysing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Analysing…
                  </>
                ) : 'Launch →'}
              </button>
            )
          )}

          {/* Delete controls (local items only) */}
          {item.source !== 'airtable' && !isDemo && (
            isConfirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <button onClick={onConfirmDelete} disabled={isDeleting}
                  className="text-[10px] px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 font-medium">
                  Delete
                </button>
                <button onClick={onCancelDelete}
                  className="text-[10px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onRequestDelete(); }} disabled={isDeleting}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-500 transition-all">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
