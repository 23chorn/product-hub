/**
 * workflow-query-routes — read-only workflow query endpoints (status, events,
 * list, checkpoints, audit, pending counts, pipeline demo data). Mounted at
 * /api/workflow. These are pure reads with no streaming or mutation.
 */
import { Router, Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { getWorkflowStatus, getWorkflowEvents } from '../agents/workflow-router';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('WORKFLOW-QUERY-ROUTES');
export const workflowQueryRoutes = Router();

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
workflowQueryRoutes.get('/:id/status', (req: Request, res: Response) => {
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
workflowQueryRoutes.get('/:id/events', (req: Request, res: Response) => {
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
workflowQueryRoutes.get('/list/all', (req: AuthRequest, res: Response) => {
  try {
    const { needs_approval } = req.query as { needs_approval?: string };

    if (needs_approval === 'true' && req.user) {
      // Return only workflows with a pending checkpoint that this user's roles can approve
      const roleList = req.user.is_admin
        ? null  // admin sees all pending checkpoints
        : req.user.roles;

      let workflows;
      if (req.user.is_admin || !roleList?.length) {
        workflows = db.prepare(`
          SELECT DISTINCT w.*, COUNT(approved.id) as checkpoint_count
          FROM workflows w
          JOIN checkpoints c ON c.workflow_id = w.id AND c.status = 'pending'
          LEFT JOIN checkpoints approved ON approved.workflow_id = w.id AND approved.status = 'approved'
          GROUP BY w.id
          ORDER BY w.created_at DESC
          LIMIT 50
        `).all();
      } else {
        const placeholders = roleList.map(() => '?').join(',');
        workflows = db.prepare(`
          SELECT DISTINCT w.*, COUNT(approved.id) as checkpoint_count
          FROM workflows w
          JOIN checkpoints c ON c.workflow_id = w.id AND c.status = 'pending'
            AND (c.required_role IS NULL OR c.required_role IN (${placeholders}))
          LEFT JOIN checkpoints approved ON approved.workflow_id = w.id AND approved.status = 'approved'
          GROUP BY w.id
          ORDER BY w.created_at DESC
          LIMIT 50
        `).all(...roleList);
      }
      return res.json({ workflows });
    }

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

// Pipeline demo data — QA test cases + workflow summary for the pipeline status panel
workflowQueryRoutes.get('/:id/pipeline-demo', (req: Request, res: Response) => {
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

/**
 * GET /api/workflow/:id/checkpoints
 * Returns all checkpoints for the workflow, each enriched with artifact metadata
 * when artifact_id is present.
 */
workflowQueryRoutes.get('/:id/checkpoints', (req: Request, res: Response) => {
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

/** GET /api/workflow/:id/audit — approval audit trail */
workflowQueryRoutes.get('/:id/audit', (req: Request, res: Response) => {
  try {
    const rows = db.prepare<[string], {
      id: number; checkpoint_id: number; stage: string;
      user_name: string; user_email: string; action: string;
      notes: string | null; created_at: number;
    }>(`
      SELECT ca.id, ca.checkpoint_id, c.stage, ca.user_name, ca.user_email, ca.action, ca.notes, ca.created_at
      FROM checkpoint_audit ca
      JOIN checkpoints c ON c.id = ca.checkpoint_id
      WHERE c.workflow_id = ?
      ORDER BY ca.created_at ASC
    `).all(req.params.id);
    res.json({ audit: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/workflow/my-pending-count — count of pending checkpoints the current user can approve */
workflowQueryRoutes.get('/my-pending-count', (req: AuthRequest, res: Response) => {
  if (!req.user) return res.json({ count: 0 });
  try {
    let count: number;
    if (req.user.is_admin) {
      const row = db.prepare<[], { count: number }>(
        `SELECT COUNT(DISTINCT workflow_id) as count FROM checkpoints WHERE status = 'pending'`
      ).get();
      count = row?.count ?? 0;
    } else {
      const roles = req.user.roles;
      if (!roles.length) return res.json({ count: 0 });
      const placeholders = roles.map(() => '?').join(',');
      const row = db.prepare<string[], { count: number }>(
        `SELECT COUNT(DISTINCT workflow_id) as count FROM checkpoints
         WHERE status = 'pending' AND (required_role IS NULL OR required_role IN (${placeholders}))`
      ).get(...roles);
      count = row?.count ?? 0;
    }
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
