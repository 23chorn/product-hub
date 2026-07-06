/**
 * completed-initiatives-routes — review of ADO ticket state for initiatives whose pipeline
 * has finished. "Completed" = effectiveStatus(latestWorkflow) === 'complete' (same predicate
 * as the Home page's "Done" filter) AND the item has been pushed to ADO at least once.
 * List and drill-down are 100% cached; POST /:itemId/refresh, PATCH/DELETE work-items call ADO.
 */
import { Router, Request, Response } from 'express';
import db from '../data/database';
import Logger from '../utils/logger';
import { requireAdmin } from '../middleware/auth';
import { effectiveStatus, resolveDisplayTitle, tryParseQATests, mergeQaTests } from '@pap/shared';
import type {
  WorkflowInfo,
  WorkItemStateBucket,
  CompletedInitiativeSummary,
  CompletedInitiativeDetail,
  CompletedInitiativeWorkItemRow,
  AssignedUser,
} from '@pap/shared';
import { bucketWorkItemState, workItemStatePercent, parseStoryRefs } from '../integrations/azure-devops-format';
import { refreshItemAdoState } from '../integrations/ado-state-sync';
import { getAzureDevOpsClient } from '../integrations/azure-devops';
import { loadArtifactContentById, updateArtifactContent } from '../agents/artifact-helpers';
import { stripJsonFence } from '../utils/json-repair';
import {
  getWorkItemRowsByItem, getTestPlanRowsByItem, getDocumentArtifactIds,
  type AdoWorkItemRow,
} from '../data/work-item-queries';
import { getAssignedUsersByItem } from '../data/item-assignments';

const logger = new Logger('COMPLETED-INITIATIVES');
const router = Router();

interface CandidateRow {
  id: string;
  title: string;
  seq_num: number | null;
}

const EMPTY_BUCKETS: Record<WorkItemStateBucket, number> = { not_started: 0, in_progress: 0, done: 0, removed: 0 };

const MAPPED_TO_ADO_EXISTS = `
  EXISTS (SELECT 1 FROM ado_work_item_map m JOIN workflows w ON w.id = m.workflow_id WHERE w.item_id = i.id)
`;

/** Shared WHERE clause for both the active and the admin-only archived candidate queries. */
function candidatesPredicate(archived: boolean): string {
  return `i.source IN ('local', 'airtable') AND i.status ${archived ? '=' : '!='} 'archived' AND ${MAPPED_TO_ADO_EXISTS}`;
}

/** Items pushed to ADO at least once, source local/airtable. Archived ones are excluded
 *  by default; pass `archived: true` for the admin-only archived review list. */
export function getCandidateItems(archived = false): CandidateRow[] {
  return db.prepare(`
    SELECT DISTINCT i.id, i.title, i.seq_num FROM items i
    WHERE ${candidatesPredicate(archived)}
    ORDER BY i.created_at DESC
  `).all() as CandidateRow[];
}

function getCandidateItem(itemId: string, archived = false): CandidateRow | undefined {
  return db.prepare(`
    SELECT i.id, i.title, i.seq_num FROM items i
    WHERE i.id = ? AND ${candidatesPredicate(archived)}
  `).get(itemId) as CandidateRow | undefined;
}

