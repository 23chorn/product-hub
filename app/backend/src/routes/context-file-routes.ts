import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import { invalidateContextCache } from '../agents/specialist-agent';
import { clearAllContextCaches } from '../agents/agent-cache';
import db from '../data/database';
import { hasAnyUsers } from '../data/users';
import { isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const logger = new Logger('CONTEXT-FILES');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const CONTEXT_DIR = path.join(PROJECT_ROOT, 'context');

interface CanonicalFile {
  fileName: string;
  label: string;
  description: string;
  hasTemplate: boolean;
  /** Default edit roles when the file has no edit_roles frontmatter. null = anyone can edit. */
  defaultEditRoles: string[] | null;
}

const CANONICAL_FILES: CanonicalFile[] = [
  {
    fileName: 'company.md',
    label: 'Company Overview',
    description: 'Mission, products, target users, market position, business model',
    hasTemplate: true,
    defaultEditRoles: ['product'],
  },
  {
    fileName: 'strategy.md',
    label: 'Product Strategy',
    description: 'North star goal, OKRs, roadmap themes, non-priorities, constraints',
    hasTemplate: true,
    defaultEditRoles: ['product'],
  },
  {
    fileName: 'tech-stack.md',
    label: 'Tech Stack',
    description: 'Frontend, backend, infrastructure, key integrations',
    hasTemplate: true,
    defaultEditRoles: ['tech_lead'],
  },
  {
    fileName: 'db-schema.md',
    label: 'Database Schema',
    description: 'Tables, columns, key relationships',
    hasTemplate: true,
    defaultEditRoles: ['tech_lead'],
  },
  {
    fileName: 'process.md',
    label: 'Development Process',
    description: 'Sprint cadence, definition of ready/done, release process',
    hasTemplate: true,
    defaultEditRoles: null,
  },
  {
    fileName: 'current-state.md',
    label: 'Current State',
    description: 'What is live, active work, known debt, recent decisions',
    hasTemplate: true,
    defaultEditRoles: ['product'],
  },
];

const CANONICAL_FILE_NAMES = new Set(CANONICAL_FILES.map((f) => f.fileName));
const CANONICAL_DEFAULT_EDIT_ROLES = new Map(CANONICAL_FILES.map((f) => [f.fileName, f.defaultEditRoles]));
const SAFE_FILENAME = /^[a-z0-9][a-z0-9-_]*\.md$/;

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Parse stages and edit_roles from YAML frontmatter, falling back to canonical defaults. */
function parseFileFrontmatter(content: string, fileName?: string): { stages: string[] | null; editRoles: string[] | null } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const fm = m?.[1] ?? null;

  const stagesMatch = fm?.match(/^stages:\s*\[([^\]]*)\]/m);
  const stages = stagesMatch ? stagesMatch[1].split(',').map(s => s.trim()).filter(Boolean) : null;

  const editRolesMatch = fm?.match(/^edit_roles:\s*\[([^\]]*)\]/m);
  const editRolesFromFrontmatter = editRolesMatch
    ? editRolesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  // Frontmatter value wins; fall back to the canonical default; then null (unrestricted)
  const editRoles = editRolesFromFrontmatter !== undefined
    ? editRolesFromFrontmatter
    : (fileName ? (CANONICAL_DEFAULT_EDIT_ROLES.get(fileName) ?? null) : null);

  return { stages, editRoles };
}

/** Returns true if the current user is allowed to edit a file with the given edit_roles. */
function canEditFile(user: AuthRequest['user'], editRoles: string[] | null): boolean {
  if (!hasAnyUsers()) return true;
  if (!user) return false;
  if (user.is_admin) return true;
  if (isViewOnly(user)) return false;
  if (editRoles === null) return true;          // no restriction declared
  if (editRoles.length === 0) return false;     // explicitly locked to admins only
  return editRoles.some(r => user.roles.includes(r));
}

