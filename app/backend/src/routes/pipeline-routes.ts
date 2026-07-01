/**
 * pipeline-routes — write operations supporting the @xcube/pipeline CLI.
 * Mounted at /api/dev/initiatives alongside dev-tickets-routes (read-only).
 */
import { Router, Request, Response } from 'express';
import db from '../data/database';
import Logger from '../utils/logger';
import { getAzureDevOpsClient } from '../integrations/azure-devops';
import { findInitiativeBySeqNum } from './dev-tickets-routes';
import { getWorkItemRowsByItem } from '../data/work-item-queries';

const logger = new Logger('PIPELINE');
const router = Router();

/**
 * PATCH /api/dev/initiatives/:seqNum/tickets/state
 * Bulk-transition ADO tickets to a new state. Used by the @xcube/pipeline CLI
 * to move tickets from New → In Dev when a developer picks them up.
 *
 * Body: { adoIds: number[], state: string }
 * Returns: { updated: number[], failed: Array<{ adoId: number, error: string }> }
 */
router.patch('/:seqNum/tickets/state', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const { adoIds, state } = req.body as { adoIds: unknown; state: unknown };
  if (!Array.isArray(adoIds) || adoIds.length === 0) {
    res.status(400).json({ error: 'body.adoIds must be a non-empty array of integers' });
    return;
  }
  if (typeof state !== 'string' || !state.trim()) {
    res.status(400).json({ error: 'body.state must be a non-empty string matching the ADO state name' });
    return;
  }

  const idList = (adoIds as unknown[]).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (idList.length === 0) {
    res.status(400).json({ error: 'adoIds contained no valid positive integers' });
    return;
  }

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  const workItemRows = getWorkItemRowsByItem([initiative.id]).get(initiative.id) ?? [];
  const allowedIds = new Set(workItemRows.map(r => r.ado_id));
  const unauthorized = idList.filter(id => !allowedIds.has(id));
  if (unauthorized.length > 0) {
    res.status(403).json({ error: `ADO IDs not associated with initiative #${seqNum}: ${unauthorized.join(', ')}` });
    return;
  }

  const ado = getAzureDevOpsClient();
  const updated: number[] = [];
  const failed: Array<{ adoId: number; error: string }> = [];

  await Promise.allSettled(
    idList.map(async adoId => {
      try {
        await ado.updateWorkItem(adoId, { state: state.trim() });
        updated.push(adoId);
      } catch (err: any) {
        failed.push({ adoId, error: err.message ?? 'Unknown error' });
      }
    })
  );

  logger.info(`Initiative #${seqNum}: moved ${updated.length} ticket(s) to "${state}"${failed.length > 0 ? `, ${failed.length} failed` : ''}`);
  res.json({ updated, failed });
});

/**
 * POST /api/dev/initiatives/:seqNum/sync-from-ado
 * Re-sync the local ado_work_item_map from the live ADO hierarchy.
 *
 * Provide the ADO epic URL (or just the numeric epic ID) and the server will:
 *   1. Fetch the epic + its features + each feature's stories from ADO
 *   2. Match each ADO item to a local row by title (case-insensitive)
 *   3. Update ado_id, ado_url, and title for every matched row
 *   4. Delete local rows whose ADO item no longer exists (title unmatched
 *      AND previously-stored ado_id is absent from the ADO hierarchy)
 *   5. Return a summary of what changed
 *
 * Body: { epicUrl: string }  — accepts the full ADO work-item URL or a bare integer ID
 * Returns: {
 *   matched: Array<{ localKey, oldAdoId, newAdoId, title }>,
 *   unmatched: { local: Array<{localKey,title}>, ado: Array<{adoId,title,type}> },
 *   removed: number
 * }
 */
