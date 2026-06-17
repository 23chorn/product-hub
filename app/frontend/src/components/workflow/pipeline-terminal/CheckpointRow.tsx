import { useWorkflowStore } from '../../../stores/workflowStore';
import { InlineCheckpointActions } from '../../coordinator/InlineCheckpointActions';
import { parseRequiredRoles, ROLE_LABELS } from '../../../stores/authStore';

export function isStaleRecoveryCheckpoint(coordinatorAction: string | null): boolean {
  try { return !!JSON.parse(coordinatorAction ?? '{}').stale_recovery; } catch { return false; }
}

/** Get base stage name by stripping _qa suffix */
function getBaseStage(stage: string): string {
  return stage.replace(/_qa$/, '');
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

  // Find all checkpoints in this group (base stage + base_stage_qa)
  const baseStage = getBaseStage(stageName);
  const qaStage = `${baseStage}_qa`;

  // checkpoints is ordered oldest-first — take the most recent match per stage so a
  // stale revised/dismissed checkpoint never shadows the current pending one.
  const storyCheckpoint = [...checkpoints].reverse().find(c => c.stage === baseStage);
  const qaCheckpoint = [...checkpoints].reverse().find(c => c.stage === qaStage);

  // If no checkpoints exist for this stage, don't render
  if (!storyCheckpoint && !qaCheckpoint) return null;

  // Check if this is a dual-checkpoint stage (both stories and QA)
  const isDualCheckpoint = storyCheckpoint && qaCheckpoint;

  // Single checkpoint rendering (legacy or non-dual stages)
  if (!isDualCheckpoint) {
    const checkpoint = storyCheckpoint || qaCheckpoint;
    if (!checkpoint || checkpoint.status !== 'pending') return null;

    const safeArtifactId = isStaleRecoveryCheckpoint(checkpoint.coordinator_action)
      ? null
      : checkpoint.artifact_id;

    const isQaCheckpoint = checkpoint.stage.endsWith('_qa');
    const checkpointLabel = isQaCheckpoint ? 'QA Test Suite Review' : 'Stories Review';
    const requiredRoles = parseRequiredRoles(checkpoint.required_role);
    const roleBadge = requiredRoles.length > 0
      ? requiredRoles.map(r => ROLE_LABELS[r] ?? r).join(' / ')
      : null;

    return (
      <div className="mx-2 mt-1 mb-2 rounded border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/10 p-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">⏸ awaiting approval</span>
          {roleBadge && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
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

  // Dual checkpoint rendering — show both as a grouped unit
  const storyPending = storyCheckpoint.status === 'pending';
  const qaPending = qaCheckpoint.status === 'pending';
  const storyApproved = storyCheckpoint.status === 'approved';
  const qaApproved = qaCheckpoint.status === 'approved';

  const allApproved = storyApproved && qaApproved;
  const anyPending = storyPending || qaPending;

  return (
    <div className="mx-2 mt-1 mb-2 rounded border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/10 p-3 space-y-3">
      {/* Group header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">
          {allApproved ? '✓ both approved' : anyPending ? '⏸ awaiting dual approval' : '⏸ awaiting approval'}
        </span>
        <span className="text-[9px] text-sky-500 dark:text-sky-500 font-medium">
          {allApproved ? 'Ready to advance' : 'Both must be approved to continue'}
        </span>
      </div>

      {/* Story checkpoint */}
      <div className={`border-l-2 pl-3 ${storyApproved ? 'border-green-400' : storyPending ? 'border-amber-400' : 'border-slate-300'}`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            storyApproved
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
          }`}>
            {parseRequiredRoles(storyCheckpoint.required_role).map(r => ROLE_LABELS[r] ?? r).join(' / ')}
          </span>
          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">
            Stories Review
          </span>
          {storyApproved && <span className="text-[9px] text-green-600 dark:text-green-400">✓ approved</span>}
          {storyCheckpoint.artifact_id && !isStaleRecoveryCheckpoint(storyCheckpoint.coordinator_action) && (
            <button
              onClick={() => setViewingArtifactId(storyCheckpoint.artifact_id!)}
              className="text-[10px] text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200 font-mono border border-sky-200 hover:border-sky-400 dark:border-sky-700/40 dark:hover:border-sky-500 px-1.5 py-0.5 rounded transition-colors"
            >
              review →
            </button>
          )}
        </div>
        {storyPending && (
          <InlineCheckpointActions
            checkpoint={storyCheckpoint}
            onResolved={onResolved}
          />
        )}
      </div>

      {/* QA checkpoint */}
      <div className={`border-l-2 pl-3 ${qaApproved ? 'border-green-400' : qaPending ? 'border-amber-400' : 'border-slate-300'}`}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
            qaApproved
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
          }`}>
            {parseRequiredRoles(qaCheckpoint.required_role).map(r => ROLE_LABELS[r] ?? r).join(' / ')}
          </span>
          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">
            QA Tests Review
          </span>
          {qaApproved && <span className="text-[9px] text-green-600 dark:text-green-400">✓ approved</span>}
          {qaCheckpoint.artifact_id && !isStaleRecoveryCheckpoint(qaCheckpoint.coordinator_action) && (
            <button
              onClick={() => setViewingArtifactId(qaCheckpoint.artifact_id!)}
              className="text-[10px] text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200 font-mono border border-sky-200 hover:border-sky-400 dark:border-sky-700/40 dark:hover:border-sky-500 px-1.5 py-0.5 rounded transition-colors"
            >
              review →
            </button>
          )}
        </div>
        {qaPending && (
          <InlineCheckpointActions
            checkpoint={qaCheckpoint}
            onResolved={onResolved}
          />
        )}
      </div>
    </div>
  );
}
