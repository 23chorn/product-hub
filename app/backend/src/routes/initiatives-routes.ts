import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../data/database';
import Logger from '../utils/logger';
import type { AirtableItem, LocalInitiative } from '@pap/shared';

const logger = new Logger('INITIATIVES');
const router = Router();

interface InitiativeRow {
  id: string;
  title: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

function toAirtableItem(row: InitiativeRow): AirtableItem {
  return {
    id: row.id,
    initiative: row.title,
    description: row.description ?? '',
    status: 'Ready',
    businessValue: 5,
    priorityScore: 5,
    estimate: 'M',
    confidence: 0.8,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toLocalInitiative(row: InitiativeRow): LocalInitiative {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const stmts = {
  list: db.prepare(
    `SELECT id, title, description, created_at, updated_at FROM items
     WHERE source = 'local' ORDER BY created_at DESC`
  ),
  get: db.prepare(
    `SELECT id, title, description, created_at, updated_at FROM items
     WHERE id = ? AND source = 'local'`
  ),
  insert: db.prepare(
    `INSERT INTO items (id, type, title, description, status, source, airtable_id, created_at, updated_at)
     VALUES (?, 'initiative', ?, ?, 'active', 'local', NULL, ?, ?)`
  ),
  update: db.prepare(
    `UPDATE items SET title = ?, description = ?, updated_at = ?
     WHERE id = ? AND source = 'local'`
  ),
  delete: db.prepare(
    `DELETE FROM items WHERE id = ? AND source = 'local'`
  ),
  getSessions: db.prepare(
    `SELECT id FROM sessions WHERE item_id = ?`
  ),
};

/**
 * GET /api/initiatives
 * List all local initiatives enriched with latest workflow status.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = stmts.list.all() as InitiativeRow[];

    // Batch-fetch latest workflow per item
    const workflowMap = new Map<string, { id: string; status: string; current_stage: string | null; summary: string | null }>();
    const wfRows = db.prepare(`
      SELECT w.item_id, w.id, w.status, w.current_stage, w.summary
      FROM workflows w
      INNER JOIN (
        SELECT item_id, MAX(created_at) as max_created
        FROM workflows GROUP BY item_id
      ) latest ON w.item_id = latest.item_id AND w.created_at = latest.max_created
      WHERE w.item_id IN (${rows.map(() => '?').join(',')})
    `).all(...rows.map(r => r.id)) as { item_id: string; id: string; status: string; current_stage: string | null; summary: string | null }[];
    for (const wf of wfRows) workflowMap.set(wf.item_id, wf);

    const items = rows.map(r => {
      const wf = workflowMap.get(r.id);
      return {
        ...toAirtableItem(r),
        workflow: wf ? { id: wf.id, status: wf.status, currentStage: wf.current_stage, summary: wf.summary } : undefined,
      };
    });

    res.json(items);
  } catch (error: any) {
    logger.error('Failed to list initiatives', error);
    res.status(500).json({ error: error.message || 'Failed to list initiatives' });
  }
});

/**
 * GET /api/initiatives/:id
 * Get a single local initiative.
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const row = stmts.get.get(req.params.id) as InitiativeRow | undefined;
    if (!row) return res.status(404).json({ error: 'Initiative not found' });
    res.json(toLocalInitiative(row));
  } catch (error: any) {
    logger.error('Failed to get initiative', error);
    res.status(500).json({ error: error.message || 'Failed to get initiative' });
  }
});

/**
 * POST /api/initiatives
 * Create a new local initiative.
 * Body: { title: string, description?: string }
 */
router.post('/', (req: Request, res: Response) => {
  const { title, description } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const id = uuidv4();
    const now = Date.now();
    stmts.insert.run(id, title.trim(), description?.trim() || null, now, now);
    const row = stmts.get.get(id) as InitiativeRow;
    logger.info(`Created local initiative: ${id} ("${title.trim()}")`);
    res.status(201).json(toLocalInitiative(row));
  } catch (error: any) {
    logger.error('Failed to create initiative', error);
    res.status(500).json({ error: error.message || 'Failed to create initiative' });
  }
});

/**
 * PATCH /api/initiatives/:id
 * Update title and/or description.
 * Body: { title?: string, description?: string }
 */
router.patch('/:id', (req: Request, res: Response) => {
  const row = stmts.get.get(req.params.id) as InitiativeRow | undefined;
  if (!row) return res.status(404).json({ error: 'Initiative not found' });

  const title = req.body.title !== undefined ? req.body.title.trim() : row.title;
  const description = req.body.description !== undefined
    ? (req.body.description.trim() || null)
    : row.description;

  if (!title) return res.status(400).json({ error: 'title cannot be empty' });

  try {
    const now = Date.now();
    stmts.update.run(title, description, now, req.params.id);
    const updated = stmts.get.get(req.params.id) as InitiativeRow;
    res.json(toLocalInitiative(updated));
  } catch (error: any) {
    logger.error('Failed to update initiative', error);
    res.status(500).json({ error: error.message || 'Failed to update initiative' });
  }
});

/**
 * DELETE /api/initiatives/:id
 * Delete a local initiative and all associated sessions/workflows/files.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const row = stmts.get.get(id) as InitiativeRow | undefined;
  if (!row) return res.status(404).json({ error: 'Initiative not found' });

  try {
    const sessions = stmts.getSessions.all(id) as { id: string }[];

    // Delete session directory from disk
    const fs = await import('fs');
    const path = await import('path');
    const DATA_DIR = (await import('../data/database')).DATA_DIR;
    const sessionDir = path.join(DATA_DIR, 'sessions', id);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    // Delete in FK-safe order within a transaction:
    // context_diffs → checkpoints → workflows → sessions (messages/artifacts cascade) → item
    db.transaction(() => {
      db.prepare(`DELETE FROM context_diffs WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      db.prepare(`DELETE FROM checkpoints WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      db.prepare(`DELETE FROM workflows WHERE item_id = ?`).run(id);
      db.prepare(`DELETE FROM sessions WHERE item_id = ?`).run(id);
      stmts.delete.run(id);
    })();

    logger.info(`Deleted local initiative ${id} with ${sessions.length} session(s)`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete initiative', error);
    res.status(500).json({ error: error.message || 'Failed to delete initiative' });
  }
});

export default router;
