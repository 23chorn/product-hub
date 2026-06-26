import type { EnrichedItem, LaunchPhase, StageOption, WorkflowPreset } from './types';
import { WORKFLOW_PRESETS } from '../../constants/stage-labels';

interface LaunchPipelineModalProps {
  item: EnrichedItem;
  phase: LaunchPhase;
  selectedPreset: WorkflowPreset;
  fullStages: StageOption[];
  onSelectPreset: (preset: WorkflowPreset) => void;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function StagePills({ stages }: { stages: StageOption[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {stages.map(s => (
        <span
          key={s.key}
          className="px-2 py-0.5 text-[10px] rounded-md bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-surface-600"
        >
          {s.short}
        </span>
      ))}
    </div>
  );
}

/** Modal that lets the user choose Full or Small pipeline and launches the workflow. */
export function LaunchPipelineModal({
  item,
  phase,
  selectedPreset,
  fullStages,
  onSelectPreset,
  error,
  onConfirm,
  onCancel,
}: LaunchPipelineModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 px-4">
      <div className="w-full max-w-xl bg-white dark:bg-surface-800 rounded-2xl shadow-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100 dark:border-surface-700">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1">
            {phase === 'launching' ? 'Launching' : 'Configure Pipeline'}
          </p>
          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {item.initiative}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {/* Full Pipeline */}
            <button
              type="button"
              disabled={phase === 'launching'}
              onClick={() => onSelectPreset('full')}
              className={`text-left p-3 rounded-xl border transition-colors ${
                selectedPreset === 'full'
                  ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-750 hover:border-surface-300 dark:hover:border-surface-500'
              } ${phase === 'launching' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  selectedPreset === 'full'
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-surface-300 dark:border-surface-500'
                }`} />
                <span className="text-xs font-semibold text-surface-800 dark:text-surface-100">Full Pipeline</span>
              </div>
              <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-snug mb-1">
                Research through to backlog — all specialist stages.
              </p>
              <StagePills stages={fullStages} />
            </button>

            {/* Small Workflow */}
            <button
              type="button"
              disabled={phase === 'launching'}
              onClick={() => onSelectPreset('small')}
              className={`text-left p-3 rounded-xl border transition-colors ${
                selectedPreset === 'small'
                  ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-750 hover:border-surface-300 dark:hover:border-surface-500'
              } ${phase === 'launching' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  selectedPreset === 'small'
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-surface-300 dark:border-surface-500'
                }`} />
                <span className="text-xs font-semibold text-surface-800 dark:text-surface-100">Small Workflow</span>
              </div>
              <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-snug mb-1">
                PRD → architecture → features → tickets. Skips research.
              </p>
              <StagePills stages={WORKFLOW_PRESETS.small} />
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onConfirm}
              disabled={phase === 'launching'}
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
        </div>
      </div>
    </div>
  );
}
