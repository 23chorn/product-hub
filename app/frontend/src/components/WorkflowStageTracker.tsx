import { useEffect } from 'react';
import { useWorkflowStore, type StageStatus } from '../stores/workflowStore';
import { api } from '../services/api';

const STAGE_LABELS: Record<string, string> = {
  analyst:            'Analyst — Sage',
  pm_prd:             'Requirements — Rex',
  solution_architect: 'Architect — Atlas',
  pm_backlog:         'Backlog — Pip',
  critic:             'Critic — Flint',
  curator:            'Curator — Ivy',
};

function stageIcon(status: StageStatus) {
  switch (status) {
    case 'complete':       return <span className="text-green-500">✓</span>;
    case 'in-progress':    return <span className="text-blue-500 animate-pulse">●</span>;
    case 'at-checkpoint':  return <span className="text-amber-500 animate-pulse">⏸</span>;
    case 'rejected':       return <span className="text-red-500">✕</span>;
    case 'skipped':        return <span className="text-gray-400">—</span>;
    default:               return <span className="text-gray-300 dark:text-gray-600">○</span>;
  }
}

function stageDot(status: StageStatus) {
  const base = 'w-2 h-2 rounded-full flex-shrink-0';
  switch (status) {
    case 'complete':       return <span className={`${base} bg-green-500`} />;
    case 'in-progress':    return <span className={`${base} bg-blue-500 animate-pulse`} />;
    case 'at-checkpoint':  return <span className={`${base} bg-amber-500 animate-pulse`} />;
    case 'rejected':       return <span className={`${base} bg-red-500`} />;
    case 'skipped':        return <span className={`${base} bg-gray-300 dark:bg-gray-600`} />;
    default:               return <span className={`${base} bg-gray-200 dark:bg-gray-700`} />;
  }
}

function labelClass(status: StageStatus) {
  switch (status) {
    case 'complete':       return 'text-green-700 dark:text-green-400';
    case 'in-progress':    return 'text-blue-700 dark:text-blue-400 font-semibold';
    case 'at-checkpoint':  return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'rejected':       return 'text-red-600 dark:text-red-400 line-through';
    case 'skipped':        return 'text-gray-400 dark:text-gray-600 line-through';
    default:               return 'text-gray-400 dark:text-gray-600';
  }
}

function deriveStageStatus(
  stageName: string,
  currentStage: string | null,
  completedStages: string[],
  pendingStage: string | null,
  workflowStatus: string
): StageStatus {
  if (pendingStage === stageName) return 'at-checkpoint';
  if (currentStage === stageName && workflowStatus === 'active') return 'in-progress';
  if (completedStages.includes(stageName)) return 'complete';
  return 'pending';
}

export function WorkflowStageTracker() {
  const {
    activeWorkflow,
    stageSequence,
    currentStage,
    completedStages,
    pendingStage,
    checkpoints,
    applyWorkflowStatus,
    resetWorkflow,
    setViewingArtifactId,
  } = useWorkflowStore();

  // Poll for status updates while workflow is active
  useEffect(() => {
    if (!activeWorkflow || activeWorkflow.status === 'complete') return;

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.getWorkflowStatus(activeWorkflow.id);
        if (!cancelled) applyWorkflowStatus(status);
      } catch { /* ignore transient errors */ }
    };

    const t = setInterval(poll, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeWorkflow?.id, activeWorkflow?.status]);

  if (!activeWorkflow) return null;

  return (
    <div className="px-3 py-3">
      {/* Header with back button */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Workflow Stages
        </p>
        <button
          onClick={() => {
            localStorage.removeItem('coordinatorPlanningSessionId');
            resetWorkflow();
          }}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        >
          ← Initiatives
        </button>
      </div>

      <div className="space-y-1">
        {stageSequence.map((stageName, idx) => {
          const status = deriveStageStatus(
            stageName,
            currentStage,
            completedStages,
            pendingStage,
            activeWorkflow.status
          );

          const checkpoint = checkpoints.find(
            (c) => c.stage === stageName && c.status === 'pending'
          );

          // Most recent approved checkpoint for this stage — use created_at
          // (many auto-approved checkpoints don't have resolved_at)
          const latestApproved = checkpoints
            .filter((c) => c.stage === stageName && c.status === 'approved')
            .at(-1);
          const completedAt = latestApproved?.resolved_at ?? latestApproved?.created_at ?? null;

          return (
            <div key={stageName}>
              {/* Connector line (skip first) */}
              {idx > 0 && (
                <div className="ml-3 w-px h-2 bg-gray-200 dark:bg-gray-700" />
              )}

              <div
                className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${
                  status === 'at-checkpoint'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                    : status === 'in-progress'
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : ''
                }`}
              >
                <div className="mt-0.5">{stageDot(status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs ${labelClass(status)}`}>
                      {STAGE_LABELS[stageName] ?? stageName}
                    </span>
                    <span className="text-xs">{stageIcon(status)}</span>
                  </div>
                  {status === 'at-checkpoint' && checkpoint && (
                    <div className="mt-0.5">
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Awaiting review
                        {checkpoint.coordinator_action && (() => {
                          try {
                            const action = JSON.parse(checkpoint.coordinator_action);
                            if (action.critic_verdict) return ` — Flint: ${action.critic_verdict}`;
                          } catch { /* ignore */ }
                          return '';
                        })()}
                      </p>
                      {checkpoint.artifact_id && (
                        <button
                          onClick={() => setViewingArtifactId(checkpoint.artifact_id!)}
                          className="mt-1 text-xs px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                        >
                          Review output
                        </button>
                      )}
                    </div>
                  )}
                  {status === 'complete' && (
                    <div className="flex items-center gap-2 mt-0.5">
                      {completedAt && (
                        <span className="text-xs text-gray-400 dark:text-gray-600">
                          {new Date(completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {latestApproved?.artifact_id && (
                        <button
                          onClick={() => setViewingArtifactId(latestApproved.artifact_id!)}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                        >
                          View
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {activeWorkflow.status === 'complete' && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <span className="text-green-500 text-xs">✓</span>
            <span className="text-xs text-green-700 dark:text-green-400 font-medium">All stages complete</span>
          </div>
        </div>
      )}
    </div>
  );
}
