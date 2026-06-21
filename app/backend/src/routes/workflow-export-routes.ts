/**
 * workflow-export-routes — HTTP endpoints for pushing workflow artifacts to
 * external systems (ADO boards, Test Plans, Wiki). Mounted at /api/workflow
 * alongside workflow-routes. All business logic lives in agents/workflow-export.ts;
 * these handlers only parse the request and map WorkflowExportError → HTTP status.
 */
import { Router, Request, Response } from 'express';
import {
  pushBacklogToBoard,
  pushTestPlan,
  syncToWiki,
  WorkflowExportError,
} from '../agents/workflow-export';
import Logger from '../utils/logger';

const logger = new Logger('WORKFLOW-EXPORT-ROUTES');
export const workflowExportRoutes = Router();

/** Map a thrown error onto the response: WorkflowExportError → its status, else 500. */
function handleError(res: Response, context: string, err: unknown): void {
  if (err instanceof WorkflowExportError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error(context, err as Error);
  res.status(500).json({ error: (err as Error).message });
}

/**
 * POST /api/workflow/:id/push-to-board
 * Pushes the latest approved backlog artifact to the configured work-items
 * provider (ADO). First push creates the hierarchy; later pushes sync.
 */
workflowExportRoutes.post('/:id/push-to-board', async (req: Request, res: Response) => {
  try {
    res.json(await pushBacklogToBoard(req.params.id));
  } catch (err) {
    handleError(res, 'Failed to push to board', err);
  }
});

/**
 * POST /api/workflow/:id/push-to-test-plans
 * Pushes or syncs the approved QA test artifact to ADO Test Plans.
 */
workflowExportRoutes.post('/:id/push-to-test-plans', async (req: Request, res: Response) => {
  try {
    res.json(await pushTestPlan(req.params.id));
  } catch (err) {
    handleError(res, 'Failed to push to test plans', err);
  }
});

/**
 * POST /api/workflow/:id/sync-to-wiki
 * Manually sync research, PRD, and architecture documents to Azure DevOps Wiki.
 * Body: { stages?: string[] }
 */
workflowExportRoutes.post('/:id/sync-to-wiki', async (req: Request, res: Response) => {
  const { stages } = req.body as { stages?: string[] };
  try {
    res.json(await syncToWiki(req.params.id, stages));
  } catch (err) {
    handleError(res, 'Failed to sync to wiki', err);
  }
});