function labelFromFileName(fileName: string): string {
  return fileName
    .replace(/\.md$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const contextFileRouter = Router();

/**
 * GET / — canonical context files + any custom .md files in context/
 */
contextFileRouter.get('/', (_req: Request, res: Response) => {
  const files = CANONICAL_FILES.map((cf) => {
    const content = readFileOrEmpty(path.join(CONTEXT_DIR, cf.fileName));
    const templateContent = cf.hasTemplate
      ? readFileOrEmpty(path.join(CONTEXT_DIR, cf.fileName.replace('.md', '.example.md')))
      : undefined;
    const { stages, editRoles } = parseFileFrontmatter(content, cf.fileName);
    return { fileName: cf.fileName, label: cf.label, description: cf.description, hasTemplate: cf.hasTemplate, content, templateContent, stages, editRoles };
  });

  // Append any custom (non-canonical) .md files
  try {
    const entries = fs.readdirSync(CONTEXT_DIR);
    for (const entry of entries.sort()) {
      if (
        !entry.endsWith('.md') ||
        entry.endsWith('.example.md') ||
        entry.toLowerCase() === 'readme.md' ||
        CANONICAL_FILE_NAMES.has(entry)
      ) continue;
      const content = readFileOrEmpty(path.join(CONTEXT_DIR, entry));
      const { stages, editRoles } = parseFileFrontmatter(content, entry);
      files.push({
        fileName: entry,
        label: labelFromFileName(entry),
        description: 'Custom context file',
        hasTemplate: false,
        content,
        templateContent: undefined,
        stages,
        editRoles,
      });
    }
  } catch { /* context dir may not exist yet */ }

  res.json({ files });
});

/**
 * POST / — create a new custom context file
 */
contextFileRouter.post('/', (req: AuthRequest, res: Response) => {
  const { label, description, content } = req.body;
  if (!label || typeof label !== 'string') {
    res.status(400).json({ error: 'label is required' });
    return;
  }

  // New custom files have no edit_roles frontmatter yet, so they're treated as
  // unrestricted (editRoles: null) — view_only is the only role this should block.
  if (!canEditFile(req.user, null)) {
    res.status(403).json({ error: 'You do not have permission to create context files', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  // Derive a safe filename from the label
  const fileName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md';
  if (!SAFE_FILENAME.test(fileName)) {
    res.status(400).json({ error: `Cannot derive a valid filename from label "${label}"` });
    return;
  }

  const filePath = path.join(CONTEXT_DIR, fileName);
  if (fs.existsSync(filePath)) {
    res.status(409).json({ error: `Context file "${fileName}" already exists` });
    return;
  }

  try {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    fs.writeFileSync(filePath, content ?? '', 'utf-8');
    db.prepare('INSERT INTO context_file_versions (file_name, content, created_at) VALUES (?, ?, ?)')
      .run(fileName, content ?? '', Date.now());
    logger.info(`Created context file: ${fileName}`);
    invalidateContextCache();
    clearAllContextCaches();
    res.status(201).json({ ok: true, fileName, label });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /:fileName — save (or delete if empty) a context file
 */
contextFileRouter.put('/:fileName', (req: AuthRequest, res: Response) => {
  const { fileName } = req.params;

  // Allow canonical files and safe custom filenames
  if (!CANONICAL_FILE_NAMES.has(fileName) && !SAFE_FILENAME.test(fileName)) {
    res.status(400).json({ error: `Invalid file name: ${fileName}` });
    return;
  }

  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }

  const filePath = path.join(CONTEXT_DIR, fileName);

  // Check edit permission based on the current file's frontmatter
  const existingContent = readFileOrEmpty(filePath);
  const { editRoles } = parseFileFrontmatter(existingContent, fileName);
  if (!canEditFile(req.user, editRoles)) {
    res.status(403).json({ error: 'You do not have permission to edit this context file', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  if (content.trim() === '') {
    try {
      fs.unlinkSync(filePath);
      logger.info(`Deleted context file: ${fileName}`);
    } catch { /* didn't exist — fine */ }
  } else {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      db.prepare('INSERT INTO context_file_versions (file_name, content, created_at) VALUES (?, ?, ?)')
        .run(fileName, content, Date.now());
      logger.info(`Saved context file: ${fileName} (${content.length} chars)`);
    } catch (err: any) {
      logger.error(`Failed to write context file ${fileName}: ${err.message}`);
      res.status(500).json({ error: `Failed to save file: ${err.message}` });
      return;
    }
  }

  invalidateContextCache();
  clearAllContextCaches();
  res.json({ ok: true });
});

/**
 * GET /:fileName/versions — list saved versions for a context file (newest first)
 */
contextFileRouter.get('/:fileName/versions', (req: Request, res: Response) => {
  const { fileName } = req.params;
  if (!CANONICAL_FILE_NAMES.has(fileName) && !SAFE_FILENAME.test(fileName)) {
    res.status(400).json({ error: `Invalid file name: ${fileName}` });
    return;
  }

  const versions = db.prepare(
    'SELECT id, file_name, content, created_at FROM context_file_versions WHERE file_name = ? ORDER BY created_at DESC LIMIT 50'
  ).all(fileName) as Array<{ id: number; file_name: string; content: string; created_at: number }>;

  res.json({ versions });
});
