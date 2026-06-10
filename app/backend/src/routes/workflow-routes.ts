import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  createWorkflow,
  advanceStage,
  completeStage,
  resolveCheckpoint,
  getWorkflowStatus,
  propagateFeedback,
  markWorkflowComplete,
  getWorkflowEvents,
  reiterateFromStage,
  retryCurrentStage,
  restartWorkflow,
  extendWorkflow,
  deleteWorkflow,
  costTracker,
} from '../agents/workflow-router';
import { CoordinatorAgent } from '../agents/coordinator-agent';
import { requestCancel } from '../agents/workflow-stage-runner';
import {
  linkCRArtifactVersion,
  completeChangeRequest,
  type ChangeRequestRow,
} from '../agents/change-request';
import db from '../data/database';
import { insertEvent } from '../agents/workflow-db';
import { resolveArtifactPath } from '../agents/artifact-helpers';
import Logger from '../utils/logger';
import { loadPrdForItem, buildEpicEnrichment, buildFeatureEnrichment } from '../utils/prd-enrichment';
import { isDemoMode } from '../demo/demo-mode';

// ── Pre-workflow planning cost accumulator ────────────────────────────────────
// Planning conversations happen before a workflow ID exists, so we can't call
// costTracker(). Instead, accumulate cost in memory keyed by planning sessionId
// and apply it to the workflow when /start is called.
const planningCosts = new Map<string, number>();

function accumulatePlanningCost(sessionId: string, cost: number): void {
  planningCosts.set(sessionId, (planningCosts.get(sessionId) ?? 0) + cost);
}

// ── Coordinator planning sessions (DB-backed) ─────────────────────────────────

type PlanningMessages = Array<{ role: 'user' | 'assistant'; content: string }>;

