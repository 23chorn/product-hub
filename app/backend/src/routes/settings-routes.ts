import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import Logger from '../utils/logger';
import { hasAnyUsers } from '../data/users';
import type { AuthRequest } from '../middleware/auth';

const logger = new Logger('SETTINGS');
const router = Router();

const AGENTS_ROOT = path.resolve(__dirname, '../../../../agents');
const CONFIG_PATH = path.join(AGENTS_ROOT, 'config.yaml');

// ── Policy helpers ─────────────────────────────────────────────────────────────

function getPolicy(key: string): string | null {
  const row = db.prepare(`SELECT rule_value FROM policies WHERE scope = 'global' AND rule_key = ?`).get(key) as { rule_value: string } | undefined;
  return row?.rule_value ?? null;
}

function setPolicy(key: string, value: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM policies WHERE scope = 'global' AND scope_value IS NULL AND rule_key = ?`).run(key);
    db.prepare(`INSERT INTO policies (scope, scope_value, rule_key, rule_value, created_at) VALUES ('global', NULL, ?, ?, ?)`).run(key, value, Date.now());
  })();
}

// ── YAML line-by-line read ─────────────────────────────────────────────────────

function readConfig(): Record<string, any> {
  let raw = '';
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf-8'); } catch { return {}; }

  const result: Record<string, any> = {
    user_name: 'User',
    project_name: 'My Product',
    user_skill_level: 'intermediate',
    communication_language: 'English',
    document_output_language: 'English',
    sprint_velocity: 25,
    capacity_factor: 0.7,
    ai_assisted_development: { enabled: false },
    enabled_stages: {},
  };

  let section: string | null = null;
  let inAiSection = false;

  for (const line of raw.split('\n')) {
    if (/^#/.test(line) || !line.trim()) continue;

    const topMatch = line.match(/^(\w+):\s*(.*)?$/);
    if (topMatch && !line.startsWith(' ')) {
      const [, key, val] = topMatch;
      inAiSection = false;

      if (key === 'hours_per_point' || key === 'enabled_stages' || key === 'ai_assisted_development') {
        section = key;
        if (key === 'ai_assisted_development') inAiSection = true;
        if (key === 'enabled_stages') result.enabled_stages = {};
        continue;
      }

      section = null;
      const trimmed = val?.trim().replace(/^['"]|['"]$/g, '') ?? '';
      if (key === 'sprint_velocity') result.sprint_velocity = parseInt(trimmed, 10) || result.sprint_velocity;
      else if (key === 'capacity_factor') result.capacity_factor = parseFloat(trimmed) || result.capacity_factor;
      else if (trimmed) result[key] = trimmed;
      continue;
    }

    if (line.startsWith('  ') && section === 'enabled_stages') {
      const m = line.match(/^\s+(\w+):\s*(true|false)/);
      if (m) result.enabled_stages[m[1]] = m[2] === 'true';
    }

    if (line.startsWith('  ') && inAiSection) {
      const enabledM = line.match(/^\s+enabled:\s*(true|false)/);
      if (enabledM) result.ai_assisted_development.enabled = enabledM[1] === 'true';
      const hppM = line.match(/^\s+ai_hours_per_point:/);
      if (hppM) { /* sub-section, skip */ }
    }
  }

  return result;
}

// ── YAML line-by-line write (preserves comments) ──────────────────────────────

function writeConfig(updates: Record<string, any>): void {
  let raw = '';
  try { raw = fs.readFileSync(CONFIG_PATH, 'utf-8'); } catch { raw = ''; }

  const lines = raw.split('\n');
  const out: string[] = [];

  let section: string | null = null;
  let inAiSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#/.test(line) || !line.trim()) { out.push(line); continue; }

    const topMatch = line.match(/^(\w+):\s*(.*)?$/);
    if (topMatch && !line.startsWith(' ')) {
      const [, key] = topMatch;
      inAiSection = false;

      if (key === 'ai_assisted_development') { section = 'ai'; inAiSection = true; out.push(line); continue; }
      if (key === 'enabled_stages') { section = 'stages'; out.push(line); continue; }
      if (key === 'hours_per_point') { section = 'hpp'; out.push(line); continue; }
      section = null;

      if (key in updates) {
        out.push(`${key}: ${updates[key]}`);
      } else {
        out.push(line);
      }
      continue;
    }

    // Indented lines
    if (line.startsWith('  ') || line.startsWith('\t')) {
      if (section === 'stages') {
        const m = line.match(/^(\s+)(\w+):\s*(true|false)/);
        if (m && updates.enabled_stages && m[2] in updates.enabled_stages) {
          out.push(`${m[1]}${m[2]}: ${updates.enabled_stages[m[2]]}`);
          continue;
        }
      }
      if (section === 'ai' && inAiSection) {
        const enabledM = line.match(/^(\s+enabled):\s*(true|false)/);
        if (enabledM && updates.ai_assisted_enabled !== undefined) {
          out.push(`${enabledM[1]}: ${updates.ai_assisted_enabled}`);
          continue;
        }
      }
      out.push(line);
      continue;
    }

    out.push(line);
  }

  fs.writeFileSync(CONFIG_PATH, out.join('\n'), 'utf-8');
}

// ── GET /api/settings ─────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const cfg = readConfig();
    res.json({
      user: {
        name: cfg.user_name ?? 'User',
        projectName: cfg.project_name ?? 'My Product',
        skillLevel: cfg.user_skill_level ?? 'intermediate',
        communicationLanguage: cfg.communication_language ?? 'English',
      },
      sprint: {
        velocity: cfg.sprint_velocity ?? 25,
        capacityFactor: cfg.capacity_factor ?? 0.7,
        aiAssistedEnabled: cfg.ai_assisted_development?.enabled ?? false,
      },
      pipeline: {
        enabledStages: cfg.enabled_stages ?? {},
        figmaBypassMode: getPolicy('figma_bypass_mode') === 'true',
      },
      qualityGates: {
        requireCriticReview: getPolicy('require_critic_review') !== 'false',
        autoApproveCritic: getPolicy('auto_approve_critic') === 'true',
      },
      integrations: {
        slackWebhookUrl: getPolicy('slack_webhook_url') ?? process.env.SLACK_WEBHOOK_URL ?? null,
      },
      demo: {
        enabled: getPolicy('demo_mode_enabled') !== null
          ? getPolicy('demo_mode_enabled') === 'true'
          : process.env.DEMO_MODE === 'true',
        projectPath: process.env.DEMO_PROJECT_PATH ?? null,
        fixtureTheme: process.env.DEMO_FIXTURE_THEME ?? 'messaging',
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
    const { user, sprint, pipeline, qualityGates, integrations, demo } = req.body as {
      user?: { name?: string; projectName?: string; skillLevel?: string; communicationLanguage?: string };
      sprint?: { velocity?: number; capacityFactor?: number; aiAssistedEnabled?: boolean };
      pipeline?: { enabledStages?: Record<string, boolean>; figmaBypassMode?: boolean };
      qualityGates?: { requireCriticReview?: boolean; autoApproveCritic?: boolean };
      integrations?: { slackWebhookUrl?: string | null };
      demo?: { enabled?: boolean };
    };

    if (pipeline?.figmaBypassMode !== undefined && hasAnyUsers() && !req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required to change Figma bypass mode' });
    }

    const cfgUpdates: Record<string, any> = {};

    if (user) {
      if (user.name !== undefined) cfgUpdates.user_name = user.name;
      if (user.projectName !== undefined) cfgUpdates.project_name = user.projectName;
      if (user.skillLevel !== undefined) cfgUpdates.user_skill_level = user.skillLevel;
      if (user.communicationLanguage !== undefined) cfgUpdates.communication_language = user.communicationLanguage;
    }
    if (sprint) {
      if (sprint.velocity !== undefined) cfgUpdates.sprint_velocity = sprint.velocity;
      if (sprint.capacityFactor !== undefined) cfgUpdates.capacity_factor = sprint.capacityFactor;
      if (sprint.aiAssistedEnabled !== undefined) cfgUpdates.ai_assisted_enabled = sprint.aiAssistedEnabled;
    }
    if (pipeline?.enabledStages) {
      cfgUpdates.enabled_stages = pipeline.enabledStages;
    }

    writeConfig(cfgUpdates);

    if (pipeline?.figmaBypassMode !== undefined) {
      setPolicy('figma_bypass_mode', String(pipeline.figmaBypassMode));
    }

    if (qualityGates) {
      if (qualityGates.requireCriticReview !== undefined) {
        setPolicy('require_critic_review', String(qualityGates.requireCriticReview));
      }
      if (qualityGates.autoApproveCritic !== undefined) {
        setPolicy('auto_approve_critic', String(qualityGates.autoApproveCritic));
      }
    }

    if (integrations?.slackWebhookUrl !== undefined) {
      setPolicy('slack_webhook_url', integrations.slackWebhookUrl ?? '');
    }

    if (demo?.enabled !== undefined) {
      setPolicy('demo_mode_enabled', String(demo.enabled));
    }

    logger.info('Settings updated');
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Failed to write settings', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