/** Latest-workflow WorkflowInfo per item id — same inputs initiatives-routes.ts uses for the Home "Done" filter. */
function getLatestWorkflowInfo(itemIds: string[]): Map<string, WorkflowInfo> {
  const result = new Map<string, WorkflowInfo>();
  if (itemIds.length === 0) return result;

  const wfRows = db.prepare(`
    SELECT w.item_id, w.id, w.status, w.current_stage, w.summary, w.updated_at
    FROM workflows w
    INNER JOIN (
      SELECT item_id, MAX(created_at) as max_created FROM workflows GROUP BY item_id
    ) latest ON w.item_id = latest.item_id AND w.created_at = latest.max_created
    WHERE w.item_id IN (${itemIds.map(() => '?').join(',')})
  `).all(...itemIds) as Array<{ item_id: string; id: string; status: string; current_stage: string | null; summary: string | null; updated_at: number }>;

  const workflowIds = wfRows.map(w => w.id);
  const pipelineMap = new Map<string, string>();
  const cancelledSet = new Set<string>();
  if (workflowIds.length > 0) {
    const prRows = db.prepare(`
      SELECT pr.workflow_id, pr.status
      FROM pipeline_runs pr
      INNER JOIN (
        SELECT workflow_id, MAX(created_at) as max_created FROM pipeline_runs GROUP BY workflow_id
      ) latest ON pr.workflow_id = latest.workflow_id AND pr.created_at = latest.max_created
      WHERE pr.workflow_id IN (${workflowIds.map(() => '?').join(',')})
    `).all(...workflowIds) as Array<{ workflow_id: string; status: string }>;
    for (const pr of prRows) pipelineMap.set(pr.workflow_id, pr.status);

    const cancelledRows = db.prepare(`
      SELECT DISTINCT workflow_id FROM workflow_events
      WHERE workflow_id IN (${workflowIds.map(() => '?').join(',')}) AND event_type = 'workflow_cancelled'
    `).all(...workflowIds) as Array<{ workflow_id: string }>;
    for (const r of cancelledRows) cancelledSet.add(r.workflow_id);
  }

  for (const wf of wfRows) {
    result.set(wf.item_id, {
      id: wf.id,
      status: wf.status,
      currentStage: wf.current_stage,
      summary: wf.summary,
      pipelineStatus: pipelineMap.get(wf.id),
      isCancelled: cancelledSet.has(wf.id),
      updatedAt: wf.updated_at,
    });
  }
  return result;
}

/**
 * Filters candidates down to those whose latest workflow is effectively complete.
 * Accepts a precomputed workflowInfoByItem map when the caller already has one (e.g. to
 * also resolve display titles), otherwise fetches it itself.
 */
export function filterCompleted(candidates: CandidateRow[], workflowInfoByItem?: Map<string, WorkflowInfo>): CandidateRow[] {
  if (candidates.length === 0) return [];
  const infoByItem = workflowInfoByItem ?? getLatestWorkflowInfo(candidates.map(c => c.id));
  return candidates.filter(c => {
    const wf = infoByItem.get(c.id);
    return wf != null && effectiveStatus(wf) === 'complete';
  });
}

/** Display title for a candidate — the latest workflow's AI-generated summary wins when present, else the raw item title. */
function withDisplayTitle(candidate: CandidateRow, workflowInfoByItem: Map<string, WorkflowInfo>): CandidateRow {
  return { ...candidate, title: resolveDisplayTitle(candidate.title, workflowInfoByItem.get(candidate.id)?.summary) };
}

/** The work items whose state should drive the % complete rollup: stories are the most
 *  granular unit actually worked, so they win whenever any exist; an initiative with
 *  features that were never decomposed into stories falls back to the features themselves
 *  so it isn't left without a progress figure. */
function progressRows(workItemRows: AdoWorkItemRow[]): AdoWorkItemRow[] {
  const stories = workItemRows.filter(r => r.ado_type === 'story');
  return stories.length > 0 ? stories : workItemRows.filter(r => r.ado_type === 'feature');
}

/** Average ADO status progress across the progress rows that have a synced state. Null when
 *  none of them have synced yet, so the UI can distinguish "0% done" from "not yet known". */
export function computePercentComplete(workItemRows: AdoWorkItemRow[]): number | null {
  const synced = progressRows(workItemRows).filter(r => r.state != null);
  if (synced.length === 0) return null;
  const total = synced.reduce((sum, r) => sum + workItemStatePercent(r.state!), 0);
  return Math.round(total / synced.length);
}

/** Live test case count from the current per-feature qa_tests artifacts — NOT
 *  qa_test_plan_map.test_case_count, which is only a snapshot as of the last ADO push and
 *  goes stale the moment a test case is added/removed locally (completed-initiatives test-case
 *  routes below only rewrite the artifact, they don't touch qa_test_plan_map). Mirrors the
 *  merge CompletedInitiativeDetail.tsx does client-side so the list and detail views agree. */
async function computeLiveTestCaseCount(itemId: string): Promise<number> {
  const { testArtifactIds } = getDocumentArtifactIds(itemId);
  if (testArtifactIds.length === 0) return 0;
  const parsed = await Promise.all(testArtifactIds.map(async (id, num) => {
    const content = await loadArtifactContentById(id);
    const data = content ? tryParseQATests(content) : null;
    return data ? { num, data } : null;
  }));
  const valid = parsed.filter((p): p is { num: number; data: NonNullable<ReturnType<typeof tryParseQATests>> } => p != null);
  return mergeQaTests(valid)?.test_cases.length ?? 0;
}

