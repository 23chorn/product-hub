import { useEffect } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useModelStore } from '../../stores/modelStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { StageRow } from './StageRow';
import type { StageStatus } from '../../stores/workflowStore';

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
  const { agentModels } = useModelStore();

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

  const total = stageSequence.length;
  const doneCount = completedStages.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const isComplete = activeWorkflow.status === 'complete';

  const statuses: StageStatus[] = stageSequence.map((stageName) =>
    deriveStageStatus(stageName, currentStage, completedStages, pendingStage, activeWorkflow.status)
  );

  const showCost = (activeWorkflow.estimated_cost ?? 0) > 0.0001;
  const costStr = activeWorkflow.estimated_cost !== undefined
    ? activeWorkflow.estimated_cost < 0.01
      ? `$${activeWorkflow.estimated_cost.toFixed(4)}`
      : `$${activeWorkflow.estimated_cost.toFixed(2)}`
    : '';

  return (
    <div className="flex flex-col h-full bg-[#0d1117] font-mono">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[#161b22] border-b border-slate-700/60 flex-shrink-0">
        <span className="text-[10px] text-slate-500">pipeline</span>
        <button
          onClick={() => {
            localStorage.removeItem('coordinatorPlanningSessionId');
            resetWorkflow();
          }}
          className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          title="Back to initiatives"
        >
          ← back
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-3 py-2 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-slate-500">
            {isComplete ? 'complete' : doneCount > 0 ? `${doneCount}/${total} stages` : 'initialising…'}
          </span>
          <div className="flex items-center gap-2">
            {showCost && (
              <span className="text-[10px] font-mono text-slate-600">{costStr}</span>
            )}
            <span className="text-[10px] font-mono text-slate-500">{pct}%</span>
          </div>
        </div>
        <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              isComplete ? 'bg-green-500' : 'bg-teal-500'
            }`}
            style={{ width: `${isComplete ? 100 : pct}%` }}
          />
        </div>
      </div>

      {/* Stage list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {stageSequence.map((stageName, idx) => {
          const status = statuses[idx];
          const checkpoint = checkpoints.find(
            (c) => c.stage === stageName && c.status === 'pending'
          );
          const latestApproved = checkpoints
            .filter((c) => c.stage === stageName && c.status === 'approved')
            .at(-1);
          const completedAt = latestApproved?.resolved_at ?? latestApproved?.created_at ?? null;

          return (
            <StageRow
              key={stageName}
              stageName={stageName}
              index={idx}
              status={status}
              prevStatus={idx > 0 ? statuses[idx - 1] : undefined}
              checkpoint={checkpoint}
              latestApproved={latestApproved}
              completedAt={completedAt}
              agentModel={agentModels[stageName]}
              onViewArtifact={setViewingArtifactId}
              isLast={idx === stageSequence.length - 1}
              compact
            />
          );
        })}
      </div>

      {/* All done footer */}
      {isComplete && (
        <div className="px-3 py-2 border-t border-slate-800/60 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            all stages complete
          </div>
        </div>
      )}
    </div>
  );
}
