import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import { invalidateContextCache } from '../agents/specialist-agent';
import { clearAllContextCaches } from '../agents/agent-cache';
import db from '../data/database';

const logger = new Logger('CONTEXT-FILES');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const CONTEXT_DIR = path.join(PROJECT_ROOT, 'context');

interface CanonicalFile {
  fileName: string;
  label: string;
  description: string;
  hasTemplate: boolean;
}

const CANONICAL_FILES: CanonicalFile[] = [
  {
    fileName: 'company.md',
    label: 'Company Overview',
    description: 'Mission, products, target users, market position, business model',
    hasTemplate: true,
  },
  {
    fileName: 'strategy.md',
    label: 'Product Strategy',
    description: 'North star goal, OKRs, roadmap themes, non-priorities, constraints',
    hasTemplate: true,
  },
  {
    fileName: 'tech-stack.md',
    label: 'Tech Stack',
    description: 'Frontend, backend, infrastructure, key integrations',
    hasTemplate: true,
  },
  {
    fileName: 'db-schema.md',
    label: 'Database Schema',
    description: 'Tables, columns, key relationships',
    hasTemplate: true,
  },
  {
    fileName: 'process.md',
    label: 'Development Process',
    description: 'Sprint cadence, definition of ready/done, release process',
    hasTemplate: true,
  },
  {
    fileName: 'current-state.md',
    label: 'Current State',
    description: 'What is live, active work, known debt, recent decisions',
    hasTemplate: true,
  },
];

const CANONICAL_FILE_NAMES = new Set(CANONICAL_FILES.map((f) => f.fileName));
const SAFE_FILENAME = /^[a-z0-9][a-z0-9-_]*\.md$/;

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
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
    return { fileName: cf.fileName, label: cf.label, description: cf.description, hasTemplate: cf.hasTemplate, content, templateContent };
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
      files.push({
        fileName: entry,
        label: labelFromFileName(entry),
        description: 'Custom context file',
        hasTemplate: false,
        content: readFileOrEmpty(path.join(CONTEXT_DIR, entry)),
        templateContent: undefined,
      });
    }
  } catch { /* context dir may not exist yet */ }

  res.json({ files });
});

/**
 * POST / — create a new custom context file
 */
contextFileRouter.post('/', (req: Request, res: Response) => {
  const { label, description, content } = req.body;
  if (!label || typeof label !== 'string') {
    res.status(400).json({ error: 'label is required' });
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
contextFileRouter.put('/:fileName', (req: Request, res: Response) => {
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
