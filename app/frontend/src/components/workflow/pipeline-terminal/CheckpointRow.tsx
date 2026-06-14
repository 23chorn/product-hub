import { useWorkflowStore } from '../../../stores/workflowStore';
import { InlineCheckpointActions } from '../../coordinator/InlineCheckpointActions';

export function isStaleRecoveryCheckpoint(coordinatorAction: string | null): boolean {
  try { return !!JSON.parse(coordinatorAction ?? '{}').stale_recovery; } catch { return false; }
}

/** Inline checkpoint review row shown when a stage is awaiting human approval. */
export function CheckpointRow({
  stageName,
  onResolved,
}: {
  stageName: string;
  onResolved: (result: any) => void;
}) {
  const { checkpoints, setViewingArtifactId } = useWorkflowStore();
  const checkpoint = checkpoints.find(c => c.stage === stageName && c.status === 'pending');
  if (!checkpoint) return null;

  // Stale-recovery checkpoints may have a critic artifact_id — don't use it for preview
  const safeArtifactId = isStaleRecoveryCheckpoint(checkpoint.coordinator_action)
    ? null
    : checkpoint.artifact_id;

  return (
    <div className="mx-2 mt-1 mb-2 rounded border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/10 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">⏸ awaiting approval</span>
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
