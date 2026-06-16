import { Router, Request, Response } from 'express';
import { initSSE, sseSend } from '../utils/sse';
import * as fs from 'fs';
import * as path from 'path';
import { revisePrototype, loadLatestPrototype, repairTruncatedJson, type PrototypeResult } from '../agents/prototype-agent';
import Logger from '../utils/logger';

const PROTOTYPE_DIR = path.resolve(__dirname, '../../../../agents/templates/prototype');
const logger = new Logger('PROTOTYPE-ROUTES');

export const prototypeRoutes = Router();

/**
 * POST /api/workflow/:id/prototype/revise
 * Revise an existing prototype with feedback. Returns SSE stream.
 * Body: { prototype: PrototypeResult, feedback: string }
 */
prototypeRoutes.post('/workflow/:id/prototype/revise', async (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const { prototype, feedback } = req.body as { prototype?: PrototypeResult; feedback?: string };

  if (!prototype || !feedback) {
    return res.status(400).json({ error: 'prototype and feedback are required' });
  }

  initSSE(res);

  try {
    const generator = revisePrototype(workflowId, prototype, feedback);
    let result: PrototypeResult | null = null;

    while (true) {
      const next = await generator.next();
      if (next.done) { result = next.value; break; }
      sseSend(res, { type: 'content', content: next.value });
    }

    if (result) {
      sseSend(res, { type: 'prototype', prototype: result });
    } else {
      sseSend(res, { type: 'parse_failed' });
    }
    sseSend(res, { type: 'done' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to revise prototype', err);
    sseSend(res, { type: 'error', error: msg });
  } finally {
    res.end();
  }
});

/**
 * POST /api/workflow/:id/prototype/parse
 * Client-side recovery: accept raw streamed text and attempt to repair+parse it.
 * Body: { raw: string }
 */
prototypeRoutes.post('/workflow/:id/prototype/parse', (req: Request, res: Response) => {
  const { raw } = req.body as { raw?: string };
  if (!raw) return res.status(400).json({ error: 'raw text is required' });
  try {
    const repaired = repairTruncatedJson(raw);
    const parsed = JSON.parse(repaired) as PrototypeResult;
    res.json(parsed);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: 'Could not repair JSON', detail: msg });
  }
});

/**
 * GET /api/prototype/design-system
 * Returns design token CSS and utilities for srcdoc iframe injection.
 */
prototypeRoutes.get('/prototype/design-system', (_req: Request, res: Response) => {
  try {
    const tokens = fs.readFileSync(path.join(PROTOTYPE_DIR, 'design-tokens.css'), 'utf-8');
    const utilities = fs.readFileSync(path.join(PROTOTYPE_DIR, 'design-system-utilities.css'), 'utf-8');
    const tailwindConfig = fs.readFileSync(path.join(PROTOTYPE_DIR, 'tailwind.config.js'), 'utf-8');
    res.json({ tokens, utilities, tailwindConfig });
  } catch (err: unknown) {
    logger.error('Failed to load design system files', err);
    res.status(500).json({ error: 'Design system files not found' });
  }
});

/**
 * GET /api/workflow/:id/prototype
 * Load the most recently generated prototype(s) for a workflow.
 * Returns { platform, web?, mobile? } — callers check platform to know which variants exist.
 */
prototypeRoutes.get('/workflow/:id/prototype', (req: Request, res: Response) => {
  const result = loadLatestPrototype(req.params.id);
  if (!result) return res.status(404).json({ error: 'No prototype found for this workflow' });
  res.json(result);
});
