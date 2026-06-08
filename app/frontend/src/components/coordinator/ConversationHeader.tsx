export interface ConversationHeaderProps {
  isComplete: boolean;
  isLaunching: boolean;
  isGathering: boolean;
  isAtCheckpoint: boolean;
  hasWorkflow: boolean;
  currentStage: string | null | undefined;
  displayGoal: string | null | undefined;
  itemId: string | undefined;
  estimatedCost: number | undefined;
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
    hasWorkflow, displayGoal, estimatedCost,
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
    ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
    : hasWorkflow
    ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400'
    : '';

  const showCost = estimatedCost !== undefined && estimatedCost > 0.0001;
  const costStr = estimatedCost !== undefined
    ? estimatedCost < 0.01
      ? `$${estimatedCost.toFixed(4)}`
      : `$${estimatedCost.toFixed(2)}`
    : '';

  // When a workflow is active the terminal header owns the back button and title
  if (hasWorkflow) return null;

  return (
    <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 bg-white/80 dark:bg-slate-900/80">
      {/* Title row */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0 flex-1">
          {displayGoal ? (
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug truncate">
              {displayGoal}
            </p>
          ) : (
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {isGathering ? 'Chief of Staff' : 'Product Hub'}
            </p>
          )}
        </div>

        {isGathering && !isLaunching && (
          <button
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
          >
            Cancel
          </button>
        )}
      </div>

      {(statusLabel || showCost) && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {statusLabel && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}>
              {statusLabel}
            </span>
          )}
          {showCost && (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500" title="Estimated workflow cost">
              {costStr}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
