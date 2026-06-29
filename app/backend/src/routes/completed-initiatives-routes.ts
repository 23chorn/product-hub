/**
 * completed-initiatives-routes — read-only review of ADO ticket state for initiatives
 * whose pipeline has finished. "Completed" = effectiveStatus(latestWorkflow) === 'complete'
 * (same predicate as the Home page's "Done" filter) AND the item has been pushed to ADO
 * at least once. List and drill-down are 100% cached; only POST /:itemId/refresh calls ADO.
 */
import { Router, Request, Response } from 'express';
import db from '../data/database';
import Logger from '../utils/logger';
import { requireAdmin } from '../middleware/auth';
import { effectiveStatus, resolveDisplayTitle } from '@pap/shared';
import type {
  WorkflowInfo,
  WorkItemStateBucket,
  CompletedInitiativeSummary,
  CompletedInitiativeDetail,
  CompletedInitiativeWorkItemRow,
} from '@pap/shared';
import { bucketWorkItemState, workItemStatePercent } from '../integrations/azure-devops-format';
import { refreshItemAdoState } from '../integrations/ado-state-sync';
import {
  getWorkItemRowsByItem, getTestPlanRowsByItem, getDocumentArtifactIds,
  type AdoWorkItemRow, type QaTestPlanRow,
} from '../data/work-item-queries';

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

function buildSummary(
  itemId: string,
  seqNum: number | null,
  title: string,
  workItemRows: AdoWorkItemRow[],
  testPlanRows: QaTestPlanRow[]
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
    testCaseCount: testPlanRows.reduce((sum, r) => sum + (r.test_case_count ?? 0), 0),
    lastRefreshedAt: anyUnsynced ? null : minSyncedAt,
    percentComplete: computePercentComplete(workItemRows),
  };
}

function toWorkItemRow(row: AdoWorkItemRow): CompletedInitiativeWorkItemRow {
  return {
    localKey: row.local_key,
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

function buildDetail(item: CandidateRow): CompletedInitiativeDetail {
  const workItemRows = getWorkItemRowsByItem([item.id]).get(item.id) ?? [];
  const testPlanRows = getTestPlanRowsByItem([item.id]).get(item.id) ?? [];
  const summary = buildSummary(item.id, item.seq_num, item.title, workItemRows, testPlanRows);
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
function listCompletedSummaries(archived: boolean): CompletedInitiativeSummary[] {
  const candidates = getCandidateItems(archived);
  const workflowInfoByItem = getLatestWorkflowInfo(candidates.map(c => c.id));
  const completedItems = filterCompleted(candidates, workflowInfoByItem)
    .map(c => withDisplayTitle(c, workflowInfoByItem));
  if (completedItems.length === 0) return [];

  const itemIds = completedItems.map(c => c.id);
  const workItemRowsByItem = getWorkItemRowsByItem(itemIds);
  const testPlanRowsByItem = getTestPlanRowsByItem(itemIds);

  return completedItems.map(c =>
    buildSummary(c.id, c.seq_num, c.title, workItemRowsByItem.get(c.id) ?? [], testPlanRowsByItem.get(c.id) ?? [])
  );
}

const setItemStatus = db.prepare(`UPDATE items SET status = ?, updated_at = ? WHERE id = ?`);
const getShippedAt = db.prepare(`SELECT shipped_at FROM items WHERE id = ?`);

/**
 * GET /api/completed-initiatives
 * List every completed, ADO-pushed initiative with rollup counts and state buckets.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(listCompletedSummaries(false));
  } catch (error: any) {
    logger.error('Failed to list completed initiatives', error);
    res.status(500).json({ error: error.message || 'Failed to list completed initiatives' });
  }
});

/**
 * GET /api/completed-initiatives/archived
 * Admin-only review list — initiatives manually archived off the default list above.
 */
router.get('/archived', requireAdmin, (_req: Request, res: Response) => {
  try {
    res.json(listCompletedSummaries(true));
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
router.get('/:itemId', (req: Request, res: Response) => {
  try {
    const item = getCompletedItemOrUndefined(req.params.itemId, req.query.archived === 'true');
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });
    res.json(buildDetail(item));
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
    res.json({ ...buildDetail(item), refreshed, notFound });
  } catch (error: any) {
    logger.error('Failed to refresh ADO state', error);
    res.status(500).json({ error: error.message || 'Failed to refresh ADO state' });
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
