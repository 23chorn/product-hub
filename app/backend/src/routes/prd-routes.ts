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
    res.json(items);
  } catch (error: any) {
    logger.error('Failed to get items needing PRD', error);
    res.status(500).json({ error: error.message || 'Failed to get items' });
  }
});

export default router;
