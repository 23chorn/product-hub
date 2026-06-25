import { Router, Response } from 'express';
import db from '../data/database';
import { requireAdmin } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { syncSwaggerDoc } from '../integrations/swagger-sync';
import Logger from '../utils/logger';

const logger = new Logger('SWAGGER-ROUTES');

export const swaggerRouter = Router();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function toListItem(row: any) {
  return {
    id: row.id,
    label: row.label,
    docUrl: row.doc_url,
    active: Boolean(row.active),
    specTitle: row.spec_title,
    specVersion: row.spec_version,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
  };
}

const LIST_COLUMNS = `id, label, doc_url, active, spec_title, spec_version, last_synced_at, last_sync_error, created_at`;

swaggerRouter.get('/', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare(`SELECT ${LIST_COLUMNS} FROM swagger_api_docs ORDER BY label COLLATE NOCASE`).all() as any[];
  res.json({ docs: rows.map(toListItem) });
});

swaggerRouter.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { label, docUrl } = req.body ?? {};
  if (typeof label !== 'string' || !label.trim() || typeof docUrl !== 'string' || !docUrl.trim()) {
    res.status(400).json({ error: 'label and docUrl are required' });
    return;
  }
  if (!isHttpUrl(docUrl.trim())) {
    res.status(400).json({ error: 'docUrl must be a valid http(s) URL' });
    return;
  }

  const now = Date.now();
  let docId: number;
  try {
    const result = db.prepare(`
      INSERT INTO swagger_api_docs (label, doc_url, active, created_by_user_id, created_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(label.trim(), docUrl.trim(), req.user?.id ?? null, now);
    docId = result.lastInsertRowid as number;
  } catch {
    res.status(409).json({ error: 'That URL is already linked' });
    return;
  }

  let syncWarning: string | undefined;
  try {
    await syncSwaggerDoc({ id: docId, doc_url: docUrl.trim() });
  } catch (err: any) {
    logger.error(`Initial sync failed for ${docUrl}: ${err.message}`);
    syncWarning = `Doc added, but the first sync failed: ${err.message}`;
  }

  const row = db.prepare(`SELECT ${LIST_COLUMNS} FROM swagger_api_docs WHERE id = ?`).get(docId) as any;
  res.json({ doc: toListItem(row), syncWarning });
});

swaggerRouter.patch('/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { label, active } = req.body ?? {};

  const sets: string[] = [];
  const params: any[] = [];
  if (label !== undefined) {
    if (typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label must be a non-empty string' });
      return;
    }
    sets.push('label = ?');
    params.push(label.trim());
  }
  if (active !== undefined) {
    sets.push('active = ?');
    params.push(active ? 1 : 0);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const result = db.prepare(`UPDATE swagger_api_docs SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Doc not found' });
    return;
  }

  const row = db.prepare(`SELECT ${LIST_COLUMNS} FROM swagger_api_docs WHERE id = ?`).get(id) as any;
  res.json({ doc: toListItem(row) });
});

swaggerRouter.delete('/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM swagger_api_docs WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Doc not found' });
    return;
  }
  res.json({ ok: true });
});

swaggerRouter.post('/:id/sync', requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const doc = db.prepare('SELECT id, doc_url FROM swagger_api_docs WHERE id = ?').get(id) as { id: number; doc_url: string } | undefined;
  if (!doc) {
    res.status(404).json({ error: 'Doc not found' });
    return;
  }

  try {
    await syncSwaggerDoc(doc);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
    return;
  }

  const row = db.prepare(`SELECT ${LIST_COLUMNS} FROM swagger_api_docs WHERE id = ?`).get(id) as any;
  res.json({ doc: toListItem(row) });
});