function buildSummary(
  itemId: string,
  seqNum: number | null,
  title: string,
  workItemRows: AdoWorkItemRow[],
  testCaseCount: number,
  assignedUsers: AssignedUser[]
): CompletedInitiativeSummary {
  const stateBuckets: Record<WorkItemStateBucket, number> = { ...EMPTY_BUCKETS };
  let epicCount = 0, featureCount = 0, storyCount = 0;
  let epicAdoUrl: string | null = null;
  let latestEpicCreatedAt = -Infinity;
  let anyUnsynced = false;
  let minSyncedAt: number | null = null;

  for (const row of workItemRows) {
    if (row.ado_type === 'epic') {
      epicCount++;
      if (row.created_at > latestEpicCreatedAt) {
        latestEpicCreatedAt = row.created_at;
        epicAdoUrl = row.ado_url;
      }
    } else if (row.ado_type === 'feature') {
      featureCount++;
    } else {
      storyCount++;
    }

    if (row.state != null) stateBuckets[bucketWorkItemState(row.state)]++;

    if (row.state_synced_at == null) {
      anyUnsynced = true;
    } else if (minSyncedAt == null || row.state_synced_at < minSyncedAt) {
      minSyncedAt = row.state_synced_at;
    }
  }

  return {
    itemId,
    seqNum,
    title,
    epicAdoUrl,
    epicCount,
    featureCount,
    storyCount,
    stateBuckets,
    testCaseCount,
    lastRefreshedAt: anyUnsynced ? null : minSyncedAt,
    percentComplete: computePercentComplete(workItemRows),
    assignedUsers,
  };
}

function toWorkItemRow(row: AdoWorkItemRow): CompletedInitiativeWorkItemRow {
  return {
    localKey: row.local_key,
    parentLocalKey: row.parent_local_key ?? null,
    adoId: row.ado_id,
    adoType: row.ado_type,
    adoUrl: row.ado_url,
    title: row.title,
    state: row.state,
    stateBucket: row.state != null ? bucketWorkItemState(row.state) : null,
    statePercent: row.state != null ? workItemStatePercent(row.state) : null,
    stateSyncedAt: row.state_synced_at,
    artifactId: row.artifact_id,
  };
}

async function buildDetail(item: CandidateRow): Promise<CompletedInitiativeDetail> {
  const workItemRows = getWorkItemRowsByItem([item.id]).get(item.id) ?? [];
  const testPlanRows = getTestPlanRowsByItem([item.id]).get(item.id) ?? [];
  const assignedUsers = getAssignedUsersByItem([item.id]).get(item.id) ?? [];
  const testCaseCount = await computeLiveTestCaseCount(item.id);
  const summary = buildSummary(item.id, item.seq_num, item.title, workItemRows, testCaseCount, assignedUsers);
  return {
    ...summary,
    workItems: workItemRows.map(toWorkItemRow),
    testPlans: testPlanRows.map(r => ({ planId: r.plan_id, planUrl: r.plan_url, testCaseCount: r.test_case_count, artifactId: r.artifact_id })),
    ...getDocumentArtifactIds(item.id),
  };
}

/** Same completion + ADO-mapping gate as the list, for a single item. Undefined if it doesn't qualify. */
export function getCompletedItemOrUndefined(itemId: string, archived = false): CandidateRow | undefined {
  const item = getCandidateItem(itemId, archived);
  if (!item) return undefined;
  const workflowInfoByItem = getLatestWorkflowInfo([item.id]);
  const completed = filterCompleted([item], workflowInfoByItem)[0];
  return completed && withDisplayTitle(completed, workflowInfoByItem);
}