function saveCoordinatorSession(
  id: string,
  workflowId: string | null,
  type: 'pre_workflow' | 'stage_briefing',
  nextStage: string | null,
  messages: PlanningMessages
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO coordinator_sessions (id, workflow_id, type, next_stage, messages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at
  `).run(id, workflowId, type, nextStage, JSON.stringify(messages), now, now);
}

function loadCoordinatorSession(id: string): {
  messages: PlanningMessages;
  type: 'pre_workflow' | 'stage_briefing';
  nextStage: string | null;
  workflowId: string | null;
} | null {
  const row = db.prepare('SELECT * FROM coordinator_sessions WHERE id = ?').get(id) as {
    messages: string; type: string; next_stage: string | null; workflow_id: string | null;
  } | undefined;
  if (!row) return null;
  return {
    messages: JSON.parse(row.messages ?? '[]'),
    type: row.type as 'pre_workflow' | 'stage_briefing',
    nextStage: row.next_stage,
    workflowId: row.workflow_id,
  };
}

let _planningCoordinator: CoordinatorAgent | null = null;
function getPlanningCoordinator(): CoordinatorAgent {
  if (!_planningCoordinator) _planningCoordinator = new CoordinatorAgent();
  return _planningCoordinator;
}

const logger = new Logger('WORKFLOW-ROUTES-V2');

/**
 * Strip leaked system prompt instructions from coordinator responses.
 * Small models (especially Ollama) sometimes echo their instructions verbatim.
 */
function cleanCoordinatorResponse(text: string): string {
  // Patterns that indicate leaked system prompt content
  const leakedPatterns = [
    /^#+\s*(Hard limits|What actually matters|How to ask|Signalling readiness|Format rules)[^\n]*\n/gm,
    /\*?\*?(Maximum \d+ questions|Maximum \d+ rounds|Prefer to launch early)\*?\*?[^\n]*\n/gm,
    /Do NOT ask about feature lists[^\n]*\n/gm,
    /Put each question on its own line[^\n]*\n/gm,
    /Use lettered options \(A \/ B \/ C\) when choices are clear:\s*\n\s*A\) Option one\s*\n\s*B\) Option two\s*\n/gm,
    /Accept terse answers and make reasonable inferences[^\n]*\n/gm,
    /End your response with exactly these two lines[^\n]*\n/gm,
    /`?COORDINATOR_READY`? must be a standalone line[^\n]*\n/gm,
    /The JSON object must be on the very next line[^\n]*\n/gm,
    /COORDINATOR_READY is\s*\*?\*?forbidden\*?\*?\s*in your first message[^\n]*\n/gm,
    /From message \d+ onward[^\n]*\n/gm,
    /By message \d+ you must include it[^\n]*\n/gm,
    /a wrong format causes a system failure[^\n]*\n/gm,
    /Do not ask a fourth round[^\n]*\n/gm,
    /Ask only if you genuinely cannot infer[^\n]*:\n/gm,
    /\*?\*?Who is it for\*?\*?\s*—\s*primary user\/customer segment[^\n]*\n/gm,
    /\*?\*?Scope\*?\*?\s*—\s*MVP or full product[^\n]*\n/gm,
    /\*?\*?Hard blockers\*?\*?\s*—\s*regulatory, technical[^\n]*\n/gm,
    /For message \d+, provide the following[^\n]*/gm,
    /Nothing may follow the JSON line[^\n]*\n/gm,
    /Do NOT repeat or quote these instructions[^\n]*\n/gm,
  ];

  let cleaned = text;
  for (const pattern of leakedPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

const KNOWN_STAGES = new Set(['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'gtm_strategy', 'feature_marketing', 'critic', 'curator', 'tech_refinement']);

/**
 * Validate a candidate stage sequence.
 * Returns the sequence if valid: all known stages, no duplicates, length 1–5.
 * Returns null if invalid — caller should fall back to the default sequence.
 */
function validateStageSequence(arr: unknown[]): string[] | null {
  const known = (arr as unknown[]).filter((s): s is string => typeof s === 'string' && KNOWN_STAGES.has(s));
  const unique = [...new Set(known)];
  // Reject if any duplicates existed among known-stage entries
  if (unique.length < 1 || unique.length !== known.length) return null;
  return unique;
}

/**
 * Extract a stage sequence from the Coordinator's free-text response.
 * Tries, in order:
 *   1. ```stages ["..."] ``` fenced block
 *   2. Any JSON array in the text containing known stage names
 *   3. Returns [] if nothing found or validation fails (caller falls back to default)
 */
function extractStageSequence(text: string): string[] {
  // 1. Fenced ```stages block
  const fencedMatch = text.match(/```(?:stages)?\s*(\[[\s\S]*?\])\s*```/m);
  if (fencedMatch) {
    try {
      const arr = JSON.parse(fencedMatch[1].trim());
      const valid = validateStageSequence(arr);
      if (valid) return valid;
    } catch { /* fall through */ }
  }

  // 2. Any JSON array containing known stage names
  const arrayMatches = text.match(/\[(?:\s*"[^"]+"\s*,?\s*)+\]/g) ?? [];
  for (const raw of arrayMatches) {
    try {
      const arr = JSON.parse(raw);
      const valid = validateStageSequence(arr);
      if (valid) return valid;
    } catch { /* skip */ }
  }

  return [];
}
export const workflowRoutes = Router();

// Critic no longer appears as a standalone stage — it runs inline after each specialist stage.
// The curator runs at the end to update project context files.
const DEFAULT_STAGES = ['analyst', 'pm_prd', 'solution_architect', 'prototype', 'pm_backlog', 'curator'];

// ── Coordinator planning phase ─────────────────────────────────────────────────

function sseStream(res: Response, generator: AsyncGenerator<string, void, unknown>): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  return (async () => {
    let fullContent = '';
    try {
      for await (const chunk of generator) {
        fullContent += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  })();
}

/**
 * POST /api/workflow/coordinator/open
 * Body: { goal, model? }
 *
 * Opens a pre-workflow coordinator planning session. The coordinator asks
 * clarifying questions on behalf of the specialist agents.
 * Returns SSE stream. First event: { type: 'session', sessionId }.
 * When coordinator is ready: done event content will contain COORDINATOR_READY marker.
 */
workflowRoutes.post('/coordinator/open', async (req: Request, res: Response) => {
  const { goal, model } = req.body as { goal?: string; model?: string };
  if (!goal) return res.status(400).json({ error: 'goal is required' });

  const sessionId = randomUUID();
  const messages: PlanningMessages = [
    { role: 'user', content: `New initiative goal:\n\n${goal}` },
  ];
  saveCoordinatorSession(sessionId, null, 'pre_workflow', null, messages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);

  let fullContent = '';
  try {
    for await (const chunk of getPlanningCoordinator().streamPlanningResponse(messages, model, (u) => accumulatePlanningCost(sessionId, u.estimatedCost))) {
      fullContent += chunk;
      res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ type: 'replace', content: fullContent })}\n\n`);
      logger.info('Cleaned leaked system prompt content from coordinator response');
    }

    messages.push({ role: 'assistant', content: fullContent });
    saveCoordinatorSession(sessionId, null, 'pre_workflow', null, messages);
    res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
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

workflowRoutes.post('/coordinator/reply', async (req: Request, res: Response) => {
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of getPlanningCoordinator().streamPlanningResponse(session.messages, model, (u) => accumulatePlanningCost(sessionId, u.estimatedCost))) {
      fullContent += chunk;
      res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ type: 'content', content: synthetic })}\n\n`);
      logger.info('Force-injected COORDINATOR_READY after max rounds exceeded');
    }

    // If content was cleaned, send a replace event
    if (fullContent !== rawReplyContent) {
      res.write(`data: ${JSON.stringify({ type: 'replace', content: fullContent })}\n\n`);
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
    res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

/**
 * GET /api/workflow/coordinator/session/:id
 * Returns the messages and metadata for a coordinator planning session.
 */
workflowRoutes.get('/coordinator/session/:id', (req: Request, res: Response) => {
  const session = loadCoordinatorSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});


// ── POST /api/workflow/start ──────────────────────────────────────────────────

/**
 * POST /api/workflow/start
 * Body: { itemId, goal, stageSequence?, policyOverrides? }
 *
 * Creates the workflow with a fixed default stage sequence (predictable, no LLM
 * call needed here), then advances to stage 1. Returns JSON:
 *   { workflowId, stage, sessionId, complete, stages }
 */
workflowRoutes.post('/start', async (req: Request, res: Response) => {
  let { itemId, goal, enrichedContext, stageSequence, policyOverrides, planningSessionId, kbQueries } = req.body as {
    itemId?: string;
    goal?: string;
    enrichedContext?: string;
    stageSequence?: string[];
    policyOverrides?: Record<string, string>;
    planningSessionId?: string;
    kbQueries?: string[];
  };

  if (!goal) {
    return res.status(400).json({ error: 'goal is required' });
  }

  // Ensure the item exists in the local DB before creating the workflow (FK constraint).
  // • No itemId supplied → generate a new local record.
  // • itemId supplied but not in DB → Airtable initiative; insert a shadow record so the FK is satisfied.
  if (!itemId) {
    const { randomUUID: uuid } = require('crypto');
    const id = uuid();
    const now = Date.now();
    const title = goal.slice(0, 100) + (goal.length > 100 ? '...' : '');
    db.prepare(`
      INSERT INTO items (id, type, title, description, status, source, airtable_id, created_at, updated_at)
      VALUES (?, 'initiative', ?, ?, 'active', 'local', NULL, ?, ?)
    `).run(id, title, goal.slice(0, 500), now, now);
    itemId = id;
    logger.info(`Auto-created local item ${id} for workflow`);
  } else {
    const existing = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId);
    if (!existing) {
      const now = Date.now();
      const title = goal.slice(0, 100) + (goal.length > 100 ? '...' : '');
      db.prepare(`
        INSERT INTO items (id, type, title, description, status, source, airtable_id, created_at, updated_at)
        VALUES (?, 'initiative', ?, ?, 'active', 'airtable', ?, ?, ?)
      `).run(itemId, title, goal.slice(0, 500), itemId, now, now);
      logger.info(`Created shadow item ${itemId} for Airtable initiative`);
    }
  }

  try {
    // Use caller-supplied sequence if valid, otherwise the fixed default
    let stages = (stageSequence && Array.isArray(stageSequence) && stageSequence.length > 0)
      ? stageSequence
      : DEFAULT_STAGES;

    // tech_refinement is always injected after pm_backlog (required stage)
    if (stages.includes('pm_backlog') && !stages.includes('tech_refinement')) {
      const idx = stages.indexOf('pm_backlog');
      stages = [...stages.slice(0, idx + 1), 'tech_refinement', ...stages.slice(idx + 1)];
    }

    // Fold coordinator-gathered context into the goal so all stage briefs benefit from it
    const fullGoal = enrichedContext
      ? `${goal}\n\n[Coordinator context]\n\n${enrichedContext}`
      : goal;

    // Store coordinator's KB search queries in policy overrides so generateStageBrief can use them
    if (kbQueries && Array.isArray(kbQueries) && kbQueries.length > 0) {
      policyOverrides = { ...policyOverrides, kb_queries: JSON.stringify(kbQueries) };
    }

    const workflow = createWorkflow(itemId!, fullGoal, stages, policyOverrides);

    // Apply any pre-workflow planning cost accumulated during coordinator Q&A
    if (planningSessionId) {
      const planCost = planningCosts.get(planningSessionId) ?? 0;
      if (planCost > 0) {
        costTracker(workflow.id)({ model: 'coordinator', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, searchCount: 0, estimatedCost: planCost });
      }
      planningCosts.delete(planningSessionId);
    }

    let nextStage: string | null = null;
    let nextSessionId: string | null = null;
    let complete = false;

    try {
      const result = await advanceStage(workflow.id);
      nextStage = result.stage;
      nextSessionId = result.sessionId;
    } catch (err: any) {
      if (err.message.startsWith('WORKFLOW_COMPLETE:')) {
        complete = true;
      } else {
        throw err;
      }
    }

    res.json({ workflowId: workflow.id, stage: nextStage, sessionId: nextSessionId, complete, stages });
  } catch (err: any) {
    logger.error('Failed to start workflow', err);
    const isRateLimit = err.message?.includes('Rate limit') || err.message?.includes('throttled');
    res.status(isRateLimit ? 429 : 500).json({ error: err.message });
  }
});

// ── POST /api/workflow/complete-stage ─────────────────────────────────────────

/**
 * POST /api/workflow/complete-stage
 * Body: { workflowId }
 *
 * Called by the user when they are satisfied with the specialist's output and
 * want to submit the current stage for checkpoint review.
 * Creates a pending checkpoint and sets status = paused_at_checkpoint.
 */
workflowRoutes.post('/complete-stage', (req: Request, res: Response) => {
  const { workflowId } = req.body as { workflowId?: string };
  if (!workflowId) return res.status(400).json({ error: 'workflowId is required' });

  try {
    completeStage(workflowId);
    const status = getWorkflowStatus(workflowId);
    res.json(status);
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to complete stage', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/workflow/checkpoint/resolve
 * Body: { checkpointId, status: 'approved'|'rejected'|'revised', feedback? }
 *
 * - approved: resolveCheckpoint + advanceStage; returns nextStage + sessionId
 * - rejected: resolveCheckpoint + markWorkflowComplete; workflow ends
 * - revised:  propagateFeedback (rolls stage back for re-run)
 *
 * Returns: { workflow: WorkflowStatus, nextStage?, nextSessionId?, complete? }
 */
workflowRoutes.post('/checkpoint/resolve', async (req: Request, res: Response) => {
  const { checkpointId, status, feedback, enrichedContext } = req.body as {
    checkpointId?: number;
    status?: 'approved' | 'rejected' | 'revised';
    feedback?: string;
    enrichedContext?: string;  // stage-specific coordinator context gathered before launch
  };

  const cpId = typeof checkpointId === 'number' ? checkpointId : parseInt(String(checkpointId), 10);
  if (isNaN(cpId)) return res.status(400).json({ error: 'checkpointId must be a number' });

  if (!status || !['approved', 'rejected', 'revised'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or revised' });
  }

  try {
    // Peek at checkpoint to get workflowId before resolving
    const cpRow = db.prepare<[number], { workflow_id: string }>('SELECT workflow_id FROM checkpoints WHERE id = ?').get(cpId);
    if (!cpRow) return res.status(404).json({ error: `Checkpoint not found: ${cpId}` });
    const workflowId = cpRow.workflow_id;

    if (status === 'approved') {
      // Read checkpoint stage + artifact before resolving
      const cpDetail = db.prepare<[number], { stage: string; artifact_id: number | null }>(
        'SELECT stage, artifact_id FROM checkpoints WHERE id = ?'
      ).get(cpId);

      resolveCheckpoint(cpId, 'approved', feedback);

      // Fold stage-specific coordinator context into the workflow goal so the
      // next specialist's brief includes it. Appended as a labelled block so
      // generateStageBrief picks it up naturally from workflow.goal.
      if (enrichedContext) {
        const stageRow = db.prepare<[string], { current_stage: string | null }>(
          'SELECT current_stage FROM workflows WHERE id = ?'
        ).get(workflowId);
        const label = stageRow?.current_stage
          ? `[${stageRow.current_stage} stage context]`
          : '[stage context]';
        db.prepare('UPDATE workflows SET goal = goal || ?, updated_at = ? WHERE id = ?')
          .run(`\n\n${label}\n\n${enrichedContext}`, Date.now(), workflowId);
      }

      // If there's an active CR, link the approved artifact as a new version
      const activeCR = db.prepare<[string], ChangeRequestRow & { original_sequence?: string }>(
        `SELECT * FROM change_requests WHERE workflow_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`
      ).get(workflowId);

      if (activeCR && cpDetail?.artifact_id && cpDetail.stage) {
        // Find parent artifact (latest artifact for this stage created BEFORE the CR)
        const parentRow = db.prepare<[string, number, number], { id: number }>(`
          SELECT a.id FROM artifacts a
          JOIN sessions s ON a.session_id = s.id
          JOIN (SELECT item_id FROM workflows WHERE id = ?) w ON s.item_id = w.item_id
          WHERE a.type = (SELECT type FROM artifacts WHERE id = ?)
            AND a.id != ?
          ORDER BY a.created_at DESC LIMIT 1
        `).get(workflowId, cpDetail.artifact_id!, cpDetail.artifact_id!);

        try {
          linkCRArtifactVersion(activeCR.id, cpDetail.stage, cpDetail.artifact_id, parentRow?.id ?? null);
        } catch (err: any) {
          logger.warn(`Failed to link CR artifact version: ${err.message}`);
        }
      }

      // Auto publish wiki pages after research, PRD, and architecture approvals
      if (cpDetail?.stage === 'analyst' || cpDetail?.stage === 'pm_prd' || cpDetail?.stage === 'solution_architect') {
        const wfRow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
        if (wfRow) {
          autoPublishWikiPages(workflowId, wfRow.item_id, cpDetail.stage as 'analyst' | 'pm_prd' | 'solution_architect').catch(err =>
            logger.warn(`autoPublishWikiPages failed: ${err.message}`)
          );
        }
      }

      // Auto push-to-board after tech refinement approval
      if (cpDetail?.stage === 'tech_refinement') {
        const wfRow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
        if (wfRow) {
          autoPushToBoard(workflowId, wfRow.item_id).catch(err =>
            logger.error(`autoPushToBoard failed: ${err.message}`)
          );
        }
      }

      // Auto push test plan after QA approval
      if (cpDetail?.stage === 'qa_engineer') {
        const wfRow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
        if (wfRow) {
          autoPushTestPlan(workflowId, wfRow.item_id).catch(err =>
            logger.error(`autoPushTestPlan failed: ${err.message}`)
          );
        }
      }

      // Advance to the next stage asynchronously — don't block the response.
      // The checkpoint is already approved; the frontend polls for status updates.
      advanceStage(workflowId)
        .then(result => {
          logger.info(`Stage advanced to "${result.stage}" for workflow ${workflowId}`);
        })
        .catch(err => {
          if (err.message?.startsWith('WORKFLOW_COMPLETE:')) {
            logger.info(`Workflow ${workflowId} complete after checkpoint approval`);

            // If there's an active CR, finalize it
            if (activeCR) {
              try {
                completeChangeRequest(activeCR.id, workflowId);
              } catch (crErr: any) {
                logger.warn(`Failed to complete CR #${activeCR.id}: ${crErr.message}`);
              }
            }
          } else {
            logger.error(`advanceStage failed after checkpoint approval: ${err.message}`);
          }
        });

      const workflowStatus = getWorkflowStatus(workflowId);
      return res.json({ workflow: workflowStatus });
    }

    if (status === 'rejected') {
      resolveCheckpoint(cpId, 'rejected', feedback);
      markWorkflowComplete(workflowId);
      const workflowStatus = getWorkflowStatus(workflowId);
      return res.json({ workflow: workflowStatus, complete: true });
    }

    // revised
    if (!feedback) return res.status(400).json({ error: 'feedback is required for revised status' });
    await propagateFeedback(cpId, feedback);
    const workflowStatus = getWorkflowStatus(workflowId);
    return res.json({ workflow: workflowStatus });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to resolve checkpoint', err);
    const isRateLimit = err.message?.includes('Rate limit') || err.message?.includes('throttled');
    res.status(isRateLimit ? 429 : 400).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/reiterate ───────────────────────────────────────────

/**
 * POST /api/workflow/:id/reiterate
 * Body: { fromStage: string, feedback: string }
 *
 * Re-enters a completed workflow at a specific stage. The given stage and all
 * downstream stages are re-run with the user's feedback as context.
 */
workflowRoutes.post('/:id/reiterate', async (req: Request, res: Response) => {
  const { fromStage, feedback } = req.body as { fromStage?: string; feedback?: string };
  if (!fromStage || !feedback) {
    return res.status(400).json({ error: 'fromStage and feedback are required' });
  }
  if (!KNOWN_STAGES.has(fromStage)) {
    return res.status(400).json({ error: `Unknown stage: ${fromStage}` });
  }

  try {
    await reiterateFromStage(req.params.id, fromStage, feedback);
    const status = getWorkflowStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to reiterate workflow', err);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/extend ─────────────────────────────────────────────

/**
 * POST /api/workflow/:id/extend
 * Appends new stages to a completed workflow and re-activates it.
 * Body: { stages: string[] }  — ordered list of stage keys to add.
 * Stages are inserted before 'curator' (if present) so curator re-runs last.
 */
workflowRoutes.post('/:id/extend', async (req: Request, res: Response) => {
  const { stages } = req.body as { stages?: unknown };
  if (!Array.isArray(stages) || stages.length === 0) {
    return res.status(400).json({ error: 'stages must be a non-empty array' });
  }
  const unknownStages = (stages as unknown[]).filter(
    (s): s is string => typeof s !== 'string' || !KNOWN_STAGES.has(s)
  );
  if (unknownStages.length) {
    return res.status(400).json({ error: `Unknown stage(s): ${unknownStages.join(', ')}` });
  }

  try {
    await extendWorkflow(req.params.id, stages as string[]);
    const status = getWorkflowStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to extend workflow', err);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/retry ──────────────────────────────────────────────

/**
 * POST /api/workflow/:id/retry
 * Retries the current stage of an active workflow that appears stuck.
 * No body required — it re-triggers whatever current_stage the workflow is on.
 */
workflowRoutes.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const result = await retryCurrentStage(req.params.id);
    const status = getWorkflowStatus(req.params.id);
    res.json({ ...status, retriedStage: result.stage });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to retry stage', err);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/restart ───────────────────────────────────────────

/**
 * POST /api/workflow/:id/restart
 * Restarts a stopped/cancelled workflow from the very first stage.
 * Clears the cancel flag and fires a fresh run with no prior artifacts.
 */
workflowRoutes.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    await restartWorkflow(req.params.id);
    const status = getWorkflowStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to restart workflow', err);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/cancel ─────────────────────────────────────────────
workflowRoutes.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    requestCancel(id);
    res.json({ ok: true, cancelled: true });
  } catch (err: any) {
    logger.error('Failed to cancel workflow', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Auto push-to-board after tech refinement ────────────────────────────────────

interface PushResult {
  topUrl: string;
  topId: number;
  level: 'epic' | 'feature' | 'story';
  featureCount?: number;
  storyCount?: number;
}

/**
 * Called automatically when a tech_refinement checkpoint is approved.
 * Pushes the refined backlog to the configured board and emits a board_synced event.
 */
async function autoPushToBoard(workflowId: string, itemId: string): Promise<void> {
  const fs = require('fs');

  try {
    // ── Check ADO config — skip mock path if real ADO is configured ─────────
    const { appConfig } = require('../config/app-config');
    const adoConfigured = appConfig.integrations.workItems === 'ado';

    if (!adoConfigured) {
      // No ADO configured — log and skip (nothing to push to)
      logger.info(`Auto push skipped — work items integration is "${appConfig.integrations.workItems}"`);
      return;
    }

    // Load latest backlog artifact
    const artifact = db.prepare<[string], { file_path: string }>(`
      SELECT a.file_path FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'backlog'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId);

    if (!artifact) {
      logger.warn(`Auto push-to-board: no backlog artifact for item ${itemId}`);
      return;
    }

    const content = fs.readFileSync(resolveArtifactPath(artifact.file_path), 'utf-8');
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    let backlog: any;
    try { backlog = JSON.parse(cleaned); } catch {
      logger.warn('Auto push-to-board: backlog artifact is not valid JSON');
      return;
    }

    // Normalise tiers
    if (backlog?.story) {
      backlog.epic = { title: backlog.story.title, description: backlog.story.goal || '' };
      backlog.features = [{ title: backlog.story.title, description: backlog.story.goal || '', phase: 'MVP', stories: [backlog.story] }];
      delete backlog.story;
    } else if (backlog?.feature) {
      backlog.epic = { title: backlog.feature.title, description: backlog.feature.description || '' };
      backlog.features = [backlog.feature];
      delete backlog.feature;
    } else if (backlog?.epic && !backlog?.features && Array.isArray(backlog?.epic?.stories)) {
      backlog.features = [{ title: backlog.epic.title, description: backlog.epic.description, phase: 'MVP', stories: backlog.epic.stories }];
    }

    if (!backlog?.epic || !Array.isArray(backlog?.features)) {
      logger.warn('Auto push-to-board: unrecognised backlog structure');
      return;
    }

    // PRD enrichment
    const prdContent = loadPrdForItem(itemId);
    if (prdContent) {
      const epicHtml = buildEpicEnrichment(prdContent);
      if (epicHtml) backlog.epic.description = `${backlog.epic.description || ''}<hr>${epicHtml}`;
      for (const feature of backlog.features as any[]) {
        const frIds = new Set<string>();
        const journeyRefs = new Set<string>();
        for (const story of (feature.stories ?? []) as any[]) {
          for (const fr of (story.prdRef?.functionalRequirements ?? []) as string[]) frIds.add(fr);
          if (story.prdRef?.userJourney) journeyRefs.add(story.prdRef.userJourney as string);
        }
        const featureHtml = buildFeatureEnrichment(prdContent, frIds, journeyRefs);
        if (featureHtml) feature.description = `${feature.description || ''}<hr>${featureHtml}`;
      }
    }

    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();

    // Check for existing mappings (sync vs create)
    const existingMappings = db.prepare<[string], { local_key: string; ado_id: number; title: string }>(
      'SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ?'
    ).all(workflowId);

    const artifactRow = db.prepare<[string], { id: number }>(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'backlog'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId);
    const artifactId = artifactRow?.id ?? 0;

    let result: PushResult;

    if (existingMappings.length > 0) {
      const mapByKey = new Map(existingMappings.map((m: any) => [m.local_key, m]));
      const updateResult = await client.updateBacklog(backlog, mapByKey);
      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const m of updateResult.newMappings) {
        insertMapping.run(workflowId, artifactId, m.ado_id, m.ado_type, m.ado_url, m.local_key, m.title, now);
      }
      result = { topId: updateResult.epicId, topUrl: client.getEpicUrl(updateResult.epicId), level: 'epic' };
    } else {
      const createResult = await client.createBacklog(backlog);
      const epicUrl = client.getEpicUrl(createResult.epicId);
      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      insertMapping.run(workflowId, artifactId, createResult.epicId, 'epic', epicUrl, 'epic', backlog.epic.title, now);
      let featureIdx = 0, storyIdx = 0;
      for (let fi = 0; fi < backlog.features.length; fi++) {
        const featureKey = `F${fi + 1}`;
        const featureAdoId = createResult.featureIds[featureIdx++];
        insertMapping.run(workflowId, artifactId, featureAdoId, 'feature', client.getEpicUrl(featureAdoId), featureKey, backlog.features[fi].title, now);
        for (let si = 0; si < backlog.features[fi].stories.length; si++) {
          const storyKey = `${featureKey}.S${si + 1}`;
          const storyAdoId = createResult.storyIds[storyIdx++];
          insertMapping.run(workflowId, artifactId, storyAdoId, 'story', client.getEpicUrl(storyAdoId), storyKey, backlog.features[fi].stories[si].title, now);
        }
      }
      result = {
        topId: createResult.epicId,
        topUrl: epicUrl,
        level: 'epic',
        featureCount: createResult.featureIds.length,
        storyCount: createResult.storyIds.length,
      };
    }

    insertEvent(workflowId, 'board_synced', 'tech_refinement',
      `Backlog synced to Azure DevOps — Epic #${result.topId} created\n→ ${result.topUrl}`,
      { top_url: result.topUrl, top_id: result.topId, level: result.level,
        feature_count: result.featureCount, story_count: result.storyCount });

    // Push Epic URL back to Airtable if item originated from there
    const itemAirtableRow = db.prepare<[string], { airtable_id: string | null }>(
      'SELECT airtable_id FROM items WHERE id = ?'
    ).get(itemId);
    if (itemAirtableRow?.airtable_id) {
      pushLinksToAirtable(itemAirtableRow.airtable_id, { epicLink: result.topUrl }).catch(() => {});
    }

    logger.info(`Auto push-to-board complete for workflow ${workflowId} — Epic #${result.topId} at ${result.topUrl}`);
  } catch (err: any) {
    logger.error(`Auto push-to-board failed for workflow ${workflowId}: ${err.message}`);
    insertEvent(workflowId, 'error', 'tech_refinement',
      `Board sync failed: ${err.message}`, { error: err.message });
  }
}

/**
 * Called automatically when the qa_engineer checkpoint is approved.
 * Creates or syncs the ADO Test Plan and pushes the URL to Airtable.
 */
async function autoPushTestPlan(workflowId: string, itemId: string): Promise<void> {
  const fs = require('fs');

  try {
    // ── Check ADO config ─────────────────────────────────────────────────────
    const { appConfig } = require('../config/app-config');
    const adoConfigured = appConfig.integrations.workItems === 'ado';

    if (!adoConfigured) {
      logger.info(`Auto push test plan skipped — work items integration is "${appConfig.integrations.workItems}"`);
      return;
    }

    // ── Load QA artifact ─────────────────────────────────────────────────────
    const qaArtifact = db.prepare<[string], { id: number; file_path: string }>(`
      SELECT a.id, a.file_path FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'qa_tests'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId);

    if (!qaArtifact) {
      logger.warn(`Auto push test plan: no QA artifact for item ${itemId}`);
      return;
    }

    const raw = fs.readFileSync(resolveArtifactPath(qaArtifact.file_path), 'utf-8')
      .replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    let qa: any;
    try { qa = JSON.parse(raw); } catch {
      logger.warn('Auto push test plan: QA artifact is not valid JSON');
      return;
    }

    const testCases = (qa.test_cases ?? []) as any[];
    if (testCases.length === 0) {
      logger.warn('Auto push test plan: no test cases found in QA artifact');
      return;
    }

    // ── Build story map ──────────────────────────────────────────────────────
    const storyMappings = db.prepare<[string], { local_key: string; ado_id: number }>(
      `SELECT local_key, ado_id FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story'`
    ).all(workflowId);
    const storyMap = new Map(storyMappings.map(m => [m.local_key, m.ado_id]));

    if (storyMap.size === 0) {
      logger.warn('Auto push test plan: no story mappings found — backlog must be pushed to ADO first');
      return;
    }

    // ── Check for existing test plan mapping ─────────────────────────────────
    const existingMap = db.prepare<[string], { plan_id: number; plan_url: string; suite_ids: string; test_case_ids: string; root_suite_id?: number }>(
      'SELECT plan_id, plan_url, suite_ids, test_case_ids, root_suite_id FROM qa_test_plan_map WHERE workflow_id = ?'
    ).get(workflowId);

    const existing = existingMap ? {
      planId: existingMap.plan_id,
      rootSuiteId: existingMap.root_suite_id,
      suiteIds: JSON.parse(existingMap.suite_ids ?? '{}'),
      testCaseIds: JSON.parse(existingMap.test_case_ids ?? '{}'),
    } : undefined;

    const workflow = db.prepare<[string], { summary: string | null; goal: string }>(
      'SELECT summary, goal FROM workflows WHERE id = ?'
    ).get(workflowId);
    const planName = (workflow?.summary ?? workflow?.goal.split('\n')[0] ?? 'Test Plan').slice(0, 60);

    // ── Push to ADO Test Plans ───────────────────────────────────────────────
    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();

    const result = await client.pushQATestPlan({ planName, testCases, storyMap, existing });

    // ── Persist the mapping ──────────────────────────────────────────────────
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO qa_test_plan_map
        (workflow_id, artifact_id, plan_id, root_suite_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowId,
      qaArtifact.id,
      result.planId,
      result.rootSuiteId,
      result.planUrl,
      JSON.stringify(result.suiteIds),
      JSON.stringify(result.testCaseIds),
      testCases.length,
      now
    );

    insertEvent(workflowId, 'stage_progress', 'qa_engineer',
      `QA Test Plan ${existing ? 'synced' : 'created'} in ADO — ${result.created} created, ${result.updated} updated\n→ ${result.planUrl}`,
      { plan_id: result.planId, plan_url: result.planUrl, created: result.created, updated: result.updated }
    );

    // ── Push Test Plan URL back to Airtable ──────────────────────────────────
    const itemAirtableRow = db.prepare<[string], { airtable_id: string | null }>(
      'SELECT airtable_id FROM items WHERE id = ?'
    ).get(itemId);
    if (itemAirtableRow?.airtable_id) {
      pushLinksToAirtable(itemAirtableRow.airtable_id, { testPlanLink: result.planUrl }).catch(() => {});
    }

    logger.info(`Auto push test plan complete for workflow ${workflowId} — Plan #${result.planId} at ${result.planUrl}`);
  } catch (err: any) {
    logger.error(`Auto push test plan failed for workflow ${workflowId}: ${err.message}`);
    insertEvent(workflowId, 'error', 'qa_engineer',
      `Test plan push failed: ${err.message}`, { error: err.message });
  }
}

// ── Push document links back to Airtable ──────────────────────────────────────

/**
 * Pushes document URLs back to the originating Airtable record.
 * Skips silently if the roadmap integration is not airtable.
 */
async function pushLinksToAirtable(airtableId: string, updates: Record<string, string>): Promise<void> {
  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.roadmap !== 'airtable') return;
    const { AirtableClient } = require('../integrations/airtable');
    await new AirtableClient().updateItem(airtableId, updates as any);
    logger.info(`Airtable record ${airtableId} updated: ${Object.keys(updates).join(', ')}`);
  } catch (err: any) {
    logger.warn(`Failed to push links to Airtable (${airtableId}): ${err.message}`);
  }
}

// ── Auto publish wiki pages after analyst / pm_prd approvals ──────────────────

/**
 * Publishes a research brief, PRD, or architecture document to the Azure DevOps Wiki under
 * "Product Documentation/Features/{FeatureName}/{PageName}".
 * After publishing, pushes the wiki URL back to the Airtable record.
 */
async function autoPublishWikiPages(workflowId: string, itemId: string, stage: 'analyst' | 'pm_prd' | 'solution_architect'): Promise<void> {
  const fs = require('fs');
  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems !== 'ado') return;

    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();
    const wikiId = client.wikiIdentifier;

    const itemRow = db.prepare<[string], { title: string; airtable_id: string | null }>(
      'SELECT title, airtable_id FROM items WHERE id = ?'
    ).get(itemId);
    if (!itemRow) { logger.warn(`autoPublishWikiPages: item ${itemId} not found`); return; }

    // Sanitise the feature name for a wiki path segment
    const featureName = itemRow.title.replace(/[/\\:*?"<>|#]/g, '').trim();
    const basePath = `/Product Documentation/Features/${featureName}`;
    const artifactType = stage === 'analyst' ? 'analyst' : stage === 'pm_prd' ? 'prd' : 'architecture';
    const pageName = stage === 'analyst' ? 'Research Brief' : stage === 'pm_prd' ? 'PRD' : 'Architecture';
    const pagePath = `${basePath}/${pageName}`;
    const airtableFieldKey = stage === 'analyst' ? 'researchBriefLink' : stage === 'pm_prd' ? 'prdLink' : 'architectureLink';

    // Load latest artifact for this stage
    const artifact = db.prepare<[string, string], { file_path: string }>(
      `SELECT a.file_path FROM artifacts a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.item_id = ? AND a.type = ?
       ORDER BY a.created_at DESC LIMIT 1`
    ).get(itemId, artifactType);
    if (!artifact?.file_path) {
      logger.warn(`autoPublishWikiPages: no ${artifactType} artifact for item ${itemId}`);
      return;
    }

    const content = fs.readFileSync(resolveArtifactPath(artifact.file_path), 'utf-8');

    // Ensure parent pages exist, then upsert the leaf page
    await client.ensureWikiPath(wikiId, pagePath);
    const { url } = await client.upsertWikiPage(wikiId, pagePath, content);

    insertEvent(workflowId, 'board_synced', stage,
      `Wiki page published: ${pageName}\n→ ${url}`, { wiki_url: url });
    logger.info(`Wiki published (${stage}): ${url}`);

    // Push URL back to Airtable
    if (itemRow.airtable_id) {
      await pushLinksToAirtable(itemRow.airtable_id, { [airtableFieldKey]: url });
    }
  } catch (err: any) {
    logger.warn(`autoPublishWikiPages(${stage}) failed: ${err.message}`);
  }
}

// ── POST /api/workflow/:id/push-to-board ────────────────────────────────────────

/**
 * POST /api/workflow/:id/push-to-board
 * Pushes the latest approved backlog artifact to the configured work-items
 * provider (ADO, Jira, etc.).
 * Returns: { epicId, epicUrl, featureCount, storyCount }
 */
workflowRoutes.post('/:id/push-to-board', async (req: Request, res: Response) => {
  const workflowId = req.params.id;

  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems === 'none') {
      return res.status(400).json({ error: 'No work-items integration is configured. Set WORK_ITEMS_INTEGRATION in .env.' });
    }

    // Find the workflow's item_id
    const workflow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    // Get the latest backlog artifact for this item
    const artifact = db.prepare<[string], { file_path: string }>(`
      SELECT a.file_path
      FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'backlog'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(workflow.item_id);

    if (!artifact) return res.status(404).json({ error: 'No backlog artifact found for this workflow' });

    // Read and parse the backlog JSON
    const fs = require('fs');
    const content = fs.readFileSync(resolveArtifactPath(artifact.file_path), 'utf-8');
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    let backlog;
    try {
      backlog = JSON.parse(cleaned);
    } catch {
      return res.status(400).json({ error: 'Backlog artifact is not valid JSON' });
    }

    // Normalise all tiers into epic + features[] for downstream ADO push
    if (backlog?.story) {
      // Tier 1: single story → wrap in feature → wrap in epic
      backlog.epic = { title: backlog.story.title, description: backlog.story.goal || '' };
      backlog.features = [{ title: backlog.story.title, description: backlog.story.goal || '', phase: 'MVP', stories: [backlog.story] }];
      delete backlog.story;
    } else if (backlog?.feature) {
      // Tier 2: single feature → wrap in epic
      backlog.epic = { title: backlog.feature.title, description: backlog.feature.description || '' };
      backlog.features = [backlog.feature];
      delete backlog.feature;
    } else if (backlog?.epic && !backlog?.features && Array.isArray(backlog?.epic?.stories)) {
      // Legacy flat stories on epic → wrap in feature
      backlog.features = [{ title: backlog.epic.title, description: backlog.epic.description, phase: 'MVP', stories: backlog.epic.stories }];
    }

    if (!backlog?.epic || !Array.isArray(backlog?.features)) {
      return res.status(400).json({ error: 'Backlog JSON does not have a recognised structure (story, feature, or epic/features)' });
    }

    // Enrich epic and feature descriptions with PRD context
    const prdContent = loadPrdForItem(workflow.item_id);
    if (prdContent) {
      // Epic: Problem Statement + Success Metrics + Out of Scope
      const epicHtml = buildEpicEnrichment(prdContent);
      if (epicHtml) {
        backlog.epic.description = `${backlog.epic.description || ''}<hr>${epicHtml}`;
      }

      // Features: referenced FRs + referenced Key User Journeys
      for (const feature of backlog.features as any[]) {
        const frIds = new Set<string>();
        const journeyRefs = new Set<string>();
        for (const story of (feature.stories ?? []) as any[]) {
          for (const fr of (story.prdRef?.functionalRequirements ?? []) as string[]) frIds.add(fr);
          if (story.prdRef?.userJourney) journeyRefs.add(story.prdRef.userJourney as string);
        }
        const featureHtml = buildFeatureEnrichment(prdContent, frIds, journeyRefs);
        if (featureHtml) {
          feature.description = `${feature.description || ''}<hr>${featureHtml}`;
        }
      }
    }

    // Push to the configured provider
    if (appConfig.integrations.workItems === 'ado') {
      const { AzureDevOpsClient } = require('../integrations/azure-devops');
      const client = new AzureDevOpsClient();

      // Check for existing ADO mappings
      const existingMappings = db.prepare<[string], { local_key: string; ado_id: number; title: string }>(
        'SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ?'
      ).all(workflowId);

      // Find the latest backlog artifact ID for the mapping
      const artifactRow = db.prepare<[string], { id: number }>(`
        SELECT a.id FROM artifacts a
        JOIN sessions s ON a.session_id = s.id
        WHERE s.item_id = ? AND a.type = 'backlog'
        ORDER BY a.created_at DESC LIMIT 1
      `).get(workflow.item_id);
      const artifactId = artifactRow?.id ?? 0;

      if (existingMappings.length > 0) {
        // UPDATE path — diff-based sync
        const mapByKey = new Map(existingMappings.map(m => [m.local_key, m]));
        const updateResult = await client.updateBacklog(backlog, mapByKey);

        // Persist new mappings
        const insertMapping = db.prepare(`
          INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = Date.now();
        for (const m of updateResult.newMappings) {
          insertMapping.run(workflowId, artifactId, m.ado_id, m.ado_type, m.ado_url, m.local_key, m.title, now);
        }

        logger.info(`Synced backlog to ADO: ${updateResult.updated} updated, ${updateResult.created} created`);
        return res.json({
          epicId: updateResult.epicId,
          epicUrl: client.getEpicUrl(updateResult.epicId),
          created: updateResult.created,
          updated: updateResult.updated,
          synced: true,
        });
      }

      // CREATE path — first push
      const result = await client.createBacklog(backlog);
      const epicUrl = client.getEpicUrl(result.epicId);
      const extraEpicUrls = (result.extraEpicIds ?? []).map((id: number) => ({
        id,
        url: client.getEpicUrl(id),
      }));

      // Persist ADO mappings for future sync
      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();

      // Map epic
      insertMapping.run(workflowId, artifactId, result.epicId, 'epic', epicUrl, 'epic', backlog.epic.title, now);

      // Map features and stories
      let featureIdx = 0;
      let storyIdx = 0;
      for (let fi = 0; fi < backlog.features.length; fi++) {
        const featureKey = `F${fi + 1}`;
        const featureAdoId = result.featureIds[featureIdx++];
        insertMapping.run(workflowId, artifactId, featureAdoId, 'feature', client.getEpicUrl(featureAdoId), featureKey, backlog.features[fi].title, now);

        for (let si = 0; si < backlog.features[fi].stories.length; si++) {
          const storyKey = `${featureKey}.S${si + 1}`;
          const storyAdoId = result.storyIds[storyIdx++];
          insertMapping.run(workflowId, artifactId, storyAdoId, 'story', client.getEpicUrl(storyAdoId), storyKey, backlog.features[fi].stories[si].title, now);
        }
      }

      logger.info(`Pushed backlog to ADO: Epic #${result.epicId}${result.extraEpicIds?.length ? ` + ${result.extraEpicIds.length} phase epic(s)` : ''}, ${result.featureIds.length} features, ${result.storyIds.length} stories`);
      return res.json({
        epicId: result.epicId,
        epicUrl,
        extraEpics: extraEpicUrls,
        featureCount: result.featureIds.length,
        storyCount: result.storyIds.length,
      });
    }

    // For other providers (jira, etc.), use the generic WorkItemProvider interface
    // which creates items individually rather than as a batch
    return res.status(400).json({ error: `Push to board is not yet supported for provider: ${appConfig.integrations.workItems}` });
  } catch (err: any) {
    logger.error('Failed to push to board', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/push-to-test-plans ────────────────────────────────────

/**
 * POST /api/workflow/:id/push-to-test-plans
 * Pushes or syncs the approved QA test artifact to ADO Test Plans.
 * Creates one suite per test type; test cases are linked to their ADO story via TestedBy.
 * Subsequent pushes update existing test cases idempotently.
 */
workflowRoutes.post('/:id/push-to-test-plans', async (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const fs = require('fs');

  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems !== 'ado') {
      return res.status(400).json({ error: 'ADO work items integration is not configured.' });
    }

    const workflow = db.prepare<[string], { item_id: string; summary: string | null; goal: string }>(
      'SELECT item_id, summary, goal FROM workflows WHERE id = ?'
    ).get(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    // Load latest QA artifact
    const qaArtifact = db.prepare<[string], { file_path: string; id: number }>(`
      SELECT a.file_path, a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'qa_tests'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(workflow.item_id);
    if (!qaArtifact) return res.status(404).json({ error: 'No QA test artifact found for this workflow' });

    const raw = fs.readFileSync(resolveArtifactPath(qaArtifact.file_path), 'utf-8')
      .replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    let qa: any;
    try { qa = JSON.parse(raw); } catch {
      return res.status(400).json({ error: 'QA artifact is not valid JSON — retry the qa_engineer stage' });
    }

    const testCases = (qa.test_cases ?? []) as any[];
    if (testCases.length === 0) {
      return res.status(400).json({ error: 'No test cases found in QA artifact' });
    }

    // Build story map: local_key (F1.S1) → ado_id
    const storyMappings = db.prepare<[string], { local_key: string; ado_id: number }>(
      `SELECT local_key, ado_id FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story'`
    ).all(workflowId);
    const storyMap = new Map(storyMappings.map(m => [m.local_key, m.ado_id]));
    logger.info(`Story map for test plan linking: ${JSON.stringify(Array.from(storyMap.entries()))}`);

    // Log test case story references
    const testCaseRefs = testCases
      .filter(tc => tc.story_ref || tc.linkedStory)
      .map(tc => ({ id: tc.id, ref: tc.story_ref ?? tc.linkedStory }));
    logger.info(`Test cases with story references: ${JSON.stringify(testCaseRefs)}`);

    // Check for existing test plan mapping
    const existingMap = db.prepare<[string], { plan_id: number; plan_url: string; suite_ids: string; test_case_ids: string; root_suite_id?: number }>(
      'SELECT plan_id, plan_url, suite_ids, test_case_ids FROM qa_test_plan_map WHERE workflow_id = ?'
    ).get(workflowId);

    const existing = existingMap ? {
      planId: existingMap.plan_id,
      rootSuiteId: existingMap.root_suite_id,
      suiteIds: JSON.parse(existingMap.suite_ids ?? '{}'),
      testCaseIds: JSON.parse(existingMap.test_case_ids ?? '{}'),
    } : undefined;

    const planName = (workflow.summary ?? workflow.goal.split('\n')[0]).slice(0, 60);

    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();

    const result = await client.pushQATestPlan({ planName, testCases, storyMap, existing });

    // Persist the mapping
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO qa_test_plan_map
        (workflow_id, artifact_id, plan_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowId,
      qaArtifact.id,
      result.planId,
      result.planUrl,
      JSON.stringify(result.suiteIds),
      JSON.stringify(result.testCaseIds),
      testCases.length,
      now
    );

    insertEvent(workflowId, 'stage_progress', 'qa_engineer',
      `QA Test Plan synced to ADO — ${result.created} created, ${result.updated} updated\n→ ${result.planUrl}`,
      { plan_id: result.planId, plan_url: result.planUrl, created: result.created, updated: result.updated }
    );

    logger.info(`Test plan push complete for workflow ${workflowId}: ${result.created} created, ${result.updated} updated`);
    return res.json({
      planId: result.planId,
      planUrl: result.planUrl,
      created: result.created,
      updated: result.updated,
      testCaseCount: testCases.length,
    });
  } catch (err: any) {
    logger.error('Failed to push to test plans', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/sync-to-wiki ─────────────────────────────────────────

/**
 * POST /api/workflow/:id/sync-to-wiki
 * Manually sync research, PRD, and architecture documents to Azure DevOps Wiki.
 * Body: { stages?: string[] } - optional array of stages to sync ('analyst', 'pm_prd', 'solution_architect')
 * If not provided, syncs all three document types.
 */
workflowRoutes.post('/:id/sync-to-wiki', async (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const { stages } = req.body as { stages?: string[] };

  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems !== 'ado') {
      return res.status(400).json({ error: 'ADO integration not configured' });
    }

    const workflow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    const itemRow = db.prepare<[string], { title: string }>(
      'SELECT title FROM items WHERE id = ?'
    ).get(workflow.item_id);
    if (!itemRow) return res.status(404).json({ error: 'Item not found' });

    // Default to all three document stages
    const stagesToSync = stages ?? ['analyst', 'pm_prd', 'solution_architect'];
    const validStages = ['analyst', 'pm_prd', 'solution_architect'];
    for (const stage of stagesToSync) {
      if (!validStages.includes(stage)) {
        return res.status(400).json({ error: `Invalid stage: ${stage}. Must be one of: ${validStages.join(', ')}` });
      }
    }

    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();
    const wikiId = client.wikiIdentifier;
    const fs = require('fs');

    const results: Array<{ stage: string; pageName: string; url: string }> = [];

    // Sanitize feature name for wiki path
    const featureName = itemRow.title.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 50);

    for (const stage of stagesToSync) {
      const stageArtifactMap: Record<string, { type: string; pageName: string }> = {
        'analyst': { type: 'analyst', pageName: 'Research Brief' },
        'pm_prd': { type: 'prd', pageName: 'PRD' },
        'solution_architect': { type: 'architecture', pageName: 'Architecture' },
      };

      const config = stageArtifactMap[stage];
      if (!config) continue;

      // Load artifact
      const artifact = db.prepare<[string, string], { file_path: string }>(`
        SELECT a.file_path FROM artifacts a
        JOIN sessions s ON a.session_id = s.id
        WHERE s.item_id = ? AND a.type = ?
        ORDER BY a.created_at DESC LIMIT 1
      `).get(workflow.item_id, config.type);

      if (!artifact) {
        logger.warn(`Sync to wiki: no ${config.type} artifact for item ${workflow.item_id}`);
        continue;
      }

      const content = fs.readFileSync(resolveArtifactPath(artifact.file_path), 'utf-8')
        .replace(/^```(?:markdown|md)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

      // Wiki path: /Product Documentation/Features/{FeatureName}/{PageName}
      const wikiPath = `/Product Documentation/Features/${featureName}/${config.pageName}`;

      // Ensure parent folders exist
      await client.ensureWikiPath(wikiId, wikiPath);

      // Upsert wiki page
      const { url } = await client.upsertWikiPage(wikiId, wikiPath, content);

      results.push({ stage, pageName: config.pageName, url });
    }

    // Insert success event
    const summary = results.map(r => `${r.pageName}: ${r.url}`).join('\n');
    insertEvent(workflowId, 'stage_progress', null,
      `Wiki pages synced (${results.length})\n${summary}`,
      { synced_count: results.length, results }
    );

    logger.info(`Wiki sync complete for workflow ${workflowId}: ${results.length} pages`);
    return res.json({ synced: results.length, results });
  } catch (err: any) {
    logger.error('Failed to sync to wiki', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/workflow/:id/artifacts ─────────────────────────────────────────────

/**
 * GET /api/workflow/:id/artifacts
 * Returns all artifacts produced during this workflow, ordered by creation time.
 * Used to show an artifacts list in the pipeline terminal view.
 */
workflowRoutes.get('/:id/artifacts', (req: Request, res: Response) => {
  const workflowId = req.params.id;

  try {
    const workflow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    const artifacts = db.prepare<[string], { id: number; type: string; stage: string | null; created_at: number }>(`
      SELECT a.id, a.type, s.mode as stage, a.created_at
      FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ?
      AND a.type NOT IN ('critic_review', 'analyst_diff', 'pm_backlog_diff', 'prototype_diff', 'qa_engineer_diff')
      ORDER BY a.created_at
    `).all(workflow.item_id);

    res.json({ artifacts });
  } catch (err: any) {
    logger.error('Failed to fetch artifacts', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/workflow/:id ────────────────────────────────────────────────────

/**
 * DELETE /api/workflow/:id
 * Deletes a workflow and all associated data (checkpoints, events, etc.).
 */
workflowRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteWorkflow(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to delete workflow', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Mid-workflow conversation (Phase 3) ────────────────────────────────────────

/**
 * POST /api/workflow/:id/message
 * User sends a message to the CoS while a workflow is running.
 * CoS receives the message with workflow context and can answer status questions,
 * accept corrections, and store user input as an event.
 */
workflowRoutes.post('/:id/message', async (req: Request, res: Response) => {
  const { message, model } = req.body as { message?: string; model?: string };
  if (!message) return res.status(400).json({ error: 'message is required' });

  const workflowId = req.params.id;

  try {
    const status = getWorkflowStatus(workflowId);
    if (!status) return res.status(404).json({ error: 'Workflow not found' });

    // Store user input as an event
    const { getWorkflowEvents: getEvents } = require('../agents/workflow-router');
    const events = getEvents(workflowId) as Array<{ summary: string; event_type: string; stage: string | null }>;

    // Insert user message event
    db.prepare(`
      INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
      VALUES (?, 'user_input', ?, ?, NULL, ?)
    `).run(workflowId, status.currentStage, message, Date.now());

    // Stream CoS response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const coordinator = getPlanningCoordinator();
    const systemPrompt = coordinator.buildSystemPrompt(workflowId);

    // Build context from recent events
    const recentEvents = events.slice(-10).map((e: { event_type: string; stage: string | null; summary: string }) =>
      `[${e.event_type}${e.stage ? ` / ${e.stage}` : ''}] ${e.summary}`
    ).join('\n');

    const contextMessage = `You are the Chief of Staff. The user is talking to you during an active workflow.\n\nRecent workflow events:\n${recentEvents}\n\nUser message: ${message}\n\nRespond helpfully. If the user provides corrections or preferences, acknowledge them and note that they'll be applied to upcoming stages.`;

    let fullContent = '';
    try {
      for await (const chunk of coordinator.streamResponse(workflowId, contextMessage, model, costTracker(workflowId))) {
        fullContent += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }

      // Store CoS response as event
      db.prepare(`
        INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
        VALUES (?, 'cos_response', ?, ?, NULL, ?)
      `).run(workflowId, status.currentStage, fullContent.slice(0, 500), Date.now());

      res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  } catch (err: any) {
    if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to handle mid-workflow message', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Artifact content ──────────────────────────────────────────────────────────

/**
 * GET /api/workflow/artifact/:id/content
 * Returns the text content of an artifact file by artifact DB id.
 */
workflowRoutes.get('/artifact/:id/content', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid artifact id' });

  const row = db.prepare<[number], { file_path: string; type: string }>(
    'SELECT file_path, type FROM artifacts WHERE id = ?'
  ).get(id);

  if (!row) return res.status(404).json({ error: 'Artifact not found' });

  try {
    const content = require('fs').readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
    res.json({ content, type: row.type });
  } catch {
    res.status(404).json({ error: 'Artifact file not found on disk' });
  }
});

/**
 * PUT /api/workflow/artifact/:id/content
 * Overwrites artifact content on disk. Logs a human_edit workflow event so
 * downstream agents are aware of the change. Optionally auto-resolves a
 * pending checkpoint as approved, advancing the workflow.
 *
 * Body: { content: string, checkpointId?: number }
 */
workflowRoutes.put('/artifact/:id/content', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid artifact id' });

  const { content, checkpointId } = req.body as { content?: string; checkpointId?: number };
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }

  // Validate JSON for backlog/prototype artifacts
  const row = db.prepare<[number], { file_path: string; type: string }>(
    'SELECT file_path, type FROM artifacts WHERE id = ?'
  ).get(id);
  if (!row) return res.status(404).json({ error: 'Artifact not found' });

  if (row.type === 'backlog' || row.type === 'prototype') {
    try {
      JSON.parse(content);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON — fix syntax errors before saving' });
    }
  }

  // Write content to disk
  const fs = require('fs');
  const resolvedPath = resolveArtifactPath(row.file_path);
  try {
    fs.writeFileSync(resolvedPath, content, 'utf-8');
  } catch (err: any) {
    logger.error(`Failed to write artifact ${id}: ${err.message}`);
    return res.status(500).json({ error: `Failed to save: ${err.message}` });
  }

  // Log a workflow event so agents are aware of the human edit
  // Find the workflow via the checkpoint or artifact's session
  let workflowId: string | null = null;
  let stage: string | null = null;

  if (checkpointId) {
    const cp = db.prepare<[number], { workflow_id: string; stage: string }>(
      'SELECT workflow_id, stage FROM checkpoints WHERE id = ?'
    ).get(checkpointId);
    if (cp) { workflowId = cp.workflow_id; stage = cp.stage; }
  }

  if (!workflowId) {
    // Fall back: find workflow via artifact → session → workflow
    const wfRow = db.prepare<[number], { workflow_id: string; stage: string }>(`
      SELECT s.workflow_id, a.type as stage FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.id = ? AND s.workflow_id IS NOT NULL
    `).get(id);
    if (wfRow) { workflowId = wfRow.workflow_id; stage = wfRow.stage; }
  }

  if (workflowId) {
    insertEvent(workflowId, 'human_edit', stage,
      'Human edited artifact directly.',
      { artifact_id: id, artifact_type: row.type });
  }

  // If a checkpoint was provided, auto-resolve as approved and advance
  if (checkpointId && workflowId) {
    try {
      resolveCheckpoint(checkpointId, 'approved', 'Human edited artifact directly');

      // Advance to next stage (same pattern as checkpoint/resolve endpoint)
      advanceStage(workflowId)
        .then(result => {
          logger.info(`Stage advanced to "${result.stage}" after human edit on workflow ${workflowId}`);
        })
        .catch(err => {
          if (err.message?.startsWith('WORKFLOW_COMPLETE:')) {
            logger.info(`Workflow ${workflowId} complete after human edit approval`);
          } else {
            logger.error(`advanceStage failed after human edit: ${err.message}`);
          }
        });

      const workflowStatus = getWorkflowStatus(workflowId);
      return res.json({ ok: true, workflowStatus });
    } catch (err: any) {
      // Checkpoint resolve failed — content was already saved, just warn
      logger.warn(`Checkpoint resolve after human edit failed: ${err.message}`);
      return res.json({ ok: true, warning: `Saved but checkpoint resolve failed: ${err.message}` });
    }
  }

  res.json({ ok: true });
});

interface ArtifactRow {
  id: number;
  type: string;
  file_path: string;
  created_at: number;
}

/**
 * GET /api/workflow/:id/status
 * Returns workflow row + stage summary (currentStage, completedStages, pendingStage).
 */
workflowRoutes.get('/:id/status', (req: Request, res: Response) => {
  try {
    const status = getWorkflowStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to get workflow status', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/:id/events?since=<id>
 * Returns workflow events after the given ID (or all events if omitted).
 */
workflowRoutes.get('/:id/events', (req: Request, res: Response) => {
  try {
    const sinceId = req.query.since ? parseInt(String(req.query.since), 10) : undefined;
    const events = getWorkflowEvents(req.params.id, sinceId);
    res.json({ events });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to get workflow events', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/list
 * Returns all workflows ordered by created_at DESC, for the workflow history sidebar.
 */
workflowRoutes.get('/list/all', (_req: Request, res: Response) => {
  try {
    const workflows = db.prepare(`
      SELECT w.*, COUNT(c.id) as checkpoint_count
      FROM workflows w
      LEFT JOIN checkpoints c ON c.workflow_id = w.id AND c.status = 'approved'
      GROUP BY w.id
      ORDER BY w.created_at DESC
      LIMIT 50
    `).all();
    res.json({ workflows });
  } catch (err: any) {
    logger.error('Failed to list workflows', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/:id/checkpoints
 * Returns all checkpoints for the workflow, each enriched with artifact metadata
 * when artifact_id is present.
 */
// Pipeline demo data — QA test cases + workflow summary for the pipeline status panel
workflowRoutes.get('/:id/pipeline-demo', (req: Request, res: Response) => {
  const fs = require('fs') as typeof import('fs');
  const { id } = req.params;
  try {
    const wf = db.prepare<[string], { goal: string; summary: string | null }>(
      'SELECT goal, summary FROM workflows WHERE id = ?'
    ).get(id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });

    const artifact = db.prepare<[string], { file_path: string }>(
      `SELECT a.file_path FROM artifacts a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.workflow_id = ? AND a.type = 'qa_tests'
       ORDER BY a.created_at DESC LIMIT 1`
    ).get(id);

    let testCases: unknown[] = [];
    if (artifact?.file_path && fs.existsSync(artifact.file_path)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(artifact.file_path, 'utf-8'));
        testCases = parsed.test_cases ?? [];
      } catch { /* use empty */ }
    }

    res.json({
      summary: wf.summary ?? wf.goal.split('\n')[0].slice(0, 80),
      testCases,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

workflowRoutes.get('/:id/checkpoints', (req: Request, res: Response) => {
  try {
    const { checkpoints } = getWorkflowStatus(req.params.id);

    // Enrich checkpoints that have an artifact_id with file metadata
    const enriched = checkpoints.map(cp => {
      if (!cp.artifact_id) return { ...cp, artifact: null };
      const artifact = db
        .prepare<[number], ArtifactRow>('SELECT id, type, file_path, created_at FROM artifacts WHERE id = ?')
        .get(cp.artifact_id);
      return { ...cp, artifact: artifact ?? null };
    });

    res.json({ checkpoints: enriched });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to get checkpoints', err);
    res.status(500).json({ error: err.message });
  }
});
