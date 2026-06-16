/**
 * workflow-coordinator-routes — the pre-workflow coordinator planning endpoints
 * (/coordinator/*), mounted at /api/workflow. The coordinator runs a streaming
 * Q&A with the user to enrich the goal before a workflow is created; shared state
 * and helpers live in workflow-planning.ts.
 */
import { Router, Request, Response } from 'express';
import { initSSE, sseSend } from '../utils/sse';
import { randomUUID } from 'crypto';
import Logger from '../utils/logger';
import {
  type PlanningMessages,
  saveCoordinatorSession,
  loadCoordinatorSession,
  getPlanningCoordinator,
  cleanCoordinatorResponse,
} from './workflow-planning';

const logger = new Logger('WORKFLOW-COORDINATOR-ROUTES');
export const workflowCoordinatorRoutes = Router();

/**
 * POST /api/workflow/coordinator/open
 * Body: { goal, model? }
 *
 * Opens a pre-workflow coordinator planning session. The coordinator asks
 * clarifying questions on behalf of the specialist agents.
 * Returns SSE stream. First event: { type: 'session', sessionId }.
 * When coordinator is ready: done event content will contain COORDINATOR_READY marker.
 */
workflowCoordinatorRoutes.post('/coordinator/open', async (req: Request, res: Response) => {
  const { goal, model } = req.body as { goal?: string; model?: string };
  if (!goal) return res.status(400).json({ error: 'goal is required' });

  const sessionId = randomUUID();
  const messages: PlanningMessages = [
    { role: 'user', content: `New initiative goal:\n\n${goal}` },
  ];
  saveCoordinatorSession(sessionId, null, 'pre_workflow', null, messages);

  initSSE(res);
  sseSend(res, { type: 'session', sessionId });

  let fullContent = '';
  try {
    for await (const chunk of getPlanningCoordinator().streamPlanningResponse(messages, model, undefined)) {
      fullContent += chunk;
      sseSend(res, { type: 'content', content: chunk });
    }

    // Clean leaked system prompt content from the response
    const rawContent = fullContent;
    fullContent = cleanCoordinatorResponse(fullContent);

    // COORDINATOR_READY is forbidden on the first message — strip it if the model
    // echoed the format rules and produced one prematurely.
    if (fullContent.includes('COORDINATOR_READY')) {
      logger.warn('Model included COORDINATOR_READY in first message — stripping it');
      fullContent = fullContent.replace(/\n*COORDINATOR_READY\s*\n\{[\s\S]*?\}\s*$/, '').trimEnd();
    }

    // If content was cleaned, send a replace event so the frontend overwrites
    // the raw streamed text with the cleaned version.
    if (fullContent !== rawContent) {
      sseSend(res, { type: 'replace', content: fullContent });
      logger.info('Cleaned leaked system prompt content from coordinator response');
    }

    messages.push({ role: 'assistant', content: fullContent });
    saveCoordinatorSession(sessionId, null, 'pre_workflow', null, messages);
    sseSend(res, { type: 'done', content: fullContent });
  } catch (err: any) {
    sseSend(res, { type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/workflow/coordinator/reply
 * Body: { sessionId, message, model? }
 *
 * Sends a PM reply to the coordinator planning session.
 * Returns SSE stream. Done event content may contain COORDINATOR_READY marker.
 */
workflowCoordinatorRoutes.post('/coordinator/reply', async (req: Request, res: Response) => {
  const { sessionId, message, model } = req.body as {
    sessionId?: string;
    message?: string;
    model?: string;
  };
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  const session = loadCoordinatorSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Planning session not found' });

  session.messages.push({ role: 'user', content: message });

  // Count how many assistant turns have already happened.
  // After 3 coordinator responses, force-inject COORDINATOR_READY if the model
  // hasn't already included it — prevents endless question loops.
  const assistantTurnCount = session.messages.filter(m => m.role === 'assistant').length;
  const forceReady = assistantTurnCount >= 3;

  if (forceReady) {
    // Append a strong reminder to the last user message so the model knows it must launch now.
    const lastIdx = session.messages.length - 1;
    session.messages[lastIdx] = {
      role: 'user',
      content: session.messages[lastIdx].content +
        '\n\n[SYSTEM: You have reached the maximum number of clarification rounds. Your response MUST end with COORDINATOR_READY followed by the JSON object. Do not ask any more questions.]',
    };
  }

  let fullContent = '';
  try {
    initSSE(res);

    for await (const chunk of getPlanningCoordinator().streamPlanningResponse(session.messages, model, undefined)) {
      fullContent += chunk;
      sseSend(res, { type: 'content', content: chunk });
    }

    // Clean leaked system prompt content
    const rawReplyContent = fullContent;
    fullContent = cleanCoordinatorResponse(fullContent);

    // Safety net: if the model still didn't include COORDINATOR_READY after the
    // force prompt, synthesise a minimal one from what we know so far.
    if (forceReady && !fullContent.includes('COORDINATOR_READY')) {
      const goalMsg = session.messages.find(m => m.role === 'user');
      const goalText = goalMsg?.content.replace(/\[SYSTEM:.*\]/, '').trim() ?? 'the stated goal';
      const synthetic = `\n\nCOORDINATOR_READY\n{"enriched_context": "${goalText.slice(0, 300).replace(/"/g, "'")}"}`;
      fullContent += synthetic;
      sseSend(res, { type: 'content', content: synthetic });
      logger.info('Force-injected COORDINATOR_READY after max rounds exceeded');
    }

    // If content was cleaned, send a replace event
    if (fullContent !== rawReplyContent) {
      sseSend(res, { type: 'replace', content: fullContent });
      logger.info('Cleaned leaked system prompt content from coordinator reply');
    }

    // Strip the injected [SYSTEM] annotation before saving to DB
    if (forceReady) {
      session.messages[session.messages.length - 1].content =
        session.messages[session.messages.length - 1].content
          .replace(/\n\n\[SYSTEM:.*\]/, '');
    }

    session.messages.push({ role: 'assistant', content: fullContent });
    saveCoordinatorSession(sessionId, session.workflowId, session.type, session.nextStage, session.messages);
    sseSend(res, { type: 'done', content: fullContent });
  } catch (err: any) {
    sseSend(res, { type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

/**
 * GET /api/workflow/coordinator/session/:id
 * Returns the messages and metadata for a coordinator planning session.
 */
workflowCoordinatorRoutes.get('/coordinator/session/:id', (req: Request, res: Response) => {
  const session = loadCoordinatorSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});
