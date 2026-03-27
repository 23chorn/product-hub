import { STAGE_LABELS } from '../../constants/stage-labels';

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
  onCancel: () => void;
}

export function ConversationHeader(props: ConversationHeaderProps) {
  const {
    isComplete, isLaunching, isGathering, isAtCheckpoint,
    hasWorkflow, currentStage, displayGoal, itemId, estimatedCost, onCancel,
  } = props;

  return (
    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-start justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {isComplete ? 'Workflow Complete'
            : isLaunching ? 'Launching workflow...'
            : isGathering ? 'Chief of Staff'
            : isAtCheckpoint ? `Checkpoint: ${STAGE_LABELS[currentStage ?? ''] ?? currentStage}`
            : hasWorkflow ? `Running: ${STAGE_LABELS[currentStage ?? ''] ?? currentStage ?? 'starting...'}`
            : 'Chief of Staff'}
          {itemId && (
            <span className="ml-2 text-xs font-mono text-slate-400 dark:text-slate-500">
              …{itemId.slice(-8)}
            </span>
          )}
          {estimatedCost !== undefined && estimatedCost > 0 && (
            <span className="ml-2 text-xs font-mono text-amber-600 dark:text-amber-400" title="Estimated workflow cost">
              ${estimatedCost < 0.01
                ? estimatedCost.toFixed(4)
                : estimatedCost.toFixed(2)}
            </span>
          )}
        </h2>
        {displayGoal && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-sm">
            {displayGoal}
          </p>
        )}
      </div>
      {!hasWorkflow && isGathering && !isLaunching && (
        <button
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
