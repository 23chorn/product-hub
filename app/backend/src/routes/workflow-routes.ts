import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { canApproveCheckpoint } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
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
  deleteWorkflow,
  costTracker,
} from '../agents/workflow-router';
import { requestCancel } from '../agents/workflow-stage-runner';
import {
  linkCRArtifactVersion,
  completeChangeRequest,
  type ChangeRequestRow,
} from '../agents/change-request';
import db from '../data/database';
import { insertEvent } from '../agents/workflow-db';
import { resolveArtifactPath, loadArtifactContentById, updateArtifactContent, syncArtifactToWiki } from '../agents/artifact-helpers';
import Logger from '../utils/logger';
import { isDemoMode } from '../demo/demo-mode';
import {
  DEFAULT_STAGES,
  KNOWN_STAGES,
  consumePlanningCost,
  getPlanningCoordinator,
} from './workflow-planning';

const logger = new Logger('WORKFLOW-ROUTES-V2');
export const workflowRoutes = Router();

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
  let { itemId, goal, enrichedContext, stageSequence, policyOverrides, planningSessionId, kbQueries, productArea } = req.body as {
    itemId?: string;
    goal?: string;
    enrichedContext?: string;
    stageSequence?: string[];
    policyOverrides?: Record<string, string>;
    planningSessionId?: string;
    kbQueries?: string[];
    productArea?: string;
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
    const metadata = productArea ? JSON.stringify({ productArea }) : null;
    db.prepare(`
      INSERT INTO items (id, type, title, description, status, source, airtable_id, metadata, created_at, updated_at)
      VALUES (?, 'initiative', ?, ?, 'active', 'local', NULL, ?, ?, ?)
    `).run(id, title, goal.slice(0, 500), metadata, now, now);
    itemId = id;
    logger.info(`Auto-created local item ${id} for workflow`);
  } else {
    const existing = db.prepare('SELECT id, metadata FROM items WHERE id = ?').get(itemId) as { id: string; metadata: string | null } | undefined;
    if (!existing) {
      const now = Date.now();
      const title = goal.slice(0, 100) + (goal.length > 100 ? '...' : '');
      const metadata = productArea ? JSON.stringify({ productArea }) : null;
      db.prepare(`
        INSERT INTO items (id, type, title, description, status, source, airtable_id, metadata, created_at, updated_at)
        VALUES (?, 'initiative', ?, ?, 'active', 'airtable', ?, ?, ?, ?)
      `).run(itemId, title, goal.slice(0, 500), itemId, metadata, now, now);
      logger.info(`Created shadow item ${itemId} for Airtable initiative`);
    } else if (productArea && !existing.metadata) {
      // Backfill productArea onto existing items that didn't have it
      db.prepare('UPDATE items SET metadata = ? WHERE id = ?')
        .run(JSON.stringify({ productArea }), itemId);
    }
  }

  try {
    // Use caller-supplied sequence if valid, otherwise the fixed default
    let stages = (stageSequence && Array.isArray(stageSequence) && stageSequence.length > 0)
      ? stageSequence
      : DEFAULT_STAGES;

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
      const planCost = consumePlanningCost(planningSessionId);
      if (planCost > 0) {
        costTracker(workflow.id)({ model: 'coordinator', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, searchCount: 0, estimatedCost: planCost });
      }
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
workflowRoutes.post('/checkpoint/resolve', async (req: AuthRequest, res: Response) => {
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
    // Peek at checkpoint to get workflowId + required_role before resolving
    const cpRow = db.prepare<[number], { workflow_id: string; required_role: string | null; status: string }>(
      'SELECT workflow_id, required_role, status FROM checkpoints WHERE id = ?'
    ).get(cpId);
    if (!cpRow) return res.status(404).json({ error: `Checkpoint not found: ${cpId}` });
    if (cpRow.status !== 'pending') return res.status(409).json({ error: 'Checkpoint is not pending' });
    const workflowId = cpRow.workflow_id;

    // Role-based permission check
    if (!canApproveCheckpoint(req.user, cpRow.required_role)) {
      return res.status(403).json({
        error: `This stage requires the "${cpRow.required_role}" role to approve`,
        required_role: cpRow.required_role,
        code: 'INSUFFICIENT_ROLE',
      });
    }

    // Record audit entry
    const auditor = req.user
      ? { id: req.user.id, name: req.user.name, username: req.user.username }
      : { id: null, name: 'System', username: 'system' };

    db.prepare(`
      INSERT INTO checkpoint_audit (checkpoint_id, user_id, user_name, user_email, action, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(cpId, auditor.id, auditor.name, auditor.username, status, feedback ?? null, Date.now());

    // Stamp resolver on the checkpoint row
    if (req.user) {
      db.prepare('UPDATE checkpoints SET resolved_by_user_id = ? WHERE id = ?').run(req.user.id, cpId);
    }

    if (status === 'approved') {
      // Read checkpoint stage + artifact before resolving
      const cpDetail = db.prepare<[number], { stage: string; artifact_id: number | null }>(
        'SELECT stage, artifact_id FROM checkpoints WHERE id = ?'
      ).get(cpId);

      resolveCheckpoint(cpId, 'approved', feedback);

      // Fetch itemId once — needed by story_decomposition and qa_engineer pushes
      const wfRow = db.prepare<[string], { item_id: string }>(
        'SELECT item_id FROM workflows WHERE id = ?'
      ).get(workflowId);
      const itemId = wfRow?.item_id ?? '';

      // Stamp the ADO URL back onto the artifact row so artifact → ADO is directly traceable
      const stampArtifactUrl = (url: string) => {
        if (cpDetail?.artifact_id) {
          db.prepare('UPDATE artifacts SET external_url = ? WHERE id = ?')
            .run(url, cpDetail.artifact_id);
        }
      };

      // ── epic_feature_planner: push epic + feature shells, then inject sub-stages ──
      if (cpDetail && cpDetail.stage === 'epic_feature_planner') {
        try {
          const { appConfig } = require('../config/app-config');
          if (appConfig.integrations.workItems === 'ado') {
            const { pushEpicAndFeaturesToADO } = await import('../agents/feature-decomposition');
            const result = await pushEpicAndFeaturesToADO(workflowId);
            const { AzureDevOpsClient } = await import('../integrations/azure-devops');
            const client = new AzureDevOpsClient();
            const epicUrl = client.getEpicUrl(result.epicId);
            stampArtifactUrl(epicUrl);
            insertEvent(workflowId, 'ado_pushed', 'epic_feature_planner',
              `Epic & ${result.featureIds.length} features pushed to Azure DevOps`,
              { ado_url: epicUrl });
            logger.info(`[CHECKPOINT] epic_feature_planner → pushed epic #${result.epicId} + ${result.featureIds.length} features to ADO`);
          }
        } catch (err: any) {
          logger.error(`[CHECKPOINT] Failed to push epic to ADO: ${err.message}`);
        }

        const { injectFeatureDecompositionStages } = await import('../agents/feature-decomposition');
        try {
          const featureCount = await injectFeatureDecompositionStages(workflowId);
          logger.info(`[CHECKPOINT] epic_feature_planner approved → injected ${featureCount} feature stages`);
        } catch (err: any) {
          logger.error(`[CHECKPOINT] Failed to inject feature stages: ${err.message}`);
        }
      }

      // ── story_decomposition: push full backlog to ADO Boards ───────────────────
      if (cpDetail && cpDetail.stage === 'story_decomposition') {
        try {
          const { pushBacklogToAdo } = await import('../agents/ado-stage-push');
          const epicUrl = await pushBacklogToAdo(workflowId, itemId);
          if (epicUrl) {
            stampArtifactUrl(epicUrl);
            insertEvent(workflowId, 'ado_pushed', 'story_decomposition',
              'Backlog pushed to Azure DevOps',
              { ado_url: epicUrl });
            logger.info(`[CHECKPOINT] story_decomposition → pushed backlog to ADO: ${epicUrl}`);
          }
        } catch (err: any) {
          logger.error(`[CHECKPOINT] story_decomposition ADO push failed: ${err.message}`);
        }
      }

      // ── qa_engineer: push test plan to ADO Test Plans ─────────────────────────
      if (cpDetail && (cpDetail.stage === 'qa_engineer' || /^qa_engineer_F\d+$/.test(cpDetail.stage))) {
        try {
          const { pushTestPlanToAdo } = await import('../agents/ado-stage-push');
          const testPlanUrl = await pushTestPlanToAdo(workflowId, itemId);
          if (testPlanUrl) {
            stampArtifactUrl(testPlanUrl);
            insertEvent(workflowId, 'ado_pushed', cpDetail.stage,
              'QA test plan pushed to Azure DevOps',
              { ado_url: testPlanUrl });
            logger.info(`[CHECKPOINT] ${cpDetail.stage} → pushed test plan to ADO: ${testPlanUrl}`);
          }
        } catch (err: any) {
          logger.error(`[CHECKPOINT] ${cpDetail.stage} ADO push failed: ${err.message}`);
        }
      }

      // ── story_decomposition_F*: push stories + test cases to ADO ──────────────
      if (cpDetail && cpDetail.stage.startsWith('story_decomposition_F')) {
        const { parseFeatureStage, pushFeatureToADO } = await import('../agents/feature-decomposition');
        const featureIndex = parseFeatureStage(cpDetail.stage);

        if (featureIndex !== null) {
          try {
            const { appConfig } = require('../config/app-config');
            if (appConfig.integrations.workItems === 'ado') {
              const result = await pushFeatureToADO(workflowId, featureIndex);
              const { AzureDevOpsClient } = await import('../integrations/azure-devops');
              const client = new AzureDevOpsClient();
              const featureUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${result.featureId}`;
              const testPlanUrl = result.testPlanUrl ?? null;
              stampArtifactUrl(featureUrl);
              const eventMeta: Record<string, any> = { feature_url: featureUrl };
              if (testPlanUrl) eventMeta.test_plan_url = testPlanUrl;
              insertEvent(workflowId, 'ado_pushed', cpDetail.stage,
                `Feature ${featureIndex + 1} stories & test cases pushed to Azure DevOps`,
                eventMeta);
              logger.info(`[CHECKPOINT] Feature ${featureIndex + 1} approved → pushed to ADO: epic #${result.epicId}, feature #${result.featureId}, ${result.storyIds.length} stories`);
            }
          } catch (err: any) {
            logger.error(`[CHECKPOINT] Failed to push feature to ADO: ${err.message}`);
          }
        }
      }

      // ── Wiki-backed stages: sync artifact to Azure Wiki on first approval ────
      const isAdoHandledStage =
        cpDetail?.stage === 'epic_feature_planner' ||
        /^story_decomposition_F\d+$/.test(cpDetail?.stage ?? '');

      if (cpDetail && cpDetail.artifact_id && !isAdoHandledStage) {
        try {
          const { appConfig } = require('../config/app-config');
          if (appConfig.integrations.workItems === 'ado') {
            const wikiUrl = await syncArtifactToWiki(cpDetail.artifact_id);
            stampArtifactUrl(wikiUrl);
            insertEvent(workflowId, 'wiki_synced', cpDetail.stage,
              'Artifact synced to Azure Wiki',
              { wiki_url: wikiUrl });
            logger.info(`[CHECKPOINT] ${cpDetail.stage} → synced artifact to wiki: ${wikiUrl}`);
          }
        } catch (err: any) {
          logger.warn(`[CHECKPOINT] Wiki sync failed for ${cpDetail.stage}: ${err.message}`);
        }
      }

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
      AND a.type != 'critic_review'
      AND a.type NOT LIKE '%_diff'
      AND a.type != 'epic_features_enriched'
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
 * Returns the text content of an artifact. For externally stored artifacts, fetches
 * from the Azure Wiki using the stored external_path reference.
 */
workflowRoutes.get('/artifact/:id/content', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid artifact id' });

  const row = db.prepare<[number], { type: string }>(
    'SELECT type FROM artifacts WHERE id = ?'
  ).get(id);

  if (!row) return res.status(404).json({ error: 'Artifact not found' });

  try {
    const content = await loadArtifactContentById(id);
    if (content === null) return res.status(404).json({ error: 'Artifact content not found' });
    res.json({ content, type: row.type });
  } catch (err: any) {
    logger.error(`Failed to load artifact ${id}: ${err.message}`);
    res.status(500).json({ error: err.message });
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
  const row = db.prepare<[number], { type: string }>(
    'SELECT type FROM artifacts WHERE id = ?'
  ).get(id);
  if (!row) return res.status(404).json({ error: 'Artifact not found' });

  if (row.type === 'backlog' || row.type === 'prototype') {
    try {
      JSON.parse(content);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON — fix syntax errors before saving' });
    }
  }

  // Save content — pushes to wiki for externally stored artifacts, writes to disk otherwise
  try {
    await updateArtifactContent(id, content);
  } catch (err: any) {
    logger.error(`Failed to save artifact ${id}: ${err.message}`);
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
