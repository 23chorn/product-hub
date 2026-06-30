import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../data/database';
import Logger from '../utils/logger';
import { requireAdmin } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import type { InitiativeComment } from '@pap/shared';

const logger = new Logger('COMMENTS');
const router = Router();

interface CommentRow {
  id: string;
  item_id: string;
  user_id: string | null;
  author_name: string;
  body: string;
  type: string;
  title: string | null;
  created_at: number;
}

function toComment(row: CommentRow): InitiativeComment {
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id ?? undefined,
    authorName: row.author_name,
    body: row.body,
    type: row.type as InitiativeComment['type'],
    title: row.title ?? undefined,
    createdAt: row.created_at,
  };
}

function resolveAuthorName(req: AuthRequest): string {
  return req.user?.name ?? req.user?.username ?? 'Anonymous';
}

/** GET /api/initiatives/:id/comments — list all comments, oldest first */
router.get('/initiatives/:id/comments', (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare<[string], CommentRow>(
      'SELECT * FROM initiative_comments WHERE item_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);
    res.json(rows.map(toComment));
  } catch (err: any) {
    logger.error('Failed to list comments', err);
    res.status(500).json({ error: err.message || 'Failed to list comments' });
  }
});

/** POST /api/initiatives/:id/comments — add a note or decision comment */
router.post('/initiatives/:id/comments', (req: AuthRequest, res: Response) => {
  const { body, type = 'note', title } = req.body as { body?: string; type?: string; title?: string };
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
  if (!['note', 'decision'].includes(type)) return res.status(400).json({ error: 'type must be note or decision' });
  if (type === 'decision' && !title?.trim()) return res.status(400).json({ error: 'title is required for decision comments' });

  try {
    const id = uuidv4();
    const now = Date.now();
    const authorName = resolveAuthorName(req);
    const userId = req.user ? String(req.user.id) : null;
    db.prepare(
      'INSERT INTO initiative_comments (id, item_id, user_id, author_name, body, type, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.params.id, userId, authorName, body.trim(), type, title?.trim() ?? null, now);
    const row = db.prepare<[string], CommentRow>('SELECT * FROM initiative_comments WHERE id = ?').get(id)!;
    res.status(201).json(toComment(row));
  } catch (err: any) {
    logger.error('Failed to create comment', err);
    res.status(500).json({ error: err.message || 'Failed to create comment' });
  }
});

/** POST /api/initiatives/:id/pause — pause an initiative (admin only) */
router.post('/initiatives/:id/pause', requireAdmin, (req: AuthRequest, res: Response) => {
  const { body } = req.body as { body?: string };
  if (!body?.trim()) return res.status(400).json({ error: 'A reason (body) is required to pause an initiative' });

  try {
    const itemRow = db.prepare<[string], { id: string } | undefined>('SELECT id FROM items WHERE id = ?').get(req.params.id);
    if (!itemRow) return res.status(404).json({ error: 'Initiative not found' });

    const now = Date.now();
    db.prepare('UPDATE items SET is_paused = 1, paused_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);

    const id = uuidv4();
    const authorName = resolveAuthorName(req);
    const userId = req.user ? String(req.user.id) : null;
    db.prepare(
      'INSERT INTO initiative_comments (id, item_id, user_id, author_name, body, type, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.params.id, userId, authorName, body.trim(), 'pause', null, now);

    logger.info(`Initiative ${req.params.id} paused by ${authorName}`);
    res.json({ isPaused: true, pausedAt: now });
  } catch (err: any) {
    logger.error('Failed to pause initiative', err);
    res.status(500).json({ error: err.message || 'Failed to pause initiative' });
  }
});

/** POST /api/initiatives/:id/resume — resume a paused initiative (admin only) */
router.post('/initiatives/:id/resume', requireAdmin, (req: AuthRequest, res: Response) => {
  const { body } = req.body as { body?: string };

  try {
    const itemRow = db.prepare<[string], { id: string } | undefined>('SELECT id FROM items WHERE id = ?').get(req.params.id);
    if (!itemRow) return res.status(404).json({ error: 'Initiative not found' });

    const now = Date.now();
    db.prepare('UPDATE items SET is_paused = 0, paused_at = NULL, updated_at = ? WHERE id = ?').run(now, req.params.id);

    const id = uuidv4();
    const authorName = resolveAuthorName(req);
    const userId = req.user ? String(req.user.id) : null;
    db.prepare(
      'INSERT INTO initiative_comments (id, item_id, user_id, author_name, body, type, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.params.id, userId, authorName, body?.trim() || 'Initiative resumed.', 'resume', null, now);

    logger.info(`Initiative ${req.params.id} resumed by ${authorName}`);
    res.json({ isPaused: false });
  } catch (err: any) {
    logger.error('Failed to resume initiative', err);
    res.status(500).json({ error: err.message || 'Failed to resume initiative' });
  }
});

export { router as commentsRoutes };
