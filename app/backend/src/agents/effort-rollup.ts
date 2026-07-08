/**
 * effort-rollup — keeps a Feature's and Epic's Effort field in ADO in sync with the sum of
 * their children's estimates. Reads live from ADO (via AzureDevOpsClient.sumEffortFields)
 * rather than any locally cached estimate, so the rollup stays correct after a story or
 * feature is deleted (via the Manage tab or directly in ADO) as well as after new stories
 * are pushed. Single source of truth for all three call sites: the incremental per-feature
 * push, the final backlog-merge push, and the work-item delete route.
 */
import db from '../data/database';
import { getAzureDevOpsClient } from '../integrations/azure-devops';
import Logger from '../utils/logger';

const logger = new Logger('EFFORT-ROLLUP');

function childAdoIds(workflowId: string, adoType: 'story' | 'feature', parentLocalKey: string): number[] {
  return db.prepare<[string, string, string], { ado_id: number }>(
    `SELECT ado_id FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = ? AND parent_local_key = ?`
  ).all(workflowId, adoType, parentLocalKey).map(r => r.ado_id);
}

function findMapping(workflowId: string, adoType: 'feature' | 'epic', localKey: string): { ado_id: number; parent_local_key: string | null } | undefined {
  return db.prepare<[string, string, string], { ado_id: number; parent_local_key: string | null }>(
    `SELECT ado_id, parent_local_key FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = ? AND local_key = ?`
  ).get(workflowId, adoType, localKey);
}

/** Recompute a feature's Effort field from the sum of its current child stories' estimates. Returns the new total, or null if the feature isn't mapped. */
export async function recalculateFeatureEffort(workflowId: string, featureLocalKey: string): Promise<number | null> {
  const feature = findMapping(workflowId, 'feature', featureLocalKey);
  if (!feature) return null;

  const storyIds = childAdoIds(workflowId, 'story', featureLocalKey);
  const client = getAzureDevOpsClient();
  const total = await client.sumEffortFields(storyIds);
  await client.updateWorkItem(feature.ado_id, { effort: total });
  logger.info(`Feature ${featureLocalKey} (#${feature.ado_id}) effort recalculated: ${total} across ${storyIds.length} stor${storyIds.length === 1 ? 'y' : 'ies'}`);
  return total;
}

/** Recompute an epic's Effort field from the sum of its current child features' (already-rolled-up) effort. Returns the new total, or null if the epic isn't mapped. */
export async function recalculateEpicEffort(workflowId: string, epicLocalKey: string): Promise<number | null> {
  const epic = findMapping(workflowId, 'epic', epicLocalKey);
  if (!epic) return null;

  const featureIds = childAdoIds(workflowId, 'feature', epicLocalKey);
  const client = getAzureDevOpsClient();
  const total = await client.sumEffortFields(featureIds);
  await client.updateWorkItem(epic.ado_id, { effort: total });
  logger.info(`Epic ${epicLocalKey} (#${epic.ado_id}) effort recalculated: ${total} across ${featureIds.length} feature(s)`);
  return total;
}

/**
 * Recalculate a feature's effort and cascade up to its parent epic. Call this after anything
 * that changes a feature's story set (stories pushed, a story deleted) so both levels stay
 * accurate. Best-effort — logs and swallows failures rather than throwing, since this always
 * runs after the change it's reacting to has already succeeded and shouldn't roll it back.
 */
export async function recalculateEffortRollupChain(workflowId: string, featureLocalKey: string): Promise<void> {
  try {
    const feature = findMapping(workflowId, 'feature', featureLocalKey);
    await recalculateFeatureEffort(workflowId, featureLocalKey);
    if (feature?.parent_local_key) await recalculateEpicEffort(workflowId, feature.parent_local_key);
  } catch (err: any) {
    logger.warn(`Effort rollup failed for feature ${featureLocalKey} (non-fatal): ${err.message}`);
  }
}
