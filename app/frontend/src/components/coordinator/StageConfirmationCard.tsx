interface StageOption {
  key: string;
  label: string;
  short: string;
}

interface StageConfirmationCardProps {
  availableStages: StageOption[];
  enabledStages: Record<string, boolean>;
  onToggleStage: (key: string) => void;
  stageRationale: string | null;
  onLaunch: () => void;
}

/**
 * Card shown after the coordinator signals it's ready: lets the user toggle the
 * recommended pipeline stages and launch the workflow. At least one stage must
 * stay enabled.
 */
export function StageConfirmationCard({
  availableStages,
  enabledStages,
  onToggleStage,
  stageRationale,
  onLaunch,
}: StageConfirmationCardProps) {
  const enabledCount = Object.values(enabledStages).filter(Boolean).length;

  return (
    <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 uppercase tracking-wide mb-1">Suggested pipeline</p>
        {stageRationale && (
          <p className="text-xs text-slate-600 dark:text-slate-400">{stageRationale}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {availableStages.map(stage => {
          const enabled = enabledStages[stage.key];
          const isLastEnabled = enabled && enabledCount === 1;
          return (
            <button
              key={stage.key}
              type="button"
              disabled={isLastEnabled}
              onClick={() => onToggleStage(stage.key)}
              title={isLastEnabled ? 'At least one stage required' : `${enabled ? 'Remove' : 'Add'} ${stage.label}`}
              className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                enabled
                  ? 'bg-teal-100 dark:bg-teal-900/50 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-200 font-medium'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-600 line-through'
              } ${isLastEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}
            >
              {stage.short}
            </button>
          );
        })}
      </div>
      <button
        onClick={onLaunch}
        className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
      >
        Launch workflow →
      </button>
    </div>
  );
}
