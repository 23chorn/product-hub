import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import { invalidateContextCache } from '../agents/bmad-agent';
import { clearAllContextCaches } from '../agents/agent-cache';

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
    hasTemplate: false,
  },
  {
    fileName: 'db-schema.md',
    label: 'Database Schema',
    description: 'Tables, columns, key relationships',
    hasTemplate: false,
  },
  {
    fileName: 'process.md',
    label: 'Development Process',
    description: 'Sprint cadence, definition of ready/done, release process',
    hasTemplate: false,
  },
  {
    fileName: 'current-state.md',
    label: 'Current State',
    description: 'What is live, active work, known debt, recent decisions',
    hasTemplate: false,
  },
];

const VALID_FILE_NAMES = new Set(CANONICAL_FILES.map((f) => f.fileName));

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export const contextFileRouter = Router();

/**
 * GET / — list all canonical context files with their content
 */
contextFileRouter.get('/', (_req: Request, res: Response) => {
  const files = CANONICAL_FILES.map((cf) => {
    const content = readFileOrEmpty(path.join(CONTEXT_DIR, cf.fileName));
    const templateContent = cf.hasTemplate
      ? readFileOrEmpty(path.join(CONTEXT_DIR, cf.fileName.replace('.md', '.example.md')))
      : undefined;

    return {
      fileName: cf.fileName,
      label: cf.label,
      description: cf.description,
      hasTemplate: cf.hasTemplate,
      content,
      templateContent,
    };
  });

  res.json({ files });
});

/**
 * PUT /:fileName — save (or delete if empty) a context file
 */
contextFileRouter.put('/:fileName', (req: Request, res: Response) => {
  const { fileName } = req.params;

  // Path traversal guard
  if (!VALID_FILE_NAMES.has(fileName)) {
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
    // Delete the file if content is empty
    try {
      fs.unlinkSync(filePath);
      logger.info(`Deleted context file: ${fileName}`);
    } catch {
      // File didn't exist — that's fine
    }
  } else {
    fs.writeFileSync(filePath, content, 'utf-8');
    logger.info(`Saved context file: ${fileName} (${content.length} chars)`);
  }

  // Invalidate caches so next agent request picks up the change
  invalidateContextCache();
  clearAllContextCaches();

  res.json({ ok: true });
});
