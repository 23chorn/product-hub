import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useModelStore } from '../../stores/modelStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { StageRow, StatusIcon, labelColor } from './StageRow';
import type { StageStatus } from '../../stores/workflowStore';

// Group feature-specific story decomposition stages under collapsible parent
// (QA and tech refinement are now embedded in the story_decomposition_F* multi-agent workflow)
function groupStages(stages: string[]): Array<{ parent: string | null; children: string[] }> {
  const storyFeatureStages: Array<{ stage: string; idx: number }> = [];
  const regularStages: Array<{ stage: string; idx: number }> = [];

  // First pass: categorize all stages
  stages.forEach((stage, idx) => {
    if (stage.match(/^story_decomposition_F\d+$/)) {
      storyFeatureStages.push({ stage, idx });
    } else {
      regularStages.push({ stage, idx });
    }
  });

  // Second pass: merge into groups array in order of first appearance
  const allGrouped = [
    ...(storyFeatureStages.length > 0 ? [{
      parent: 'story_decomposition' as const,
      children: storyFeatureStages.map(s => s.stage),
      firstIdx: storyFeatureStages[0].idx
    }] : []),
    ...regularStages.map(s => ({
      parent: null as const,
      children: [s.stage],
      firstIdx: s.idx
    }))
  ];

  // Sort by first appearance in original sequence
  allGrouped.sort((a, b) => a.firstIdx - b.firstIdx);

  return allGrouped.map(({ parent, children }) => ({ parent, children }));
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
  const { agentModels } = useModelStore();
  // Start with groups expanded (empty set = nothing collapsed)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
        {(() => {
          const groups = groupStages(stageSequence);
          console.log('[WorkflowStageTracker] Stage sequence:', stageSequence);
          console.log('[WorkflowStageTracker] Groups:', groups);
          return groups.map((group, groupIdx) => {
          if (group.parent === null) {
            // Standalone stage (not part of a feature group)
            const stageName = group.children[0];
            const idx = stageSequence.indexOf(stageName);
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
                isLast={groupIdx === groups.length - 1}
                compact
              />
            );
          }

          // Feature group (story_decomposition with multiple features)
          const isCollapsed = collapsedGroups.has(group.parent);
          const firstChildIdx = stageSequence.indexOf(group.children[0]);
          const groupStatus = group.children.some((s) => statuses[stageSequence.indexOf(s)] === 'in-progress')
            ? 'in-progress'
            : group.children.every((s) => statuses[stageSequence.indexOf(s)] === 'complete')
            ? 'complete'
            : 'pending';

          return (
            <div key={`group-${group.parent}`} className="mb-1">
              {/* Parent row */}
              <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-slate-800/40 rounded"
                onClick={() => {
                  const next = new Set(collapsedGroups);
                  if (isCollapsed) next.delete(group.parent!);
                  else next.add(group.parent!);
                  setCollapsedGroups(next);
                }}
              >
                <span className="text-slate-600 text-xs select-none">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <StatusIcon status={groupStatus} />
                <span className={`text-[11px] flex-1 ${labelColor(groupStatus)}`}>
                  {group.parent === 'story_decomposition' ? 'Story Decomposition — Shard' : 'QA Engineer — Vera'}
                </span>
              </div>

              {/* Child rows (features) */}
              {!isCollapsed && group.children.map((stageName, childIdx) => {
                const idx = stageSequence.indexOf(stageName);
                const status = statuses[idx];
                const featureNum = stageName.match(/F(\d+)$/)?.[1] ?? '?';
                const checkpoint = checkpoints.find(
                  (c) => c.stage === stageName && c.status === 'pending'
                );
                const latestApproved = checkpoints
                  .filter((c) => c.stage === stageName && c.status === 'approved')
                  .at(-1);
                const completedAt = latestApproved?.resolved_at ?? latestApproved?.created_at ?? null;

                return (
                  <div key={stageName} className="pl-6">
                    <StageRow
                      stageName={stageName}
                      index={idx}
                      status={status}
                      prevStatus={childIdx > 0 ? statuses[idx - 1] : (firstChildIdx > 0 ? statuses[firstChildIdx - 1] : undefined)}
                      checkpoint={checkpoint}
                      latestApproved={latestApproved}
                      completedAt={completedAt}
                      agentModel={agentModels[stageName]}
                      onViewArtifact={setViewingArtifactId}
                      isLast={childIdx === group.children.length - 1 && groupIdx === groups.length - 1}
                      compact
                      customLabel={`Feature ${featureNum}`}
                    />
                  </div>
                );
              })}
            </div>
          );
        });
        })()}
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
