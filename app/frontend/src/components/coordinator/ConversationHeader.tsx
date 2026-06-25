export interface ConversationHeaderProps {
  isComplete: boolean;
  isLaunching: boolean;
  isGathering: boolean;
  isAtCheckpoint: boolean;
  hasWorkflow: boolean;
  currentStage: string | null | undefined;
  displayGoal: string | null | undefined;
  itemId: string | undefined;
  totalStages: number;
  completedCount: number;
  onCancel: () => void;
  stageSequence?: string[];
  completedStages?: string[];
  pendingStage?: string | null;
  workflowStatus?: string;
  animFrame?: number;
  criticActiveStage?: string | null;
  revisingStage?: string | null;
  lastActivityMs?: number;
}

export function ConversationHeader(props: ConversationHeaderProps) {
  const {
    isComplete, isLaunching, isGathering, isAtCheckpoint,
    hasWorkflow, displayGoal,
    onCancel,
  } = props;

  const statusLabel = isComplete ? 'Complete'
    : isLaunching ? 'Launching…'
    : isGathering ? 'Planning'
    : isAtCheckpoint ? 'Review needed'
    : hasWorkflow ? 'Running'
    : '';

  const statusColor = isComplete
    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
    : isAtCheckpoint
    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
    : isGathering || isLaunching
    ? 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
    : hasWorkflow
    ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-400'
    : '';

  // When a workflow is active the terminal header owns the back button and title
  if (hasWorkflow) return null;

  return (
    <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0 bg-white/80 dark:bg-surface-900/80">
      {/* Title row */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0 flex-1">
          {displayGoal ? (
            <p className="text-sm font-bold text-surface-900 dark:text-surface-100 leading-snug truncate">
              {displayGoal}
            </p>
          ) : (
            <p className="text-sm font-bold text-surface-900 dark:text-surface-100">
              {isGathering ? 'Chief of Staff' : 'xCube Flow'}
            </p>
          )}
        </div>

        {isGathering && !isLaunching && (
          <button
            onClick={onCancel}
            className="text-xs text-surface-400 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
          >
            Cancel
          </button>
        )}
      </div>

      {statusLabel && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
      )}
    </div>
  );
}
