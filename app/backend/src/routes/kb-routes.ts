import { Router, Response } from 'express';
import db from '../data/database';
import { requireAdmin, isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { AzureDevOpsClient } from '../integrations/azure-devops';
import { syncRepo, type KbRepoRow } from '../integrations/kb-sync';
import { runDocReview } from '../agents/kb-reviewer-agent';
import { computeRevisionDiff } from '../utils/revision-diff';
import Logger from '../utils/logger';

const logger = new Logger('KB-ROUTES');

export const kbRouter = Router();

function canEdit(req: AuthRequest): boolean {
  return !isViewOnly(req.user);
}

// ── Repos ──────────────────────────────────────────────────────────────────────

function toRepoListItem(r: any) {
  return {
    id: r.id,
    label: r.label,
    repository: r.repository,
    branch: r.branch,
    project: r.project,
    fileCount: r.file_count,
    lastSyncedAt: r.last_synced_at,
    createdAt: r.created_at,
  };
}

kbRouter.get('/repos', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare(`
    SELECT r.id, r.label, r.repository, r.branch, r.project, r.last_synced_at, r.created_at,
      (SELECT COUNT(*) FROM kb_files f WHERE f.repo_id = r.id) AS file_count
    FROM kb_repos r
    ORDER BY r.label COLLATE NOCASE
  `).all() as any[];

  res.json({ repos: rows.map(toRepoListItem) });
});

kbRouter.post('/repos', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { label, repository, branch, project } = req.body ?? {};
  if (typeof label !== 'string' || !label.trim() || typeof repository !== 'string' || !repository.trim()) {
    res.status(400).json({ error: 'label and repository are required' });
    return;
  }
  const projectOverride = typeof project === 'string' && project.trim() ? project.trim() : undefined;

  const client = new AzureDevOpsClient();
  let adoRepos;
  try {
    adoRepos = await client.listAdoRepositories(projectOverride);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach Azure DevOps: ${err.message}` });
    return;
  }
  const match = adoRepos.find((r) => r.name.toLowerCase() === repository.trim().toLowerCase());
  if (!match) {
    res.status(400).json({ error: `No repository named "${repository.trim()}" found in ${projectOverride ? `project "${projectOverride}"` : 'the configured Azure DevOps project'}` });
    return;
  }

  const now = Date.now();
  let repoId: number;
  try {
    const result = db.prepare(`
      INSERT INTO kb_repos (label, repository, branch, project, created_by_user_id, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run(label.trim(), match.name, branch?.trim() || null, projectOverride ?? null, req.user?.id ?? null, now);
    repoId = result.lastInsertRowid as number;
  } catch (err: any) {
    res.status(409).json({ error: `"${match.name}" is already tracked` });
    return;
  }

  let syncWarning: string | undefined;
  try {
    await syncRepo({ id: repoId, repository: match.name, branch: branch?.trim() || null, project: projectOverride ?? null });
  } catch (err: any) {
    logger.error(`Initial sync failed for ${match.name}: ${err.message}`);
    syncWarning = `Repo added, but the first sync failed: ${err.message}`;
  }

  const repoRow = db.prepare(`
    SELECT r.id, r.label, r.repository, r.branch, r.project, r.last_synced_at, r.created_at,
      (SELECT COUNT(*) FROM kb_files f WHERE f.repo_id = r.id) AS file_count
    FROM kb_repos r WHERE r.id = ?
  `).get(repoId) as any;
  res.json({ repo: toRepoListItem(repoRow), syncWarning });
});

