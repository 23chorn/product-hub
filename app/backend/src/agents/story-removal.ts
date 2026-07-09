/**
 * story-removal — shared "delete one story everywhere" logic: the merged backlog artifact,
 * ADO (work item + linked test cases), and the local ado_work_item_map/effort rollup. Used by
 * both the Completed Initiatives Manage tab's work-item delete route and the backlog-overlap
 * "pick which side to keep" resolution — a single source of truth so both cascade the same way.
 */
import db from '../data/database';
import { getAzureDevOpsClient } from '../integrations/azure-devops';
import { parseStoryRefs } from '../integrations/azure-devops-format';
import { loadArtifactContentById, updateArtifactContent } from './artifact-helpers';
import { recalculateEffortRollupChain, recalculateEpicEffort } from './effort-rollup';
import { getDocumentArtifactIds } from '../data/work-item-queries';
import { stripJsonFence } from '../utils/json-repair';
import { featureLocalKey } from '@pap/shared';
import Logger from '../utils/logger';

const logger = new Logger('STORY-REMOVAL');

/**
 * Delete every ADO test case whose story_ref mentions one of the given (already-removed)
 * story local keys: removes the ADO test case work items, updates the local qa_test_plan_map
 * bookkeeping, AND prunes the matching entries from the qa_tests artifact's own `test_cases`
 * array — without that last step, computeLiveTestCaseCount (which reads the artifact, not
 * qa_test_plan_map) keeps reporting the pre-delete count. Best-effort — a failure deleting one
 * test case doesn't stop the rest; only confirmed deletions are cleared from the mapping/artifact.
 */
export async function cascadeDeleteTestCases(
  workflowId: string,
  itemId: string,
  affectedStoryKeys: Set<string>,
): Promise<void> {
  if (affectedStoryKeys.size === 0) return;

  const planRow = db.prepare<[string], { plan_id: number; test_case_ids: string; test_case_count: number }>(
    `SELECT plan_id, test_case_ids, test_case_count FROM qa_test_plan_map WHERE workflow_id = ?`
  ).get(workflowId);
  if (!planRow) return;

  const testCaseIds: Record<string, number> = JSON.parse(planRow.test_case_ids ?? '{}');
  if (Object.keys(testCaseIds).length === 0) return;

  // Find qa_tests artifact IDs for this item via approved QA checkpoints (epic-level and/or
  // legacy per-feature — same resolution buildDetail/computeLiveTestCaseCount use).
  const qaArtifactIds = getDocumentArtifactIds(itemId).testArtifactIds;

  // Collect local test case IDs whose story_ref mentions an affected story, per artifact
  // (need the owning artifactId later to prune that artifact's own test_cases array).
  const toDeleteLocalIds = new Set<string>();
  const artifactIdByLocalId = new Map<string, number>();
  for (const artifactId of qaArtifactIds) {
    const content = await loadArtifactContentById(artifactId);
    if (!content) continue;
    let qa: any;
    try { qa = JSON.parse(stripJsonFence(content)); } catch { continue; }
    for (const tc of (qa.test_cases ?? qa.testCases ?? []) as any[]) {
      if (!tc.id) continue;
      const storyRef = tc.story_ref ?? tc.linkedStory ?? null;
      if (!storyRef) continue;
      if (parseStoryRefs(storyRef).some(r => affectedStoryKeys.has(r))) {
        toDeleteLocalIds.add(String(tc.id));
        artifactIdByLocalId.set(String(tc.id), artifactId);
      }
    }
  }

  if (toDeleteLocalIds.size === 0) return;

  const localIdByAdoId = new Map<number, string>();
  for (const lid of toDeleteLocalIds) {
    const adoId = testCaseIds[lid];
    if (adoId !== undefined) localIdByAdoId.set(adoId, lid);
  }
  if (localIdByAdoId.size === 0) return;

  // Test Case work items reject the generic work item destroy call — delete each one via
  // the Test Management API instead. Best-effort: a failure on one doesn't stop the rest,
  // and only the ids ADO actually confirmed deleted are cleared from the mapping.
  const deletedAdoIds: number[] = [];
  for (const adoId of localIdByAdoId.keys()) {
    try {
      await getAzureDevOpsClient().deleteTestCase(adoId);
      deletedAdoIds.push(adoId);
    } catch (err: any) {
      logger.warn(`Failed to delete test case (ado #${adoId}) during cascade delete: ${err.message}`);
    }
  }
  const deletedLocalIds = new Set(deletedAdoIds.map(adoId => localIdByAdoId.get(adoId)!));
  for (const lid of deletedLocalIds) delete testCaseIds[lid];

  db.prepare(`UPDATE qa_test_plan_map SET test_case_ids = ?, test_case_count = ? WHERE plan_id = ?`)
    .run(JSON.stringify(testCaseIds), Math.max(0, planRow.test_case_count - deletedAdoIds.length), planRow.plan_id);

  // Prune the deleted cases from each qa_tests artifact's own test_cases array, grouped by
  // artifact so each is only re-saved once.
  const affectedArtifactIds = new Set([...deletedLocalIds].map(lid => artifactIdByLocalId.get(lid)!).filter(Boolean));
  for (const artifactId of affectedArtifactIds) {
    const content = await loadArtifactContentById(artifactId);
    if (!content) continue;
    let qa: any;
    try { qa = JSON.parse(stripJsonFence(content)); } catch { continue; }
    if (!Array.isArray(qa.test_cases)) continue;
    qa.test_cases = qa.test_cases.filter((tc: any) => !deletedLocalIds.has(String(tc.id)));
    if (qa.testCases) delete qa.testCases;
    await updateArtifactContent(artifactId, JSON.stringify(qa, null, 2));
  }

  logger.info(`Cascade deleted ${deletedAdoIds.length}/${localIdByAdoId.size} test case(s) linked to ${affectedStoryKeys.size} deleted story/stories in workflow ${workflowId}`);
}

