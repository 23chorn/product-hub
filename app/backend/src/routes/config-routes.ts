import { Router, Request, Response } from 'express';
import { appConfig } from '../config/app-config';
import { getAgentModelLabels } from '../utils/ai-provider';

const router = Router();

/**
 * GET /api/config/models
 * Kept for backward compatibility — returns provider, model list, and per-agent model labels.
 */
router.get('/models', (_req: Request, res: Response) => {
  res.json({
    provider: appConfig.ai.provider,
    models: appConfig.ai.models,
    agentModels: getAgentModelLabels(),
  });
});

/**
 * GET /api/config
 * Full app configuration (no secrets). Frontend reads this on mount.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json(appConfig);
});

export default router;