kbRouter.patch('/repos/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { label, branch, project } = req.body ?? {};

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
  if (branch !== undefined) {
    sets.push('branch = ?');
    params.push(typeof branch === 'string' && branch.trim() ? branch.trim() : null);
  }
  if (project !== undefined) {
    sets.push('project = ?');
    params.push(typeof project === 'string' && project.trim() ? project.trim() : null);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const result = db.prepare(`UPDATE kb_repos SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  const repoRow = db.prepare(`
    SELECT r.id, r.label, r.repository, r.branch, r.project, r.last_synced_at, r.created_at,
      (SELECT COUNT(*) FROM kb_files f WHERE f.repo_id = r.id) AS file_count
    FROM kb_repos r WHERE r.id = ?
  `).get(id) as any;
  res.json({ repo: toRepoListItem(repoRow) });
});

kbRouter.delete('/repos/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM kb_repos WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }
  res.json({ ok: true });
});

kbRouter.post('/repos/:id/sync', async (req: AuthRequest, res: Response) => {
  if (!canEdit(req)) {
    res.status(403).json({ error: 'You do not have permission to sync repos', code: 'INSUFFICIENT_ROLE' });
    return;
  }
  const id = Number(req.params.id);
  const repo = db.prepare('SELECT id, repository, branch, project FROM kb_repos WHERE id = ?').get(id) as KbRepoRow | undefined;
  if (!repo) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  try {
    const result = await syncRepo(repo);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: `Sync failed: ${err.message}` });
  }
});

// ── Files ──────────────────────────────────────────────────────────────────────

function toFileListItem(row: any) {
  return {
    id: row.id,
    repoId: row.repo_id,
    repoLabel: row.repo_label,
    path: row.path,
    frontmatterFileName: row.frontmatter_file_name,
    frontmatterOwner: row.frontmatter_owner,
    frontmatterStatus: row.frontmatter_status,
    frontmatterValid: Boolean(row.frontmatter_valid),
    openCommentCount: row.open_comment_count,
    lastSyncedAt: row.last_synced_at,
  };
}

kbRouter.get('/files', (req: AuthRequest, res: Response) => {
  const { repoId, owner, status, invalidFrontmatterOnly } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];

  if (repoId) { conditions.push('f.repo_id = ?'); params.push(Number(repoId)); }
  if (owner) { conditions.push('f.frontmatter_owner = ?'); params.push(String(owner)); }
  if (status) { conditions.push('f.frontmatter_status = ?'); params.push(String(status)); }
  if (invalidFrontmatterOnly === 'true') { conditions.push('f.frontmatter_valid = 0'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT f.id, f.repo_id, r.label AS repo_label, f.path, f.frontmatter_file_name, f.frontmatter_owner,
      f.frontmatter_status, f.frontmatter_valid, f.last_synced_at,
      (SELECT COUNT(*) FROM kb_comments c WHERE c.file_id = f.id AND c.status = 'open') AS open_comment_count
    FROM kb_files f
    JOIN kb_repos r ON r.id = f.repo_id
    ${where}
    ORDER BY r.label COLLATE NOCASE, f.path COLLATE NOCASE
  `).all(...params) as any[];

  res.json({ files: rows.map(toFileListItem) });
});

kbRouter.get('/files/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT f.*, r.label AS repo_label
    FROM kb_files f
    JOIN kb_repos r ON r.id = f.repo_id
    WHERE f.id = ?
  `).get(id) as any;
  if (!row) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const comments = db.prepare('SELECT * FROM kb_comments WHERE file_id = ? ORDER BY created_at ASC').all(id) as any[];

  res.json({
    file: {
      ...toFileListItem(row),
      content: row.content,
      commitId: row.commit_id,
    },
    comments: comments.map(toComment),
  });
});

kbRouter.post('/files/:id/review', async (req: AuthRequest, res: Response) => {
  if (!canEdit(req)) {
    res.status(403).json({ error: 'You do not have permission to run AI review', code: 'INSUFFICIENT_ROLE' });
    return;
  }
  const id = Number(req.params.id);
  const file = db.prepare(`
    SELECT f.path, f.content, r.label AS repo_label
    FROM kb_files f JOIN kb_repos r ON r.id = f.repo_id
    WHERE f.id = ?
  `).get(id) as any;
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  let suggestions;
  try {
    suggestions = await runDocReview({ path: file.path, content: file.content, repoLabel: file.repo_label });
  } catch (err: any) {
    res.status(502).json({ error: `AI review failed: ${err.message}` });
    return;
  }

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO kb_comments (file_id, source, author_user_id, author_name, body, quote, status, created_at)
    VALUES (?, 'agent', NULL, 'Cass (AI Reviewer)', ?, ?, 'open', ?)
  `);
  const inserted = suggestions.map((s) => {
    const body = s.severity === 'major' ? `[major] ${s.comment}` : s.comment;
    const result = insert.run(id, body, s.quote ?? null, now);
    return { id: result.lastInsertRowid as number, body, quote: s.quote ?? null };
  });

  res.json({
    comments: inserted.map((c) => ({
      id: c.id, fileId: id, source: 'agent' as const, authorName: 'Cass (AI Reviewer)',
      body: c.body, quote: c.quote, status: 'open' as const, createdAt: now, resolvedAt: null,
    })),
  });
});

