import { useWorkflowStore } from '../../../stores/workflowStore';
import { InlineCheckpointActions } from '../../coordinator/InlineCheckpointActions';
import { parseRequiredRoles, ROLE_LABELS } from '../../../stores/authStore';
import { STAGE_SHORT_LABELS } from '../../../constants/stage-labels';

export function isStaleRecoveryCheckpoint(coordinatorAction: string | null): boolean {
  try { return !!JSON.parse(coordinatorAction ?? '{}').stale_recovery; } catch { return false; }
}

/**
 * Inline checkpoint review row shown when a stage is awaiting human approval.
 * Renders only the checkpoint for the exact `stageName` passed in — the QA sub-stage
 * (story_decomposition_F<n>_qa) gets its own independent card under its own event-log
 * section, instead of being folded into its parent refinement stage's card.
 */
export function CheckpointRow({
  stageName,
  onResolved,
}: {
  stageName: string;
  onResolved: (result: any) => void;
}) {
  const { checkpoints, setViewingArtifactId } = useWorkflowStore();

  // checkpoints is ordered oldest-first — take the most recent match so a stale
  // revised/dismissed checkpoint never shadows the current pending one.
  const checkpoint = [...checkpoints].reverse().find(c => c.stage === stageName);
  if (!checkpoint || checkpoint.status !== 'pending') return null;

  const safeArtifactId = isStaleRecoveryCheckpoint(checkpoint.coordinator_action)
    ? null
    : checkpoint.artifact_id;

  const isQaCheckpoint = checkpoint.stage.endsWith('_qa');
  const checkpointLabel = isQaCheckpoint
    ? 'QA Test Suite Review'
    : `${STAGE_SHORT_LABELS[checkpoint.stage] ?? checkpoint.stage} Review`;
  const requiredRoles = parseRequiredRoles(checkpoint.required_role);
  const roleBadge = requiredRoles.length > 0
    ? requiredRoles.map(r => ROLE_LABELS[r] ?? r).join(' / ')
    : null;

  return (
    <div className="mx-2 mt-1 mb-2 rounded border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/10 p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">⏸ awaiting approval</span>
        {roleBadge && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400">
            {roleBadge}
          </span>
        )}
        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
          {checkpointLabel}
        </span>
        {safeArtifactId && (
          <button
            onClick={() => setViewingArtifactId(safeArtifactId)}
            className="text-[10px] text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200 font-mono border border-sky-200 hover:border-sky-400 dark:border-sky-700/40 dark:hover:border-sky-500 px-1.5 py-0.5 rounded transition-colors"
          >
            review output →
          </button>
        )}
      </div>
      <InlineCheckpointActions
        checkpoint={checkpoint}
        onResolved={onResolved}
      />
    </div>
  );
}
