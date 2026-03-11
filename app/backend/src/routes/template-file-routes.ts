import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';

const logger = new Logger('TEMPLATE-FILES');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'agents', 'templates');

interface CanonicalTemplate {
  fileName: string;
  label: string;
  description: string;
}

const CANONICAL_TEMPLATES: CanonicalTemplate[] = [
  {
    fileName: 'research.template.md',
    label: 'Research Brief',
    description: 'Output format for the Analyst stage — market research, problem space, competitive landscape',
  },
  {
    fileName: 'prd.template.md',
    label: 'Product Requirements Document',
    description: 'Output format for the PM PRD stage — problem statement, personas, journeys, requirements',
  },
  {
    fileName: 'architecture.template.md',
    label: 'Solution Architecture',
    description: 'Output format for the Architect stage — tech decisions, data model, API surface, infrastructure',
  },
  {
    fileName: 'backlog.template.md',
    label: 'Backlog (Epics & Stories)',
    description: 'Output format for the PM Backlog stage — JSON structure for epics, features, and user stories',
  },
];

const VALID_FILE_NAMES = new Set(CANONICAL_TEMPLATES.map((t) => t.fileName));

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export const templateFileRouter = Router();

/**
 * GET / — list all canonical template files with their content
 */
templateFileRouter.get('/', (_req: Request, res: Response) => {
  const files = CANONICAL_TEMPLATES.map((ct) => {
    const content = readFileOrEmpty(path.join(TEMPLATES_DIR, ct.fileName));
    return {
      fileName: ct.fileName,
      label: ct.label,
      description: ct.description,
      content,
    };
  });

  res.json({ files });
});

/**
 * PUT /:fileName — save a template file (content must be non-empty)
 */
templateFileRouter.put('/:fileName', (req: Request, res: Response) => {
  const { fileName } = req.params;

  // Path traversal guard
  if (!VALID_FILE_NAMES.has(fileName)) {
    res.status(400).json({ error: `Invalid template file name: ${fileName}` });
    return;
  }

  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }

  if (content.trim() === '') {
    res.status(400).json({ error: 'Template content cannot be empty — templates define agent output structure' });
    return;
  }

  const filePath = path.join(TEMPLATES_DIR, fileName);
  fs.writeFileSync(filePath, content, 'utf-8');
  logger.info(`Saved template file: ${fileName} (${content.length} chars)`);

  // No cache invalidation needed — templates are loaded fresh from disk on each
  // stage start via buildSystemPrompt()

  res.json({ ok: true });
});
