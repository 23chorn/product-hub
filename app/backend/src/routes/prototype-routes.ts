import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { generatePrototype, revisePrototype, loadLatestPrototype, repairTruncatedJson, type PrototypeResult } from '../agents/prototype-agent';
import { costTracker } from '../agents/workflow-router';
import Logger from '../utils/logger';

const PROTOTYPE_DIR = path.resolve(__dirname, '../../../../agents/templates/prototype');

const logger = new Logger('PROTOTYPE-ROUTES');

export const prototypeRoutes = Router();

/**
 * POST /api/workflow/:id/prototype/generate
 * Generate a new prototype from workflow artifacts. Returns SSE stream.
 * Body: { scope?: string }
 */
prototypeRoutes.post('/workflow/:id/prototype/generate', async (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const { scope } = req.body as { scope?: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const onTokens = costTracker(workflowId);
    const generator = generatePrototype(workflowId, scope, onTokens);
    let result: PrototypeResult | null = null;

    while (true) {
      const next = await generator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      res.write(`data: ${JSON.stringify({ type: 'content', content: next.value })}\n\n`);
    }

    if (result) {
      res.write(`data: ${JSON.stringify({ type: 'prototype', prototype: result })}\n\n`);
    } else {
      // Parsing failed server-side — tell the frontend to try client-side repair
      res.write(`data: ${JSON.stringify({ type: 'parse_failed' })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err: any) {
    logger.error('Failed to generate prototype', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const onTokens = costTracker(workflowId);
    const generator = revisePrototype(workflowId, prototype, feedback, onTokens);
    let result: PrototypeResult | null = null;

    while (true) {
      const next = await generator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      res.write(`data: ${JSON.stringify({ type: 'content', content: next.value })}\n\n`);
    }

    if (result) {
      res.write(`data: ${JSON.stringify({ type: 'prototype', prototype: result })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'parse_failed' })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err: any) {
    logger.error('Failed to revise prototype', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
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
  } catch (err: any) {
    res.status(422).json({ error: 'Could not repair JSON', detail: err.message });
  }
});

/**
 * GET /api/prototype/design-system
 * Returns the design token CSS and tailwind config for Sandpack injection.
 */
prototypeRoutes.get('/prototype/design-system', (_req: Request, res: Response) => {
  try {
    const tokens = fs.readFileSync(path.join(PROTOTYPE_DIR, 'design-tokens.css'), 'utf-8');
    const utilities = fs.readFileSync(path.join(PROTOTYPE_DIR, 'design-system-utilities.css'), 'utf-8');
    const tailwindConfig = fs.readFileSync(path.join(PROTOTYPE_DIR, 'tailwind.config.js'), 'utf-8');
    res.json({ tokens, utilities, tailwindConfig });
  } catch (err: any) {
    logger.error('Failed to load design system files', err);
    res.status(500).json({ error: 'Design system files not found' });
  }
});

/**
 * GET /api/workflow/:id/prototype
 * Load the most recently generated prototype for a workflow.
 */
prototypeRoutes.get('/workflow/:id/prototype', (req: Request, res: Response) => {
  const prototype = loadLatestPrototype(req.params.id);
  if (!prototype) {
    return res.status(404).json({ error: 'No prototype found for this workflow' });
  }
  res.json(prototype);
});
