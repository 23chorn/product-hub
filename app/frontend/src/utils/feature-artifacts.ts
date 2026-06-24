import type { WorkflowCheckpoint } from '../stores/workflowStore';

export interface FeatureArtifactRef {
  num: number;
  ticketArtifactId?: number;
  qaArtifactId?: number;
}

const FEATURE_STAGE_RE = /^story_decomposition_F(\d+)$/;
const FEATURE_QA_STAGE_RE = /^story_decomposition_F(\d+)_qa$/;

/**
 * Per-feature ticket + QA artifact ids for every approved feature refinement, derived from
 * checkpoints alone. Shared by the pipeline terminal's "Stories/Tests" button and the artifact
 * viewer's read of the final backlog_merge artifact, so both build the same feature set.
 * checkpoints is oldest-first, so a later approval naturally overwrites an earlier one.
 */
export function deriveFeatureButtons(checkpoints: WorkflowCheckpoint[]): FeatureArtifactRef[] {
  const map = new Map<number, FeatureArtifactRef>();
  checkpoints.forEach(c => {
    if (c.status !== 'approved' || !c.artifact_id) return;
    const storyMatch = FEATURE_STAGE_RE.exec(c.stage);
    if (storyMatch) {
      const num = parseInt(storyMatch[1], 10);
      map.set(num, { ...(map.get(num) ?? { num }), ticketArtifactId: c.artifact_id });
      return;
    }
    const qaMatch = FEATURE_QA_STAGE_RE.exec(c.stage);
    if (qaMatch) {
      const num = parseInt(qaMatch[1], 10);
      map.set(num, { ...(map.get(num) ?? { num }), qaArtifactId: c.artifact_id });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.num - b.num);
}

/**
 * Latest approved epic_feature_planner artifact id, if any — checkpoint-derived so it's
 * available anywhere checkpoints are (e.g. the artifact viewer) without a separate
 * workflow-artifacts fetch.
 */
export function deriveEpicFeaturesArtifactId(checkpoints: WorkflowCheckpoint[]): number | null {
  const approved = checkpoints.filter(c => c.stage === 'epic_feature_planner' && c.status === 'approved' && c.artifact_id);
  if (approved.length === 0) return null;
  return approved.reduce((latest, c) => (c.created_at > latest.created_at ? c : latest), approved[0]).artifact_id!;
}
