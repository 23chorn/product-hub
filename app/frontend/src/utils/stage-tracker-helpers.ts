import type { StageStatus } from '../stores/workflowStore';

export function deriveStageStatus(
  stageName: string,
  currentStage: string | null,
  completedStages: string[],
  pendingStage: string | null,
  workflowStatus: string,
  inProgressStages: string[] = [],
  pendingStages: string[] = []
): StageStatus {
  if (pendingStages.includes(stageName) || pendingStage === stageName) return 'at-checkpoint';
  if ((inProgressStages.includes(stageName) || currentStage === stageName) && workflowStatus === 'active') return 'in-progress';
  if (completedStages.includes(stageName)) return 'complete';
  return 'pending';
}