/** Builds the summary list for either the default (active) or admin-only archived view. */
async function listCompletedSummaries(archived: boolean): Promise<CompletedInitiativeSummary[]> {
  const candidates = getCandidateItems(archived);
  const workflowInfoByItem = getLatestWorkflowInfo(candidates.map(c => c.id));
  const completedItems = filterCompleted(candidates, workflowInfoByItem)
    .map(c => withDisplayTitle(c, workflowInfoByItem));
  if (completedItems.length === 0) return [];

  const itemIds = completedItems.map(c => c.id);
  const workItemRowsByItem = getWorkItemRowsByItem(itemIds);
  const assignedUsersByItem = getAssignedUsersByItem(itemIds);
  const testCaseCounts = await Promise.all(itemIds.map(computeLiveTestCaseCount));
  const testCaseCountByItem = new Map(itemIds.map((id, i) => [id, testCaseCounts[i]]));

  return completedItems.map(c =>
    buildSummary(
      c.id, c.seq_num, c.title,
      workItemRowsByItem.get(c.id) ?? [],
      testCaseCountByItem.get(c.id) ?? 0,
      assignedUsersByItem.get(c.id) ?? [],
    )
  );
}

const setItemStatus = db.prepare(`UPDATE items SET status = ?, updated_at = ? WHERE id = ?`);
const getShippedAt = db.prepare(`SELECT shipped_at FROM items WHERE id = ?`);

/**
 * Delete ADO test case work items whose story_ref links them to any of the given story
 * local keys, then remove them from the qa_test_plan_map tracking row.
 * Non-throwing — caller should wrap in try/catch if failure must be non-fatal.
 */
async function cascadeDeleteTestCases(
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

  // Collect local test case IDs whose story_ref mentions an affected story.
  const toDeleteLocalIds = new Set<string>();
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
  for (const adoId of deletedAdoIds) delete testCaseIds[localIdByAdoId.get(adoId)!];

  db.prepare(`UPDATE qa_test_plan_map SET test_case_ids = ?, test_case_count = ? WHERE plan_id = ?`)
    .run(JSON.stringify(testCaseIds), Math.max(0, planRow.test_case_count - deletedAdoIds.length), planRow.plan_id);

  logger.info(`Cascade deleted ${deletedAdoIds.length}/${localIdByAdoId.size} test case(s) linked to ${affectedStoryKeys.size} deleted story/stories in workflow ${workflowId}`);
}

/**
 * GET /api/completed-initiatives
 * List every completed, ADO-pushed initiative with rollup counts and state buckets.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await listCompletedSummaries(false));
  } catch (error: any) {
    logger.error('Failed to list completed initiatives', error);
    res.status(500).json({ error: error.message || 'Failed to list completed initiatives' });
  }
});

/**
 * GET /api/completed-initiatives/archived
 * Admin-only review list — initiatives manually archived off the default list above.
 */
router.get('/archived', requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await listCompletedSummaries(true));
  } catch (error: any) {
    logger.error('Failed to list archived initiatives', error);
    res.status(500).json({ error: error.message || 'Failed to list archived initiatives' });
  }
});

/**
 * GET /api/completed-initiatives/:itemId
 * Cached drill-down — full work item + test plan rows. No ADO call.
 * ?archived=true looks it up among archived initiatives instead (admin review view).
 */
router.get('/:itemId', async (req: Request, res: Response) => {
  try {
    const item = getCompletedItemOrUndefined(req.params.itemId, req.query.archived === 'true');
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });
    res.json(await buildDetail(item));
  } catch (error: any) {
    logger.error('Failed to load completed initiative', error);
    res.status(500).json({ error: error.message || 'Failed to load completed initiative' });
  }
});

/**
 * POST /api/completed-initiatives/:itemId/refresh
 * The only endpoint in this feature that calls ADO — one batched workitemsbatch request.
 */
router.post('/:itemId/refresh', async (req: Request, res: Response) => {
  try {
    const item = getCompletedItemOrUndefined(req.params.itemId, req.query.archived === 'true');
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });
    const { refreshed, notFound } = await refreshItemAdoState(item.id);
    res.json({ ...(await buildDetail(item)), refreshed, notFound });
  } catch (error: any) {
    logger.error('Failed to refresh ADO state', error);
    res.status(500).json({ error: error.message || 'Failed to refresh ADO state' });
  }
});

/**
 * PATCH /api/completed-initiatives/:itemId/work-items/:adoId
 * Update a single work item's title and/or description in ADO and keep the local
 * ado_work_item_map title in sync. Accepts plain text for description — ADO stores it as-is.
 *
 * Body: { title?: string; description?: string }
 * Returns: CompletedInitiativeDetail (updated)
 */