/**
 * Remove one story from the merged 'backlog' artifact's JSON by (featureKey, story_id).
 * Feature identity is positional (featureLocalKey(index)) — the same convention the ADO push
 * uses to stamp F#/S# keys — not any embedded field, since the merge doesn't reliably carry one.
 * Returns the updated JSON string, or null if the artifact/feature/story couldn't be found.
 */
export function removeStoryFromMergedBacklog(rawContent: string, featureKey: string, storyId: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stripJsonFence(rawContent));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.features)) return null;

  const featureIndex = parsed.features.findIndex((_: any, i: number) => featureLocalKey(i) === featureKey);
  if (featureIndex === -1) return null;

  const feature = parsed.features[featureIndex];
  if (!Array.isArray(feature.stories)) return null;

  const before = feature.stories.length;
  feature.stories = feature.stories.filter((s: any) => s.story_id !== storyId);
  if (feature.stories.length === before) return null; // story not found under that feature

  return JSON.stringify(parsed, null, 2);
}

/**
 * Remove whole features and/or individual stories from the merged 'backlog' artifact in one
 * pass. Feature keys are resolved from ORIGINAL array position before anything is removed, so
 * a story-level removal in a feature that survives is unaffected by an earlier feature-level
 * removal shifting indices. Used by the work-item delete route for feature/epic deletions,
 * where whole feature entries (not just one story) need to disappear from the artifact.
 * No-ops quietly if there's no merged backlog artifact yet (e.g. deleting from ADO before
 * backlog_merge ran) or nothing in the sets actually matches.
 */
