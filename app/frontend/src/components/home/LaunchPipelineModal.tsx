import type { EnrichedItem, LaunchPhase, StageOption } from './types';

interface LaunchPipelineModalProps {
  item: EnrichedItem;
  phase: LaunchPhase;
  stageRationale: string | null;
  availableStages: StageOption[];
  enabledStages: Record<string, boolean>;
  enabledCount: number;
  error: string | null;
  onToggleStage: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal that analyses an initiative brief, lets the user toggle pipeline stages, and launches the workflow. */
export function LaunchPipelineModal({
  item,
  phase,
  stageRationale,
  availableStages,
  enabledStages,
  enabledCount,
  error,
  onToggleStage,
  onConfirm,
  onCancel,
}: LaunchPipelineModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 px-4">
      <div className="w-full max-w-md bg-white dark:bg-surface-800 rounded-2xl shadow-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100 dark:border-surface-700">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1">
            {phase === 'analyzing' ? 'Analysing Brief' : phase === 'launching' ? 'Launching' : 'Configure Pipeline'}
          </p>
          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {item.initiative}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {phase === 'analyzing' && (
            <div className="flex items-center gap-3 py-3">
              <svg className="w-4 h-4 text-brand-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <p className="text-sm text-surface-600 dark:text-surface-400">
                Analysing brief and selecting stages…
              </p>
            </div>
          )}

          {(phase === 'confirming' || phase === 'launching') && (
            <>
              {stageRationale && (
                <p className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
                  {stageRationale}
                </p>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">
                  Stages
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availableStages.map(stage => {
                    const enabled = enabledStages[stage.key];
                    const isLastEnabled = enabled && enabledCount === 1;
                    return (
                      <button
                        key={stage.key}
                        type="button"
                        disabled={isLastEnabled || phase === 'launching'}
                        onClick={() => onToggleStage(stage.key)}
                        title={isLastEnabled ? 'At least one stage required' : `${enabled ? 'Remove' : 'Add'} ${stage.label}`}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                          enabled
                            ? 'bg-brand-50 dark:bg-brand-900/40 border-brand-300 dark:border-brand-600 text-brand-800 dark:text-brand-200 font-medium'
                            : 'bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-surface-400 dark:text-surface-500 line-through'
                        } ${isLastEnabled || phase === 'launching' ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}
                      >
                        {stage.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onConfirm}
                  disabled={phase === 'launching' || enabledCount === 0}
                  className="flex-1 py-2.5 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                >
                  {phase === 'launching' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Launching…
                    </span>
                  ) : 'Launch pipeline →'}
                </button>
                <button
                  onClick={onCancel}
                  disabled={phase === 'launching'}
                  className="px-4 py-2.5 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