router.patch('/:itemId/work-items/:adoId', async (req: Request, res: Response) => {
  try {
    const archived = req.query.archived === 'true';
    const item = getCompletedItemOrUndefined(req.params.itemId, archived);
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });

    const adoId = parseInt(req.params.adoId, 10);
    if (!Number.isFinite(adoId)) return res.status(400).json({ error: 'Invalid ADO ID' });

    const row = db.prepare<[string, number], { id: number }>(
      `SELECT m.id FROM ado_work_item_map m
       JOIN workflows w ON w.id = m.workflow_id
       WHERE w.item_id = ? AND m.ado_id = ?`
    ).get(item.id, adoId);
    if (!row) return res.status(404).json({ error: `Work item ${adoId} not found for this initiative` });

    const { title, description } = req.body as { title?: unknown; description?: unknown };
    const updates: { title?: string; description?: string } = {};
    if (typeof title === 'string' && title.trim()) updates.title = title.trim();
    if (typeof description === 'string' && description.trim()) updates.description = description.trim();
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Provide at least one of: title, description' });
    }

    const ado = getAzureDevOpsClient();
    await ado.updateWorkItem(adoId, updates);

    if (updates.title) {
      db.prepare(`UPDATE ado_work_item_map SET title = ? WHERE id = ?`).run(updates.title, row.id);
    }

    logger.info(`Updated ADO #${adoId} for initiative ${item.id}: ${Object.keys(updates).join(', ')}`);
    res.json(await buildDetail(item));
  } catch (error: any) {
    logger.error('Failed to update work item', error);
    res.status(500).json({ error: error.message || 'Failed to update work item' });
  }
});

/**
 * DELETE /api/completed-initiatives/:itemId/work-items/:adoId
 * Permanently delete a work item from ADO (destroy=true, bypasses recycle bin) and remove
 * its local ado_work_item_map row. When deleting a feature, also removes its child story
 * rows from the local DB (ADO children are not automatically deleted — handle in ADO directly
 * if the stories also need to be removed).
 *
 * Returns: CompletedInitiativeDetail (updated, without the deleted row)
 */
router.delete('/:itemId/work-items/:adoId', async (req: Request, res: Response) => {
  try {
    const archived = req.query.archived === 'true';
    const item = getCompletedItemOrUndefined(req.params.itemId, archived);
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });

    const adoId = parseInt(req.params.adoId, 10);
    if (!Number.isFinite(adoId)) return res.status(400).json({ error: 'Invalid ADO ID' });

    const row = db.prepare<[string, number], { id: number; local_key: string; ado_type: string; workflow_id: string }>(
      `SELECT m.id, m.local_key, m.ado_type, m.workflow_id
       FROM ado_work_item_map m
       JOIN workflows w ON w.id = m.workflow_id
       WHERE w.item_id = ? AND m.ado_id = ?`
    ).get(item.id, adoId);
    if (!row) return res.status(404).json({ error: `Work item ${adoId} not found for this initiative` });

    // Collect affected story local keys before any deletes (needed for test case cascade)
    const affectedStoryKeys = new Set<string>();
    if (row.ado_type === 'story') {
      affectedStoryKeys.add(row.local_key);
    } else if (row.ado_type === 'feature') {
      for (const s of db.prepare<[string, string], { local_key: string }>(
        `SELECT local_key FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`
      ).all(row.workflow_id, row.local_key)) affectedStoryKeys.add(s.local_key);
    } else if (row.ado_type === 'epic') {
      for (const f of db.prepare<[string, string], { local_key: string }>(
        `SELECT local_key FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`
      ).all(row.workflow_id, row.local_key)) {
        for (const s of db.prepare<[string, string], { local_key: string }>(
          `SELECT local_key FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`
        ).all(row.workflow_id, f.local_key)) affectedStoryKeys.add(s.local_key);
      }
    }

    const ado = getAzureDevOpsClient();
    await ado.deleteWorkItem(adoId);

    // Cascade: delete ADO test cases linked to the deleted stories
    try {
      await cascadeDeleteTestCases(row.workflow_id, item.id, affectedStoryKeys);
    } catch (err: any) {
      logger.warn(`Test case cascade delete failed (non-fatal): ${err.message}`);
    }

    db.transaction(() => {
      db.prepare(`DELETE FROM ado_work_item_map WHERE id = ?`).run(row.id);
      if (row.ado_type === 'feature') {
        db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`)
          .run(row.workflow_id, row.local_key);
      }
      if (row.ado_type === 'epic') {
        const childFeatures = db.prepare<[string, string], { local_key: string }>(
          `SELECT local_key FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`
        ).all(row.workflow_id, row.local_key);
        for (const f of childFeatures) {
          db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`)
            .run(row.workflow_id, f.local_key);
        }
        db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ? AND parent_local_key = ?`)
          .run(row.workflow_id, row.local_key);
      }
    })();

    logger.info(`Deleted ${row.ado_type} ADO #${adoId} (${row.local_key}) from initiative ${item.id}`);
    res.json(await buildDetail(item));
  } catch (error: any) {
    logger.error('Failed to delete work item', error);
    res.status(500).json({ error: error.message || 'Failed to delete work item' });
  }
});