export async function pruneMergedBacklogArtifact(
  itemId: string,
  removeFeatureKeys: Set<string>,
  removeStoryKeys: Set<string>,
): Promise<void> {
  if (removeFeatureKeys.size === 0 && removeStoryKeys.size === 0) return;

  const backlogArtifact = db.prepare<[string], { id: number }>(`
    SELECT a.id FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'backlog'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  if (!backlogArtifact) return;

  const content = await loadArtifactContentById(backlogArtifact.id);
  if (!content) return;

  let parsed: any;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    return;
  }
  if (!Array.isArray(parsed.features)) return;

  const indexed = parsed.features.map((feature: any, i: number) => ({ feature, key: featureLocalKey(i) }));
  const kept = indexed.filter(({ key }: { key: string }) => !removeFeatureKeys.has(key));
  if (removeStoryKeys.size > 0) {
    for (const { feature } of kept) {
      if (Array.isArray(feature.stories)) {
        feature.stories = feature.stories.filter((s: any) => !removeStoryKeys.has(s.story_id));
      }
    }
  }
  parsed.features = kept.map(({ feature }: { feature: any }) => feature);

  await updateArtifactContent(backlogArtifact.id, JSON.stringify(parsed, null, 2));
}

/**
 * Delete one story everywhere it lives: the merged backlog artifact, its ADO work item (if
 * already pushed) with cascaded test-case cleanup, and refreshes the feature's/epic's Effort
 * rollup. Best-effort on the ADO side — logs and continues rather than throwing, since the
 * artifact-level removal (the part a human is directly waiting on) should still succeed even
 * if ADO is unreachable.
 */
export async function deleteMergedBacklogStory(
  workflowId: string,
  itemId: string,
  featureKey: string,
  storyId: string,
): Promise<void> {
  const backlogArtifact = db.prepare<[string], { id: number }>(`
    SELECT a.id FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'backlog'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);

  if (backlogArtifact) {
    const content = await loadArtifactContentById(backlogArtifact.id);
    if (content) {
      const updated = removeStoryFromMergedBacklog(content, featureKey, storyId);
      if (updated) {
        await updateArtifactContent(backlogArtifact.id, updated);
      } else {
        logger.warn(`Story ${featureKey}/${storyId} not found in merged backlog artifact ${backlogArtifact.id} — skipping artifact edit`);
      }
    }
  }

  const mapRow = db.prepare<[string, string], { id: number; ado_id: number }>(
    `SELECT id, ado_id FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story' AND local_key = ?`
  ).get(workflowId, storyId);

  if (!mapRow) return; // never reached ADO — nothing further to cascade

  try {
    await getAzureDevOpsClient().deleteWorkItem(mapRow.ado_id);
  } catch (err: any) {
    logger.warn(`Failed to delete ADO story #${mapRow.ado_id} (${storyId}): ${err.message}`);
  }

  try {
    await cascadeDeleteTestCases(workflowId, itemId, new Set([storyId]));
  } catch (err: any) {
    logger.warn(`Test case cascade delete failed for story ${storyId} (non-fatal): ${err.message}`);
  }

  db.prepare(`DELETE FROM ado_work_item_map WHERE id = ?`).run(mapRow.id);

  await recalculateEffortRollupChain(workflowId, featureKey);
}

/**
 * Delete one whole feature everywhere it lives: its ADO work item (destroy=true), its
 * child stories' ADO work items and their linked ADO test cases, all of its own + its
 * stories' ado_work_item_map rows, the merged backlog artifact entry, and the parent
 * epic's Effort rollup. Shared by the Completed Initiatives Manage tab's work-item delete
 * route and change-request feature-count reconciliation (a feature dropped from a revised
 * epic_features artifact) — one cascade so both remove a feature the same way, with
 * nothing left orphaned in ADO. No-op if the feature was never pushed to ADO for this
 * workflow.
 *
 * Unlike the story/test-case deletes below (each best-effort — logged, not thrown), the
 * feature's own ADO work item delete is allowed to throw so a caller can tell a real
 * failure apart from "nothing to delete."
 */
export async function deleteAdoFeature(
  workflowId: string,
  itemId: string,
  featureKey: string,
): Promise<void> {
  const row = db.prepare<[string, string], { ado_id: number; parent_local_key: string | null }>(
    `SELECT ado_id, parent_local_key FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'feature' AND local_key = ?`
  ).get(workflowId, featureKey);
  if (!row) return; // never reached ADO — nothing further to cascade

  const childStories = db.prepare<[string, string], { local_key: string; ado_id: number }>(
    `SELECT local_key, ado_id FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`
  ).all(workflowId, featureKey);
  const affectedStoryKeys = new Set(childStories.map(s => s.local_key));

  const client = getAzureDevOpsClient();
  await client.deleteWorkItem(row.ado_id);

  for (const story of childStories) {
    try {
      await client.deleteWorkItem(story.ado_id);
    } catch (err: any) {
      logger.warn(`Failed to delete ADO story #${story.ado_id} (${story.local_key}) under feature ${featureKey}: ${err.message}`);
    }
  }

  try {
    await cascadeDeleteTestCases(workflowId, itemId, affectedStoryKeys);
  } catch (err: any) {
    logger.warn(`Test case cascade delete failed for feature ${featureKey} (non-fatal): ${err.message}`);
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ? AND local_key = ?`).run(workflowId, featureKey);
    db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`).run(workflowId, featureKey);
  })();

  try {
    await pruneMergedBacklogArtifact(itemId, new Set([featureKey]), affectedStoryKeys);
  } catch (err: any) {
    logger.warn(`Backlog artifact prune after feature delete failed (non-fatal): ${err.message}`);
  }

  if (row.parent_local_key) {
    try {
      await recalculateEpicEffort(workflowId, row.parent_local_key);
    } catch (err: any) {
      logger.warn(`Effort rollup after feature delete failed (non-fatal): ${err.message}`);
    }
  }

  logger.info(`Deleted feature ${featureKey} (ADO #${row.ado_id}) and ${affectedStoryKeys.size} stor${affectedStoryKeys.size === 1 ? 'y' : 'ies'} from workflow ${workflowId}`);
}
