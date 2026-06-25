/**
 * completed-initiatives-routes — read-only review of ADO ticket state for initiatives
 * whose pipeline has finished. "Completed" = effectiveStatus(latestWorkflow) === 'complete'
 * (same predicate as the Home page's "Done" filter) AND the item has been pushed to ADO
 * at least once. List and drill-down are 100% cached; only POST /:itemId/refresh calls ADO.
 */
import { Router, Request, Response } from 'express';
import db from '../data/database';
import Logger from '../utils/logger';
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

const logger = new Logger('COMPLETED-INITIATIVES');
const router = Router();

interface CandidateRow {
  id: string;
  title: string;
  seq_num: number | null;
}

interface RawWorkItemRow {
  itemId: string;
  ado_id: number;
  ado_type: 'epic' | 'feature' | 'story';
  ado_url: string | null;
  local_key: string;
  title: string;
  state: string | null;
  state_synced_at: number | null;
  artifact_id: number | null;
  created_at: number;
}

interface RawTestPlanRow {
  itemId: string;
  plan_id: number;
  plan_url: string;
  test_case_count: number | null;
  artifact_id: number | null;
}

const EMPTY_BUCKETS: Record<WorkItemStateBucket, number> = { not_started: 0, in_progress: 0, done: 0, removed: 0 };

const MAPPED_TO_ADO_EXISTS = `
  EXISTS (SELECT 1 FROM ado_work_item_map m JOIN workflows w ON w.id = m.workflow_id WHERE w.item_id = i.id)
`;

/** Items pushed to ADO at least once, source local/airtable, not archived. */
export function getCandidateItems(): CandidateRow[] {
  return db.prepare(`
    SELECT DISTINCT i.id, i.title, i.seq_num FROM items i
    WHERE i.source IN ('local', 'airtable') AND i.status != 'archived' AND ${MAPPED_TO_ADO_EXISTS}
    ORDER BY i.created_at DESC
  `).all() as CandidateRow[];
}