router.post('/:seqNum/sync-from-ado', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const { epicUrl } = req.body as { epicUrl?: unknown };
  if (!epicUrl || typeof epicUrl !== 'string') {
    res.status(400).json({ error: 'body.epicUrl is required — provide the ADO work item URL or bare epic ID' });
    return;
  }

  const epicIdMatch = /(\d+)\s*$/.exec(epicUrl.trim());
  if (!epicIdMatch) {
    res.status(400).json({ error: 'Could not parse an ADO work item ID from epicUrl' });
    return;
  }
  const epicId = parseInt(epicIdMatch[1], 10);

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  // Resolve latest workflow for this initiative
  const latestWorkflow = db.prepare<[string], { id: string }>(
    `SELECT id FROM workflows WHERE item_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(initiative.id);
  if (!latestWorkflow) {
    res.status(404).json({ error: `Initiative #${seqNum} has no workflow — push tickets to ADO first` });
    return;
  }

  const localRows = db.prepare<[string], {
    id: number; ado_id: number; ado_type: string; ado_url: string | null; local_key: string; title: string;
  }>(
    `SELECT id, ado_id, ado_type, ado_url, local_key, title FROM ado_work_item_map WHERE workflow_id = ?`
  ).all(latestWorkflow.id);

  try {
    const ado = getAzureDevOpsClient();
    logger.info(`Syncing initiative #${seqNum} from ADO epic ${epicId}`);

    // Step 1: fetch the full hierarchy from ADO
    const { item: epicItem, childIds: featureIds } = await ado.getWorkItemWithChildren(epicId);

    const featureItems: Array<{ item: ReturnType<typeof Object.assign>; childIds: number[] }> = [];
    for (const fid of featureIds) {
      featureItems.push(await ado.getWorkItemWithChildren(fid));
    }

    const storyIds = featureItems.flatMap(f => f.childIds);
    const storyItems = storyIds.length > 0 ? await ado.getWorkItemsBatch(storyIds) : [];
    const storyById = new Map(storyItems.map(s => [s.id!, s]));

    // Build a flat list of all ADO items: [epic, ...features, ...stories]
    const adoItems: Array<{ adoId: number; title: string; type: string; adoUrl: string }> = [
      {
        adoId: epicItem.id!,
        title: String(epicItem.fields['System.Title'] ?? ''),
        type: 'epic',
        adoUrl: ado.getEpicUrl(epicItem.id!),
      },
      ...featureItems.map(({ item }) => ({
        adoId: item.id!,
        title: String(item.fields['System.Title'] ?? ''),
        type: 'feature',
        adoUrl: ado.getEpicUrl(item.id!),
      })),
      ...storyItems.map(s => ({
        adoId: s.id!,
        title: String(s.fields['System.Title'] ?? ''),
        type: 'story',
        adoUrl: ado.getEpicUrl(s.id!),
      })),
    ];

    const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

    // Step 2: match ADO items to local rows by normalised title + type
    const localByTypeAndTitle = new Map<string, typeof localRows[number]>();
    for (const row of localRows) {
      localByTypeAndTitle.set(`${row.ado_type}|${normalize(row.title)}`, row);
    }

    const matched: Array<{ localKey: string; oldAdoId: number; newAdoId: number; title: string }> = [];
    const unmatchedAdo: Array<{ adoId: number; title: string; type: string }> = [];
    const matchedLocalIds = new Set<number>();

    for (const adoItem of adoItems) {
      const key = `${adoItem.type}|${normalize(adoItem.title)}`;
      const localRow = localByTypeAndTitle.get(key);
      if (localRow) {
        matched.push({ localKey: localRow.local_key, oldAdoId: localRow.ado_id, newAdoId: adoItem.adoId, title: adoItem.title });
        matchedLocalIds.add(localRow.id);
      } else {
        unmatchedAdo.push({ adoId: adoItem.adoId, title: adoItem.title, type: adoItem.type });
      }
    }

    const unmatchedLocal = localRows
      .filter(r => !matchedLocalIds.has(r.id))
      .map(r => ({ localKey: r.local_key, title: r.title }));

    // Step 3: write changes in a transaction
    const adoIdsInHierarchy = new Set(adoItems.map(a => a.adoId));
    const updateRow = db.prepare(
      `UPDATE ado_work_item_map SET ado_id = ?, ado_url = ?, title = ?, state = NULL, state_synced_at = NULL WHERE id = ?`
    );
    const deleteRow = db.prepare(`DELETE FROM ado_work_item_map WHERE id = ?`);

    let removed = 0;
    db.transaction(() => {
      for (const m of matched) {
        const localRow = localRows.find(r => r.local_key === m.localKey)!;
        const adoItem = adoItems.find(a => a.adoId === m.newAdoId)!;
        updateRow.run(m.newAdoId, adoItem.adoUrl, m.title, localRow.id);
      }
      // Remove local rows whose stored ado_id is not anywhere in the current ADO hierarchy
      // AND which were not matched to a current ADO item — i.e. genuinely deleted
      for (const row of localRows) {
        if (!matchedLocalIds.has(row.id) && !adoIdsInHierarchy.has(row.ado_id)) {
          deleteRow.run(row.id);
          removed++;
        }
      }
    })();

    logger.info(`Initiative #${seqNum} ADO sync: ${matched.length} matched, ${unmatchedLocal.length} local unmatched, ${unmatchedAdo.length} ADO unmatched, ${removed} removed`);

    res.json({
      matched,
      unmatched: { local: unmatchedLocal, ado: unmatchedAdo },
      removed,
    });
  } catch (err: any) {
    logger.error(`ADO sync failed for initiative #${seqNum}`, err);
    res.status(500).json({ error: err.message ?? 'ADO sync failed' });
  }
});

