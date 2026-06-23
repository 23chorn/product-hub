import type { StageStatus } from '../stores/workflowStore';

/**
 * True for a per-feature multi-agent refinement checkpoint — the parallel
 * `story_decomposition_F<n>` wave stages and their synthetic `_qa` siblings.
 * These pause together as several concurrent checkpoints, so callers use this to
 * avoid treating them like a single sequential stage (e.g. auto-opening previews).
 */
export function isFeatureRefinementStage(stage: string): boolean {
  return /^story_decomposition_F\d+(_qa)?$/.test(stage);
}

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
