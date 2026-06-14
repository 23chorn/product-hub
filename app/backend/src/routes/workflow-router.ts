import { Router, Request, Response } from 'express';
import {
  createWorkflow,
  advanceStage,
  pauseAtCheckpoint,
  resolveCheckpoint,
  getWorkflowStatus,
} from '../agents/workflow-router';
import { propagateFeedback } from '../agents/workflow-mutations';
import Logger from '../utils/logger';

const logger = new Logger('WORKFLOW-ROUTES');
export const workflowRouter = Router();

/**
 * POST /api/workflows
 * Create a new workflow for an item.
 * Body: { itemId, goal, stageSequence, policyOverrides? }
 */
workflowRouter.post('/', (req: Request, res: Response) => {
  const { itemId, goal, stageSequence, policyOverrides } = req.body as {
    itemId?: string;
    goal?: string;
    stageSequence?: string[];
    policyOverrides?: Record<string, string>;
  };

  if (!itemId || !goal) {
    return res.status(400).json({ error: 'itemId and goal are required' });
  }

  const sequence = stageSequence ?? ['analyst', 'pm_prd', 'epic_feature_planner', 'story_decomposition', 'critic', 'curator'];

  try {
    const workflow = createWorkflow(itemId, goal, sequence, policyOverrides);
    res.status(201).json(workflow);
  } catch (err: any) {
    logger.error('Failed to create workflow', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:id
 * Get full workflow status including checkpoints.
 */
workflowRouter.get('/:id', (req: Request, res: Response) => {
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
 * POST /api/workflows/:id/advance
 * Advance the workflow to the next stage.
 */
workflowRouter.post('/:id/advance', async (req: Request, res: Response) => {
  try {
    const { stage, sessionId } = await advanceStage(req.params.id);
    res.json({ stage, sessionId });
  } catch (err: any) {
    if (err.message.startsWith('WORKFLOW_COMPLETE:')) {
      return res.json({ complete: true });
    }
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to advance stage', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/workflows/:id/pause
 * Manually pause a workflow at a checkpoint.
 * Body: { stage, artifactId? }
 */
workflowRouter.post('/:id/pause', (req: Request, res: Response) => {
  const { stage, artifactId } = req.body as { stage?: string; artifactId?: number };
  if (!stage) return res.status(400).json({ error: 'stage is required' });

  try {
    const checkpoint = pauseAtCheckpoint(req.params.id, stage, artifactId);
    res.json(checkpoint);
  } catch (err: any) {
    logger.error('Failed to pause workflow', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/workflows/checkpoints/:checkpointId
 * Resolve a checkpoint.
 * Body: { status: 'approved'|'rejected'|'revised', feedback? }
 */
workflowRouter.patch('/checkpoints/:checkpointId', (req: Request, res: Response) => {
  const checkpointId = parseInt(req.params.checkpointId, 10);
  if (isNaN(checkpointId)) return res.status(400).json({ error: 'Invalid checkpoint ID' });

  const { status, feedback } = req.body as {
    status?: 'approved' | 'rejected' | 'revised';
    feedback?: string;
  };

  if (!status || !['approved', 'rejected', 'revised'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or revised' });
  }

  try {
    resolveCheckpoint(checkpointId, status, feedback);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to resolve checkpoint', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/workflows/checkpoints/:checkpointId/feedback
 * Propagate human feedback to the specialist session and mark checkpoint revised.
 * Body: { feedback }
 */
workflowRouter.post('/checkpoints/:checkpointId/feedback', (req: Request, res: Response) => {
  const checkpointId = parseInt(req.params.checkpointId, 10);
  if (isNaN(checkpointId)) return res.status(400).json({ error: 'Invalid checkpoint ID' });

  const { feedback } = req.body as { feedback?: string };
  if (!feedback) return res.status(400).json({ error: 'feedback is required' });

  try {
    propagateFeedback(checkpointId, feedback);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to propagate feedback', err);
    res.status(500).json({ error: err.message });
  }
});
