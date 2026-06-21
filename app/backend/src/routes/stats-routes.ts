/**
 * stats-routes — read-only stats dashboard endpoint. Mounted at /api/stats.
 * Gated to admins and the 'management' role (see requireRole in middleware/auth).
 */
import { Router, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/auth';
import { getStatsDashboard } from '../agents/stats-db';
import { getDemoStatsDashboard } from '../agents/stats-demo-data';
import Logger from '../utils/logger';

const logger = new Logger('STATS-ROUTES');
export const statsRoutes = Router();

statsRoutes.use(requireRole('management'));

const MIN_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 365;
const DEFAULT_RANGE_DAYS = 90;

/**
 * GET /api/stats/dashboard?days=90&demo=true
 * Returns cycle-time, first-time-approval, throughput, and bottleneck stats.
 * demo=true returns a fabricated payload (isDemo: true) for showcasing the
 * dashboard before there's enough real history — never touches the DB.
 */
statsRoutes.get('/dashboard', (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseInt(String(req.query.days ?? DEFAULT_RANGE_DAYS), 10);
    const days = Number.isFinite(parsed) ? Math.min(MAX_RANGE_DAYS, Math.max(MIN_RANGE_DAYS, parsed)) : DEFAULT_RANGE_DAYS;
    const isDemo = req.query.demo === 'true' || req.query.demo === '1';
    const dashboard = isDemo ? getDemoStatsDashboard(days) : getStatsDashboard(days);
    res.json(dashboard);
  } catch (err: any) {
    logger.error('Failed to build stats dashboard', err);
    res.status(500).json({ error: err.message || 'Failed to build stats dashboard' });
  }
});