// ── History / diffs (live from Azure DevOps — not cached locally) ──────────────

function loadFileRepoInfo(id: number): { path: string; repository: string; branch: string | null; project: string | null } | undefined {
  return db.prepare(`
    SELECT f.path, r.repository, r.branch, r.project
    FROM kb_files f JOIN kb_repos r ON r.id = f.repo_id
    WHERE f.id = ?
  `).get(id) as any;
}

kbRouter.get('/files/:id/history', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const info = loadFileRepoInfo(id);
  if (!info) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    const client = new AzureDevOpsClient();
    const commits = await client.listAdoFileCommits(info.repository, info.path, info.branch ?? undefined, info.project ?? undefined);
    res.json({ commits });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to load history: ${err.message}` });
  }
});

kbRouter.get('/files/:id/diff', async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { from, to } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string') {
    res.status(400).json({ error: 'from and to commit ids are required' });
    return;
  }

  const info = loadFileRepoInfo(id);
  if (!info) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    const client = new AzureDevOpsClient();
    const [fromContent, toContent] = await Promise.all([
      client.getAdoFileContentAtCommit(info.repository, info.path, from, info.project ?? undefined),
      client.getAdoFileContentAtCommit(info.repository, info.path, to, info.project ?? undefined),
    ]);
    const diff = computeRevisionDiff(fromContent.content, toContent.content, info.path);
    res.json({ diff, from, to });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to load diff: ${err.message}` });
  }
});

// ── Comments ───────────────────────────────────────────────────────────────────

function toComment(row: any) {
  return {
    id: row.id,
    fileId: row.file_id,
    source: row.source,
    authorName: row.author_name,
    body: row.body,
    quote: row.quote,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

kbRouter.post('/files/:id/comments', (req: AuthRequest, res: Response) => {
  if (!canEdit(req)) {
    res.status(403).json({ error: 'You do not have permission to comment', code: 'INSUFFICIENT_ROLE' });
    return;
  }
  const fileId = Number(req.params.id);
  const { body, quote } = req.body ?? {};
  if (typeof body !== 'string' || !body.trim()) {
    res.status(400).json({ error: 'body is required' });
    return;
  }

  const file = db.prepare('SELECT id FROM kb_files WHERE id = ?').get(fileId);
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO kb_comments (file_id, source, author_user_id, author_name, body, quote, status, created_at)
    VALUES (?, 'user', ?, ?, ?, ?, 'open', ?)
  `).run(fileId, req.user?.id ?? null, req.user?.name ?? 'System', body.trim(), quote?.trim() || null, now);

  res.json(toComment({
    id: result.lastInsertRowid as number, file_id: fileId, source: 'user',
    author_name: req.user?.name ?? 'System', body: body.trim(), quote: quote?.trim() || null,
    status: 'open', created_at: now, resolved_at: null,
  }));
});

kbRouter.patch('/comments/:id', (req: AuthRequest, res: Response) => {
  if (!canEdit(req)) {
    res.status(403).json({ error: 'You do not have permission to update comments', code: 'INSUFFICIENT_ROLE' });
    return;
  }
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (status !== 'open' && status !== 'resolved') {
    res.status(400).json({ error: 'status must be "open" or "resolved"' });
    return;
  }

  const now = Date.now();
  const result = status === 'resolved'
    ? db.prepare('UPDATE kb_comments SET status = ?, resolved_at = ?, resolved_by_user_id = ? WHERE id = ?').run(status, now, req.user?.id ?? null, id)
    : db.prepare('UPDATE kb_comments SET status = ?, resolved_at = NULL, resolved_by_user_id = NULL WHERE id = ?').run(status, id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }

  const row = db.prepare('SELECT * FROM kb_comments WHERE id = ?').get(id);
  res.json(toComment(row));
});