// ── Test case management ──────────────────────────────────────────────────────
// Add/delete individual test cases directly on the artifact that actually holds them.
// A qa_tests artifact type isn't unique per item — legacy items have one per feature
// (story_decomposition_F<n>_qa) and current items have one at epic level (epic_qa) — so
// "the latest qa_tests artifact overall" can silently be the wrong one. Every test case
// is mutated in place via updateArtifactContent, keeping its existing checkpoint link.

interface QaArtifact { artifactId: number; suite: { test_cases: any[]; testCases?: any[]; [k: string]: any } }

/** Every real QA test-suite artifact for this item (epic-level and/or legacy per-feature),
 *  newest first, parsed and ready to mutate. */
async function loadQaArtifacts(itemId: string): Promise<QaArtifact[]> {
  const { testArtifactIds } = getDocumentArtifactIds(itemId);
  if (testArtifactIds.length === 0) return [];
  const rows = db.prepare(
    `SELECT id FROM artifacts WHERE id IN (${testArtifactIds.map(() => '?').join(',')}) ORDER BY created_at DESC`
  ).all(...testArtifactIds) as { id: number }[];

  const results: QaArtifact[] = [];
  for (const row of rows) {
    const content = await loadArtifactContentById(row.id);
    if (!content) continue;
    try {
      const suite = JSON.parse(stripJsonFence(content));
      if (!Array.isArray(suite.test_cases)) suite.test_cases = suite.testCases ?? [];
      results.push({ artifactId: row.id, suite });
    } catch { /* skip an unparsable artifact rather than fail the whole lookup */ }
  }
  return results;
}

/**
 * Delete the ADO test case work item mapped to a single local test-case id, then drop it
 * from every qa_test_plan_map row for this item. Searches all of the item's plan rows
 * (not just the newest) since legacy items can have more than one. Non-throwing —
 * caller treats ADO sync as best-effort so a failure never blocks the local delete.
 */
async function deleteAdoTestCase(itemId: string, tcId: string): Promise<void> {
  const planRows = db.prepare<[string], { plan_id: number; test_case_ids: string; test_case_count: number }>(`
    SELECT q.plan_id, q.test_case_ids, q.test_case_count
    FROM qa_test_plan_map q
    JOIN workflows w ON w.id = q.workflow_id
    WHERE w.item_id = ?
  `).all(itemId);

  for (const planRow of planRows) {
    const testCaseIds: Record<string, number> = JSON.parse(planRow.test_case_ids ?? '{}');
    const adoId = testCaseIds[tcId];
    if (adoId === undefined) continue;

    await getAzureDevOpsClient().deleteTestCase(adoId);

    delete testCaseIds[tcId];
    db.prepare(`UPDATE qa_test_plan_map SET test_case_ids = ?, test_case_count = ? WHERE plan_id = ?`)
      .run(JSON.stringify(testCaseIds), Math.max(0, planRow.test_case_count - 1), planRow.plan_id);
    logger.info(`Deleted ADO test case work item #${adoId} for local test case ${tcId}`);
    return;
  }
}

/**
 * DELETE /api/completed-initiatives/:itemId/test-cases/:tcId
 * Deletes the mapped ADO test case work item first — if that fails (and it wasn't already
 * gone), the local artifact is left untouched so Product Hub and ADO never disagree about
 * whether the test case still exists. Only once ADO confirms it's gone (or there was no ADO
 * mapping to begin with, e.g. a case never pushed) does it remove the case from every QA suite
 * artifact for this item (epic-level and/or legacy per-feature).
 * Returns: CompletedInitiativeDetail
 */