function getCandidateItem(itemId: string): CandidateRow | undefined {
  return db.prepare(`
    SELECT i.id, i.title, i.seq_num FROM items i
    WHERE i.id = ? AND i.source IN ('local', 'airtable') AND i.status != 'archived' AND ${MAPPED_TO_ADO_EXISTS}
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

/** All ado_work_item_map rows across every workflow of each item, grouped by item id. */
function getWorkItemRowsByItem(itemIds: string[]): Map<string, RawWorkItemRow[]> {
  const map = new Map<string, RawWorkItemRow[]>();
  if (itemIds.length === 0) return map;
  const rows = db.prepare(`
    SELECT w.item_id as itemId, m.ado_id, m.ado_type, m.ado_url, m.local_key, m.title, m.state, m.state_synced_at, m.artifact_id, m.created_at
    FROM ado_work_item_map m
    JOIN workflows w ON w.id = m.workflow_id
    WHERE w.item_id IN (${itemIds.map(() => '?').join(',')})
  `).all(...itemIds) as RawWorkItemRow[];
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push(row);
  }
  return map;
}

/** All qa_test_plan_map rows across every workflow of each item, grouped by item id. */
function getTestPlanRowsByItem(itemIds: string[]): Map<string, RawTestPlanRow[]> {
  const map = new Map<string, RawTestPlanRow[]>();
  if (itemIds.length === 0) return map;
  const rows = db.prepare(`
    SELECT w.item_id as itemId, q.plan_id, q.plan_url, q.test_case_count, q.artifact_id
    FROM qa_test_plan_map q
    JOIN workflows w ON w.id = q.workflow_id
    WHERE w.item_id IN (${itemIds.map(() => '?').join(',')})
  `).all(...itemIds) as RawTestPlanRow[];
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push(row);
  }
  return map;
}

/** The work items whose state should drive the % complete rollup: stories are the most
 *  granular unit actually worked, so they win whenever any exist; an initiative with
 *  features that were never decomposed into stories falls back to the features themselves
 *  so it isn't left without a progress figure. */
function progressRows(workItemRows: RawWorkItemRow[]): RawWorkItemRow[] {
  const stories = workItemRows.filter(r => r.ado_type === 'story');
  return stories.length > 0 ? stories : workItemRows.filter(r => r.ado_type === 'feature');
}

/** Average ADO status progress across the progress rows that have a synced state. Null when
 *  none of them have synced yet, so the UI can distinguish "0% done" from "not yet known". */
export function computePercentComplete(workItemRows: RawWorkItemRow[]): number | null {
  const synced = progressRows(workItemRows).filter(r => r.state != null);
  if (synced.length === 0) return null;
  const total = synced.reduce((sum, r) => sum + workItemStatePercent(r.state!), 0);
  return Math.round(total / synced.length);
}

function buildSummary(
  itemId: string,
  seqNum: number | null,
  title: string,
  workItemRows: RawWorkItemRow[],
  testPlanRows: RawTestPlanRow[]
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

function toWorkItemRow(row: RawWorkItemRow): CompletedInitiativeWorkItemRow {
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

/**
 * Document artifact ids for the detail page's tabs, resolved independent of the ADO
 * push-tracking tables above. `ado_work_item_map.artifact_id` / `qa_test_plan_map.artifact_id`
 * are unreliable: the multi-feature push path (feature-decomposition.ts pushEpicAndFeaturesToADO
 * / pushFeatureToADO, used by every epic_feature_planner-based workflow) hardcodes them to NULL
 * for every epic/feature/story/test-plan row it inserts — it was simply never wired up there.
 * So every document here is instead resolved straight from artifacts/checkpoints:
 *  - research/PRD/architecture/figma: whole-initiative documents, one each — "latest artifact
 *    of this type for this item" (same query pushTestPlanToAdo's qa_tests lookup already uses).
 *  - tickets: the single backlog_merge output ('backlog' type) already combines every feature,
 *    so no per-feature merge is needed here the way the frontend has to for QA.
 *  - test cases: qa_tests is not a per-feature-suffixed type (unlike backlog_F<n>), so "latest"
 *    alone can't be trusted to mean "every feature's latest" — resolve one artifact id per
 *    story_decomposition_F<n>_qa checkpoint instead, mirroring how pushFeatureToADO itself
 *    looks up a single feature's QA checkpoint (feature-decomposition.ts).
 */
function getDocumentArtifactIds(itemId: string): {
  researchArtifactId: number | null;
  prdArtifactId: number | null;
  architectureArtifactId: number | null;
  figmaArtifactId: number | null;
  ticketArtifactId: number | null;
  testArtifactIds: number[];
} {
  const latestOfType = (types: string[]): number | null => {
    const row = db.prepare(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type IN (${types.map(() => '?').join(',')})
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId, ...types) as { id: number } | undefined;
    return row?.id ?? null;
  };

  const qaCheckpointRows = db.prepare(`
    SELECT c.stage, c.artifact_id, c.created_at
    FROM checkpoints c
    JOIN workflows w ON w.id = c.workflow_id
    WHERE w.item_id = ? AND c.status = 'approved' AND c.artifact_id IS NOT NULL
  `).all(itemId) as Array<{ stage: string; artifact_id: number; created_at: number }>;

  const latestQaPerFeature = new Map<string, { artifact_id: number; created_at: number }>();
  for (const row of qaCheckpointRows) {
    const match = /^story_decomposition_F(\d+)_qa$/.exec(row.stage);
    if (!match) continue;
    const existing = latestQaPerFeature.get(match[1]);
    if (!existing || row.created_at > existing.created_at) latestQaPerFeature.set(match[1], row);
  }

  return {
    researchArtifactId: latestOfType(['analyst', 'research']),
    prdArtifactId: latestOfType(['prd']),
    architectureArtifactId: latestOfType(['architecture']),
    figmaArtifactId: latestOfType(['figma_design']),
    ticketArtifactId: latestOfType(['backlog']),
    testArtifactIds: Array.from(latestQaPerFeature.values()).map(r => r.artifact_id),
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
export function getCompletedItemOrUndefined(itemId: string): CandidateRow | undefined {
  const item = getCandidateItem(itemId);
  if (!item) return undefined;
  const workflowInfoByItem = getLatestWorkflowInfo([item.id]);
  const completed = filterCompleted([item], workflowInfoByItem)[0];
  return completed && withDisplayTitle(completed, workflowInfoByItem);
}

/**
 * GET /api/completed-initiatives
 * List every completed, ADO-pushed initiative with rollup counts and state buckets.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const candidates = getCandidateItems();
    const workflowInfoByItem = getLatestWorkflowInfo(candidates.map(c => c.id));
    const completedItems = filterCompleted(candidates, workflowInfoByItem)
      .map(c => withDisplayTitle(c, workflowInfoByItem));
    if (completedItems.length === 0) return res.json([]);

    const itemIds = completedItems.map(c => c.id);
    const workItemRowsByItem = getWorkItemRowsByItem(itemIds);
    const testPlanRowsByItem = getTestPlanRowsByItem(itemIds);

    const summaries: CompletedInitiativeSummary[] = completedItems.map(c =>
      buildSummary(c.id, c.seq_num, c.title, workItemRowsByItem.get(c.id) ?? [], testPlanRowsByItem.get(c.id) ?? [])
    );
    res.json(summaries);
  } catch (error: any) {
    logger.error('Failed to list completed initiatives', error);
    res.status(500).json({ error: error.message || 'Failed to list completed initiatives' });
  }
});

/**
 * GET /api/completed-initiatives/:itemId
 * Cached drill-down — full work item + test plan rows. No ADO call.
 */
router.get('/:itemId', (req: Request, res: Response) => {
  try {
    const item = getCompletedItemOrUndefined(req.params.itemId);
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
    const item = getCompletedItemOrUndefined(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Completed initiative not found' });
    const { refreshed, notFound } = await refreshItemAdoState(item.id);
    res.json({ ...buildDetail(item), refreshed, notFound });
  } catch (error: any) {
    logger.error('Failed to refresh ADO state', error);
    res.status(500).json({ error: error.message || 'Failed to refresh ADO state' });
  }
});

export default router;
