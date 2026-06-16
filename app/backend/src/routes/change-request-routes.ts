import { Router, Request, Response } from 'express';
import { initSSE, sseSend } from '../utils/sse';
import {
  createChangeRequest,
  getChangeRequest,
  listChangeRequests,
  cancelChangeRequest,
  assessImpact,
  executeChangeRequest,
} from '../agents/change-request';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('CR-ROUTES');

export const changeRequestRoutes = Router();

/**
 * POST /api/workflow/:id/change-request
 * Create a new change request for a completed workflow.
 * Body: { type, description }
 */
changeRequestRoutes.post('/workflow/:id/change-request', (req: Request, res: Response) => {
  const { type, description } = req.body as { type?: string; description?: string };
  if (!type || !description) {
    return res.status(400).json({ error: 'type and description are required' });
  }

  try {
    const cr = createChangeRequest(req.params.id, type, description);
    res.json(cr);
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to create change request', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/:id/change-requests
 * List all change requests for a workflow.
 */
changeRequestRoutes.get('/workflow/:id/change-requests', (req: Request, res: Response) => {
  try {
    const crs = listChangeRequests(req.params.id);
    res.json({ changeRequests: crs });
  } catch (err: any) {
    logger.error('Failed to list change requests', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/change-request/:crId
 * Get a single change request with its assessment.
 */
changeRequestRoutes.get('/change-request/:crId', (req: Request, res: Response) => {
  const crId = parseInt(req.params.crId, 10);
  if (isNaN(crId)) return res.status(400).json({ error: 'Invalid CR id' });

  const cr = getChangeRequest(crId);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  res.json(cr);
});

/**
 * POST /api/change-request/:crId/assess
 * Trigger impact assessment via the Coordinator. Returns SSE stream.
 */
changeRequestRoutes.post('/change-request/:crId/assess', async (req: Request, res: Response) => {
  const crId = parseInt(req.params.crId, 10);
  if (isNaN(crId)) return res.status(400).json({ error: 'Invalid CR id' });

  const cr = getChangeRequest(crId);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });

  initSSE(res);

  try {
    const generator = assessImpact(crId);
    let assessment: { affected_stages: string[]; summary: string; cleanedText: string } | undefined;

    while (true) {
      const result = await generator.next();
      if (result.done) {
        assessment = result.value;
        break;
      }
      sseSend(res, { type: 'content', content: result.value });
    }

    // Replace the streamed content with the cleaned version (JSON stripped)
    if (assessment?.cleanedText) {
      sseSend(res, { type: 'replace', content: assessment.cleanedText });
    }

    // Send the parsed assessment as a final structured event
    const { cleanedText: _, ...assessmentData } = assessment ?? { affected_stages: [], summary: '' };
    sseSend(res, { type: 'assessment', assessment: assessmentData });
    sseSend(res, { type: 'done', content: '' });
  } catch (err: any) {
    logger.error('Failed to assess impact', err);
    sseSend(res, { type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/change-request/:crId/execute
 * Execute a change request with confirmed stages.
 * Body: { stages: string[] }
 */
changeRequestRoutes.post('/change-request/:crId/execute', async (req: Request, res: Response) => {
  const crId = parseInt(req.params.crId, 10);
  if (isNaN(crId)) return res.status(400).json({ error: 'Invalid CR id' });

  const { stages } = req.body as { stages?: string[] };
  if (!stages || !Array.isArray(stages) || stages.length === 0) {
    return res.status(400).json({ error: 'stages must be a non-empty array' });
  }

  try {
    await executeChangeRequest(crId, stages);
    const cr = getChangeRequest(crId);
    res.json({ ok: true, cr });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to execute change request', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/change-request/:crId/cancel
 * Cancel a pending or assessed change request.
 */
changeRequestRoutes.post('/change-request/:crId/cancel', (req: Request, res: Response) => {
  const crId = parseInt(req.params.crId, 10);
  if (isNaN(crId)) return res.status(400).json({ error: 'Invalid CR id' });

  try {
    cancelChangeRequest(crId);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to cancel change request', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/:id/ado-mappings
 * Check if ADO mappings exist for a workflow (used to show Sync vs Push label).
 */
changeRequestRoutes.get('/workflow/:id/ado-mappings', (req: Request, res: Response) => {
  const count = db.prepare<[string], { cnt: number }>(
    'SELECT COUNT(*) as cnt FROM ado_work_item_map WHERE workflow_id = ?'
  ).get(req.params.id);
  res.json({ hasMappings: (count?.cnt ?? 0) > 0 });
});

/**
 * GET /api/workflow/:id/qa-test-plan-mappings
 * Check if a QA test plan has already been pushed for this workflow.
 */
changeRequestRoutes.get('/workflow/:id/qa-test-plan-mappings', (req: Request, res: Response) => {
  const row = db.prepare<[string], { cnt: number }>(
    'SELECT COUNT(*) as cnt FROM qa_test_plan_map WHERE workflow_id = ?'
  ).get(req.params.id);
  res.json({ hasMappings: (row?.cnt ?? 0) > 0 });
});

/**
 * GET /api/workflow/artifact/:id/version-info
 * Get CR version info for an artifact (for the version badge in ArtifactViewer).
 */
changeRequestRoutes.get('/workflow/artifact/:id/version-info', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid artifact id' });

  const row = db.prepare<[number], { change_request_id: number; version: number; stage: string }>(
    'SELECT change_request_id, version, stage FROM cr_artifact_versions WHERE artifact_id = ?'
  ).get(id);

  res.json({ versionInfo: row ?? null });
});
