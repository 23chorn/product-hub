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

/**
 * GET /api/prd/items/pipelineReady
 * Get Airtable items where Pipeline Ready = Yes
 */
router.get('/items/pipelineReady', async (req: Request, res: Response) => {
  if (appConfig.integrations.roadmap !== 'airtable') {
    return res.json([]);
  }
  try {
    const client = getAirtableClient();
    const items = await client.getItemsPipelineReady();

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
