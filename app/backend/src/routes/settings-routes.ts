import { Router, Request, Response } from 'express';
import Logger from '../utils/logger';
import { hasAnyUsers } from '../data/users';
import type { AuthRequest } from '../middleware/auth';
import {
  getGlobalPolicy,
  setGlobalPolicy,
  getUserSettings,
  getSprintSettings,
  getEnabledStages,
  setEnabledStages,
} from '../config/settings-store';

const logger = new Logger('SETTINGS');
const router = Router();

// ── GET /api/settings ─────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const user = getUserSettings();
    const sprint = getSprintSettings();
    res.json({
      user: {
        name: user.userName,
        projectName: user.projectName,
        skillLevel: user.skillLevel,
        communicationLanguage: user.communicationLanguage,
      },
      sprint: {
        velocity: sprint.sprintVelocity,
        capacityFactor: sprint.capacityFactor,
        aiAssistedEnabled: sprint.aiAssisted,
      },
      pipeline: {
        enabledStages: getEnabledStages(),
        figmaBypassMode: getGlobalPolicy('figma_bypass_mode') === 'true',
      },
      qualityGates: {
        requireCriticReview: getGlobalPolicy('require_critic_review') !== 'false',
        autoApproveCritic: getGlobalPolicy('auto_approve_critic') === 'true',
      },
      integrations: {
        // Slack webhook is env-only (SLACK_WEBHOOK_URL) — not settable from the UI/API,
        // so ops can rotate it without a DB write reaching out-of-date across environments.
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? null,
        // Default true — policy absence means enabled, only explicit 'false' disables.
        slackNotificationsEnabled: getGlobalPolicy('slack_notifications_enabled') !== 'false',
      },
      demo: {
        enabled: getGlobalPolicy('demo_mode_enabled') === 'true',
      },
    });
  } catch (err: any) {
    logger.error('Failed to read settings', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/settings ─────────────────────────────────────────────────────────

router.put('/', (req: AuthRequest, res: Response) => {
  try {
    const { user, sprint, pipeline, qualityGates, demo, integrations } = req.body as {
      user?: { name?: string; projectName?: string; skillLevel?: string; communicationLanguage?: string };
      sprint?: { velocity?: number; capacityFactor?: number; aiAssistedEnabled?: boolean };
      pipeline?: { enabledStages?: Record<string, boolean>; figmaBypassMode?: boolean };
      qualityGates?: { requireCriticReview?: boolean; autoApproveCritic?: boolean };
      demo?: { enabled?: boolean };
      integrations?: { slackNotificationsEnabled?: boolean };
    };

    if (pipeline?.figmaBypassMode !== undefined && hasAnyUsers() && !req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required to change Figma bypass mode' });
    }

    if (integrations?.slackNotificationsEnabled !== undefined && hasAnyUsers() && !req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required to change Slack notification settings' });
    }

    if (user) {
      if (user.name !== undefined) setGlobalPolicy('user_name', user.name);
      if (user.projectName !== undefined) setGlobalPolicy('project_name', user.projectName);
      if (user.skillLevel !== undefined) setGlobalPolicy('user_skill_level', user.skillLevel);
      if (user.communicationLanguage !== undefined) setGlobalPolicy('communication_language', user.communicationLanguage);
    }

    if (sprint) {
      if (sprint.velocity !== undefined) setGlobalPolicy('sprint_velocity', String(sprint.velocity));
      if (sprint.capacityFactor !== undefined) setGlobalPolicy('capacity_factor', String(sprint.capacityFactor));
      if (sprint.aiAssistedEnabled !== undefined) setGlobalPolicy('ai_assisted_enabled', String(sprint.aiAssistedEnabled));
    }

    if (pipeline?.enabledStages) {
      setEnabledStages(pipeline.enabledStages);
    }

    if (pipeline?.figmaBypassMode !== undefined) {
      setGlobalPolicy('figma_bypass_mode', String(pipeline.figmaBypassMode));
    }

    if (qualityGates) {
      if (qualityGates.requireCriticReview !== undefined) {
        setGlobalPolicy('require_critic_review', String(qualityGates.requireCriticReview));
      }
      if (qualityGates.autoApproveCritic !== undefined) {
        setGlobalPolicy('auto_approve_critic', String(qualityGates.autoApproveCritic));
      }
    }

    if (demo?.enabled !== undefined) {
      setGlobalPolicy('demo_mode_enabled', String(demo.enabled));
    }

    if (integrations?.slackNotificationsEnabled !== undefined) {
      setGlobalPolicy('slack_notifications_enabled', String(integrations.slackNotificationsEnabled));
    }

    logger.info('Settings updated');
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Failed to write settings', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
