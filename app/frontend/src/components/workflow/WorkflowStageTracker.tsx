import { useEffect } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useModelStore } from '../../stores/modelStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { StageRow } from './StageRow';

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
              checkpoint={checkpoint}
              latestApproved={latestApproved}
              completedAt={completedAt}
              agentModel={agentModels[stageName]}
              onViewArtifact={setViewingArtifactId}
            />
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