router.delete('/:itemId/test-cases/:tcId', async (req: Request, res: Response) => {
  try {
    const archived = req.query.archived === 'true';
    const item = getCompletedItemOrUndefined(req.params.itemId, archived);
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });

    const tcId = req.params.tcId;

    try {
      await deleteAdoTestCase(item.id, tcId);
    } catch (err: any) {
      logger.error(`ADO test case delete failed for ${tcId}: ${err.message}`);
      return res.status(502).json({ error: `Could not delete the test case in Azure DevOps: ${err.message}` });
    }

    const qaArtifacts = await loadQaArtifacts(item.id);
    let found = false;
    for (const { artifactId, suite } of qaArtifacts) {
      const before = suite.test_cases.length;
      suite.test_cases = suite.test_cases.filter((tc: any) => tc.id !== tcId);
      if (suite.test_cases.length === before) continue;
      if (suite.testCases) delete suite.testCases;
      await updateArtifactContent(artifactId, JSON.stringify(suite, null, 2));
      found = true;
      break;
    }
    if (!found) return res.status(404).json({ error: `Test case ${tcId} not found` });

    logger.info(`Deleted test case ${tcId} from qa_tests for initiative ${item.id}`);
    res.json(await buildDetail(item));
  } catch (error: any) {
    logger.error('Failed to delete test case', error);
    res.status(500).json({ error: error.message || 'Failed to delete test case' });
  }
});

/**
 * POST /api/completed-initiatives/:itemId/archive
 * Admin-only manual archive — hides an initiative from the default Home list, without
 * touching its workflow/ADO state. Accepts both completed initiatives (with a workflow
 * that ran to completion) and not-started initiatives (no workflow yet) — the latter
 * allows cleaning up initiatives that were created but never launched.
 */
router.post('/:itemId/archive', requireAdmin, (req: Request, res: Response) => {
  try {
    const itemId = req.params.itemId;
    const itemRow = db.prepare<[string], { id: string; title: string }>(`
      SELECT i.id, i.title FROM items i
      WHERE i.id = ? AND i.source IN ('local', 'airtable') AND i.status != 'archived'
    `).get(itemId);
    if (!itemRow) return res.status(404).json({ error: 'Initiative not found or already archived' });

    const wfRow = db.prepare<[string], { status: string }>(`
      SELECT w.status FROM workflows w WHERE w.item_id = ? ORDER BY w.created_at DESC LIMIT 1
    `).get(itemId);
    // Allow archiving if: no workflow yet (not started), or the workflow is complete
    if (wfRow && wfRow.status !== 'complete') {
      return res.status(400).json({ error: 'Only completed or not-started initiatives can be archived' });
    }

    setItemStatus.run('archived', Date.now(), itemRow.id);
    logger.info(`Archived ${wfRow ? 'completed' : 'not-started'} initiative ${itemRow.id} ("${itemRow.title}")`);
    res.json({ ok: true });
  } catch (error: any) {
    logger.error('Failed to archive initiative', error);
    res.status(500).json({ error: error.message || 'Failed to archive initiative' });
  }
});

/**
 * POST /api/completed-initiatives/:itemId/unarchive
 * Admin-only restore — returns to 'shipped' if the item was ever marked shipped, else
 * 'active', so it reappears in the default Progress Tracker list.
 */
router.post('/:itemId/unarchive', requireAdmin, (req: Request, res: Response) => {
  try {
    const item = getCompletedItemOrUndefined(req.params.itemId, true);
    if (!item) return res.status(404).json({ error: 'Archived initiative not found' });
    const row = getShippedAt.get(item.id) as { shipped_at: number | null };
    setItemStatus.run(row.shipped_at != null ? 'shipped' : 'active', Date.now(), item.id);
    logger.info(`Unarchived completed initiative ${item.id} ("${item.title}")`);
    res.json({ ok: true });
  } catch (error: any) {
    logger.error('Failed to unarchive completed initiative', error);
    res.status(500).json({ error: error.message || 'Failed to unarchive completed initiative' });
  }
});

export default router;
