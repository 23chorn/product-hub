import { useState, useEffect } from 'react';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { InlineCheckpointActions } from '../../coordinator/InlineCheckpointActions';
import { parseRequiredRoles, ROLE_LABELS } from '../../../stores/authStore';
import { api } from '../../../services/api';
import { BacklogOverlapPanel } from './BacklogOverlapPanel';
import { RoleBadge } from '../../common/RoleBadge';

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
  const { checkpoints, activeWorkflow, setViewingArtifactId } = useWorkflowStore();
  const [overlapCount, setOverlapCount] = useState(0);
  const [showOverlapPanel, setShowOverlapPanel] = useState(false);

  // checkpoints is ordered oldest-first — take the most recent match so a stale
  // revised/dismissed checkpoint never shadows the current pending one.
  const checkpoint = [...checkpoints].reverse().find(c => c.stage === stageName);
  const workflowId = activeWorkflow?.id;

  // backlog_merge is the only stage with deterministic cross-feature overlap flags —
  // see detectBacklogOverlaps() in agents/backlog-overlap.ts. Informational only, never
  // blocks approval, so this just surfaces a count + review button alongside it.
  useEffect(() => {
    if (stageName !== 'backlog_merge' || !workflowId || checkpoint?.status !== 'pending') {
      setOverlapCount(0);
      return;
    }
    api.getBacklogOverlaps(workflowId)
      .then(({ flags }) => setOverlapCount(flags.filter(f => f.status === 'pending').length))
      .catch(() => setOverlapCount(0));
  }, [stageName, workflowId, checkpoint?.status]);

  if (!checkpoint || checkpoint.status !== 'pending') return null;

  const safeArtifactId = isStaleRecoveryCheckpoint(checkpoint.coordinator_action)
    ? null
    : checkpoint.artifact_id;

  const requiredRoles = parseRequiredRoles(checkpoint.required_role);
  // Matches the Home card's fallback: no roles assigned to the stage means anyone can
  // approve, but the box should still say so instead of silently dropping the badge.
  const roleBadge = requiredRoles.length > 0
    ? requiredRoles.map(r => ROLE_LABELS[r] ?? r).join(' / ')
    : 'Any role';

  return (
    <div className="mx-2 mt-1 mb-2 rounded border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/10 p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">⏸ awaiting approval</span>
        {roleBadge && <RoleBadge variant="required">{roleBadge}</RoleBadge>}
        {safeArtifactId && (
          <button
            onClick={() => setViewingArtifactId(safeArtifactId)}
            className="text-[10px] text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200 font-mono border border-sky-200 hover:border-sky-400 dark:border-sky-700/40 dark:hover:border-sky-500 px-1.5 py-0.5 rounded transition-colors"
          >
            review output →
          </button>
        )}
        {overlapCount > 0 && (
          <button
            onClick={() => setShowOverlapPanel(true)}
            className="text-[10px] text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 font-mono border border-amber-300 hover:border-amber-500 dark:border-amber-700/40 dark:hover:border-amber-500 px-1.5 py-0.5 rounded transition-colors"
          >
            ⚠ {overlapCount} possible overlap{overlapCount !== 1 ? 's' : ''} — review →
          </button>
        )}
      </div>
      <InlineCheckpointActions
        checkpoint={checkpoint}
        onResolved={onResolved}
      />
      {showOverlapPanel && workflowId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
          <BacklogOverlapPanel
            workflowId={workflowId}
            onClose={() => {
              setShowOverlapPanel(false);
              api.getBacklogOverlaps(workflowId)
                .then(({ flags }) => setOverlapCount(flags.filter(f => f.status === 'pending').length))
                .catch(() => {});
            }}
          />
        </div>
      )}
    </div>
  );
}
