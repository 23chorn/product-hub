/**
 * Epic 4 — New API Routes
 *
 * Story 4.1: POST /api/workflow/start           — SSE streaming workflow creation
 * Story 4.2: POST /api/workflow/checkpoint/resolve — approve / reject / revise a checkpoint
 * Story 4.3: GET  /api/workflow/:id/status       — workflow status
 *            GET  /api/workflow/:id/checkpoints  — checkpoints with artifact metadata
 */

import { Router, Request, Response } from 'express';
import {
  createWorkflow,
  advanceStage,
  completeStage,
  resolveCheckpoint,
  getWorkflowStatus,
  propagateFeedback,
  markWorkflowComplete,
} from '../agents/workflow-router';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('WORKFLOW-ROUTES-V2');

const KNOWN_STAGES = new Set(['analyst', 'pm_prd', 'pm_backlog', 'critic', 'curator']);

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

const DEFAULT_STAGES = ['analyst', 'pm_prd', 'pm_backlog', 'critic', 'curator'];

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
  const { itemId, goal, stageSequence, policyOverrides } = req.body as {
    itemId?: string;
    goal?: string;
    stageSequence?: string[];
    policyOverrides?: Record<string, string>;
  };

  if (!itemId || !goal) {
    return res.status(400).json({ error: 'itemId and goal are required' });
  }

  try {
    // Use caller-supplied sequence if valid, otherwise the fixed default
    const stages = (stageSequence && Array.isArray(stageSequence) && stageSequence.length > 0)
      ? stageSequence
      : DEFAULT_STAGES;

    const workflow = createWorkflow(itemId, goal, stages, policyOverrides);

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
    res.status(500).json({ error: err.message });
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

// ── Story 4.2: POST /api/workflow/checkpoint/resolve ──────────────────────────

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
  const { checkpointId, status, feedback } = req.body as {
    checkpointId?: number;
    status?: 'approved' | 'rejected' | 'revised';
    feedback?: string;
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
      resolveCheckpoint(cpId, 'approved', feedback);

      let nextStage: string | null = null;
      let nextSessionId: string | null = null;
      let complete = false;

      try {
        const result = await advanceStage(workflowId);
        nextStage = result.stage;
        nextSessionId = result.sessionId;
      } catch (err: any) {
        if (err.message.startsWith('WORKFLOW_COMPLETE:')) {
          complete = true;
        } else {
          throw err;
        }
      }

      const workflowStatus = getWorkflowStatus(workflowId);
      return res.json({ workflow: workflowStatus, nextStage, nextSessionId, complete });
    }

    if (status === 'rejected') {
      resolveCheckpoint(cpId, 'rejected', feedback);
      markWorkflowComplete(workflowId);
      const workflowStatus = getWorkflowStatus(workflowId);
      return res.json({ workflow: workflowStatus, complete: true });
    }

    // revised
    if (!feedback) return res.status(400).json({ error: 'feedback is required for revised status' });
    propagateFeedback(cpId, feedback);
    const workflowStatus = getWorkflowStatus(workflowId);
    return res.json({ workflow: workflowStatus });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to resolve checkpoint', err);
    res.status(400).json({ error: err.message });
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
    const content = require('fs').readFileSync(row.file_path, 'utf-8');
    res.json({ content, type: row.type });
  } catch {
    res.status(404).json({ error: 'Artifact file not found on disk' });
  }
});

// ── Story 4.3: Read-only workflow status routes ───────────────────────────────

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
 * GET /api/workflow/:id/checkpoints
 * Returns all checkpoints for the workflow, each enriched with artifact metadata
 * when artifact_id is present.
 */
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
