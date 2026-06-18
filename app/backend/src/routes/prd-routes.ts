import { Router, Request, Response } from 'express';
import { AirtableClient } from '../integrations/airtable';
import { appConfig } from '../config/app-config';
import db from '../data/database';
import Logger from '../utils/logger';
import type { AirtableItem } from '@pap/shared';

const logger = new Logger('PRD-ROUTES');
const router = Router();

let airtableClient: AirtableClient;

function getAirtableClient() {
  if (!airtableClient) {
    airtableClient = new AirtableClient();
  }
  return airtableClient;
}

const upsertAirtableItem = db.prepare(`
  INSERT INTO items (id, type, title, description, status, source, airtable_id, metadata, created_at, updated_at)
  VALUES (?, 'initiative', ?, ?, 'active', 'airtable', ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title       = excluded.title,
    description = excluded.description,
    status      = 'active',
    metadata    = excluded.metadata,
    updated_at  = excluded.updated_at
`);

const archiveItem = db.prepare(`UPDATE items SET status = 'archived', updated_at = ? WHERE id = ?`);

/**
 * GET /api/prd/items/pipelineReady
 * Fetch Airtable items where Pipeline Ready = Yes, upsert them into the local DB, and return enriched list.
 */
router.get('/items/pipelineReady', async (req: Request, res: Response) => {
  if (appConfig.integrations.roadmap !== 'airtable') {
    return res.json([]);
  }
  try {
    const client = getAirtableClient();
    const items = await client.getItemsPipelineReady();

    // Persist/refresh all synced items in the local DB
    const now = Date.now();
    const upsertMany = db.transaction((rows: AirtableItem[]) => {
      for (const item of rows) {
        const { id, initiative, description, ...rest } = item;
        upsertAirtableItem.run(id, initiative, description ?? null, id, JSON.stringify(rest), now, now);
      }
    });
    if (items.length > 0) upsertMany(items);

    // Also refresh metadata for existing airtable items not in the pipeline-ready set,
    // and archive any whose Airtable record has been deleted — Airtable is the source
    // of truth for whether an initiative should exist here.
    if (!appConfig.server.useMockData) {
      const pipelineReadyIds = new Set(items.map(i => i.id));
      const existingIds = (db.prepare(`SELECT id FROM items WHERE source = 'airtable' AND status != 'archived'`).all() as { id: string }[])
        .map(r => r.id)
        .filter(id => !pipelineReadyIds.has(id));
      if (existingIds.length > 0) {
        const formula = `OR(${existingIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
        try {
          const refreshed = await client.listItems(formula);
          if (refreshed.length > 0) upsertMany(refreshed);

          // Anything Airtable no longer returned for these record IDs was deleted there.
          const refreshedIds = new Set(refreshed.map(i => i.id));
          const missingIds = existingIds.filter(id => !refreshedIds.has(id));
          if (missingIds.length > 0) {
            // Don't yank an initiative out from under a reviewer mid-workflow —
            // skip archiving while it has an active or in-progress workflow.
            const activeItemIds = new Set(
              (db.prepare(`
                SELECT DISTINCT item_id FROM workflows
                WHERE item_id IN (${missingIds.map(() => '?').join(',')})
                  AND status IN ('active', 'paused_at_checkpoint')
              `).all(...missingIds) as { item_id: string }[]).map(r => r.item_id)
            );
            const archivedAt = Date.now();
            for (const id of missingIds) {
              if (activeItemIds.has(id)) {
                logger.warn(`[AIRTABLE SYNC] Item ${id} deleted in Airtable but has an active workflow — skipping archive`);
                continue;
              }
              archiveItem.run(archivedAt, id);
              logger.info(`[AIRTABLE SYNC] Item ${id} deleted in Airtable — archived locally`);
            }
          }
        } catch { /* non-fatal — pipeline-ready items still synced */ }
      }
    }

    // Enrich with workflow info
    if (items.length > 0) {
      const wfRows = db.prepare(`
        SELECT w.item_id, w.id, w.status, w.current_stage, w.summary
        FROM workflows w
        INNER JOIN (
          SELECT item_id, MAX(created_at) as max_created
          FROM workflows GROUP BY item_id
        ) latest ON w.item_id = latest.item_id AND w.created_at = latest.max_created
        WHERE w.item_id IN (${items.map(() => '?').join(',')})
      `).all(...items.map(i => i.id)) as { item_id: string; id: string; status: string; current_stage: string | null; summary: string | null }[];

      const wfMap = new Map(wfRows.map(wf => [wf.item_id, wf]));
      const enriched = items.map(item => {
        const wf = wfMap.get(item.id);
        return wf
          ? { ...item, workflow: { id: wf.id, status: wf.status, currentStage: wf.current_stage, summary: wf.summary } }
          : item;
      });
      return res.json(enriched);
    }

    res.json(items);
  } catch (error: any) {
    logger.error('Failed to get pipeline ready items', error);
    res.status(500).json({ error: error.message || 'Failed to get items' });
  }
});

export default router;
