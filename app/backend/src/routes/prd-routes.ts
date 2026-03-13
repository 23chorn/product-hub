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
 * GET /api/prd/items/needingPRD
 * Get list of items from Airtable
 */
router.get('/items/needingPRD', async (req: Request, res: Response) => {
  if (appConfig.integrations.roadmap === 'none') {
    // Return local initiatives in AirtableItem shape
    const rows = db.prepare(
      `SELECT id, title, description, created_at FROM items WHERE source = 'local' ORDER BY created_at DESC`
    ).all() as { id: string; title: string; description: string | null; created_at: number }[];
    const items: AirtableItem[] = rows.map(r => ({
      id: r.id,
      initiative: r.title,
      description: r.description ?? '',
      status: 'Ready',
      businessValue: 5,
      priorityScore: 5,
      estimate: 'M',
      confidence: 0.8,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    return res.json(items);
  }
  try {
    const client = getAirtableClient();
    const items = await client.getItemsNeedingPRD();

    // Enrich with latest workflow status per item
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
    logger.error('Failed to get items needing PRD', error);
    res.status(500).json({ error: error.message || 'Failed to get items' });
  }
});

export default router;
