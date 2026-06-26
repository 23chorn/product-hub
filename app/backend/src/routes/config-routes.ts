import { Router, Request, Response } from 'express';
import { appConfig } from '../config/app-config';
import { getAgentModelLabels } from '../utils/ai-provider';
import { getEnabledStages } from '../config/settings-store';

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
 * stages.enabledStages is read fresh from the DB so that pipeline toggle changes
 * in Settings are reflected immediately without a server restart.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ ...appConfig, stages: { enabledStages: getEnabledStages() } });
});

export default router;
