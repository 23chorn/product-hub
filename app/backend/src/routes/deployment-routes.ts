/**
 * Deployment history API - view deployment records for operational tracking.
 * Restricted to admin users.
 */
import { Router, Response } from 'express';
import { requireRole, type AuthRequest } from '../middleware/auth';
import { getRecentDeployments, getCurrentDeployment } from '../utils/deployment-tracker';
import Logger from '../utils/logger';

const logger = new Logger('DEPLOYMENT-API');
const router = Router();

/**
 * GET /api/deployments
 * List recent deployments (admin only)
 */
router.get('/', requireRole('admin'), (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const deployments = getRecentDeployments(Math.min(limit, 100));
    res.json({ deployments });
  } catch (error: any) {
    logger.error('Failed to fetch deployments', error);
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

/**
 * GET /api/deployments/current
 * Get current deployment info (admin only)
 */
router.get('/current', requireRole('admin'), (req: AuthRequest, res: Response) => {
  try {
    const deployment = getCurrentDeployment();
    if (!deployment) {
      return res.status(404).json({ error: 'No deployment records found' });
    }
    res.json(deployment);
  } catch (error: any) {
    logger.error('Failed to fetch current deployment', error);
    res.status(500).json({ error: 'Failed to fetch current deployment' });
  }
});

export default router;