/**
 * GET /api/dev/initiatives/:seqNum/ado-workflows
 * Lists every workflow for this initiative that has ADO work-item rows, grouped
 * so you can see which pipeline run produced which epics. Useful for identifying
 * stale rows from old runs when an initiative has been pushed to ADO more than once.
 *
 * Returns: Array<{
 *   workflowId, createdAt, status,
 *   epicCount, featureCount, storyCount,
 *   epics: Array<{ adoId, title, adoUrl }>
 * }>
 */
router.get('/:seqNum/ado-workflows', (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  const workflowRows = db.prepare<[string], {
    workflow_id: string; created_at: number; status: string;
    epic_count: number; feature_count: number; story_count: number;
  }>(`
    SELECT w.id as workflow_id, w.created_at, w.status,
           SUM(CASE WHEN m.ado_type = 'epic'    THEN 1 ELSE 0 END) as epic_count,
           SUM(CASE WHEN m.ado_type = 'feature' THEN 1 ELSE 0 END) as feature_count,
           SUM(CASE WHEN m.ado_type = 'story'   THEN 1 ELSE 0 END) as story_count
    FROM workflows w
    JOIN ado_work_item_map m ON m.workflow_id = w.id
    WHERE w.item_id = ?
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `).all(initiative.id);

  const result = workflowRows.map(wf => {
    const epics = db.prepare<[string], { ado_id: number; title: string; ado_url: string | null }>(
      `SELECT ado_id, title, ado_url FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'epic'`
    ).all(wf.workflow_id);
    return {
      workflowId: wf.workflow_id,
      createdAt: new Date(wf.created_at).toISOString(),
      status: wf.status,
      epicCount: wf.epic_count,
      featureCount: wf.feature_count,
      storyCount: wf.story_count,
      epics,
    };
  });

  res.json(result);
});

/**
 * DELETE /api/dev/initiatives/:seqNum/ado-workflows/:workflowId
 * Removes all ado_work_item_map rows for a specific workflow run, cleaning up
 * stale/duplicate entries from old pipeline runs on the progress tracker.
 * Only works for workflows belonging to the specified initiative.
 *
 * Returns: { deleted: number }
 */
router.delete('/:seqNum/ado-workflows/:workflowId', (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  const workflowId = req.params.workflowId;
  const wf = db.prepare<[string, string], { id: string }>(
    `SELECT id FROM workflows WHERE id = ? AND item_id = ?`
  ).get(workflowId, initiative.id);
  if (!wf) {
    res.status(404).json({ error: `Workflow ${workflowId} not found for initiative #${seqNum}` });
    return;
  }

  const result = db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ?`).run(workflowId);
  logger.info(`Removed ${result.changes} ADO work item rows from workflow ${workflowId} (initiative #${seqNum})`);
  res.json({ deleted: result.changes });
});

export default router;
