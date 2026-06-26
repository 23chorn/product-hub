import db from '../data/database';

/**
 * Single source of truth for user/sprint/pipeline settings that were previously
 * stored in agents/config.yaml. They now live in the `policies` table under
 * scope='global' (scope_value NULL), the same store already used for figma
 * bypass, quality gates, Slack webhook, and demo mode (see settings-routes.ts).
 *
 * This is a leaf module — it depends only on the db — so any consumer
 * (settings route, specialist agent, sprint estimator, app config) can import
 * it without risking an import cycle.
 */

// ── Raw global-policy accessors ────────────────────────────────────────────────

export function getGlobalPolicy(key: string): string | null {
  const row = db
    .prepare(`SELECT rule_value FROM policies WHERE scope = 'global' AND scope_value IS NULL AND rule_key = ?`)
    .get(key) as { rule_value: string } | undefined;
  return row?.rule_value ?? null;
}

export function setGlobalPolicy(key: string, value: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM policies WHERE scope = 'global' AND scope_value IS NULL AND rule_key = ?`).run(key);
    db.prepare(`INSERT INTO policies (scope, scope_value, rule_key, rule_value, created_at) VALUES ('global', NULL, ?, ?, ?)`).run(key, value, Date.now());
  })();
}

// ── User identity ──────────────────────────────────────────────────────────────

export interface UserSettings {
  userName: string;
  projectName: string;
  skillLevel: string;
  communicationLanguage: string;
  documentOutputLanguage: string;
}

const USER_DEFAULTS: UserSettings = {
  userName: 'User',
  projectName: 'My Product',
  skillLevel: 'intermediate',
  communicationLanguage: 'English',
  documentOutputLanguage: 'English',
};

export function getUserSettings(): UserSettings {
  return {
    userName: getGlobalPolicy('user_name') ?? USER_DEFAULTS.userName,
    projectName: getGlobalPolicy('project_name') ?? USER_DEFAULTS.projectName,
    skillLevel: getGlobalPolicy('user_skill_level') ?? USER_DEFAULTS.skillLevel,
    communicationLanguage: getGlobalPolicy('communication_language') ?? USER_DEFAULTS.communicationLanguage,
    documentOutputLanguage: getGlobalPolicy('document_output_language') ?? USER_DEFAULTS.documentOutputLanguage,
  };
}

// ── Sprint planning ────────────────────────────────────────────────────────────

export interface SprintSettings {
  sprintVelocity: number;
  capacityFactor: number;
  aiAssisted: boolean;
}

const SPRINT_DEFAULTS: SprintSettings = {
  sprintVelocity: 25,
  capacityFactor: 0.7,
  aiAssisted: false,
};

export function getSprintSettings(): SprintSettings {
  const velocity = getGlobalPolicy('sprint_velocity');
  const capacity = getGlobalPolicy('capacity_factor');
  return {
    sprintVelocity: velocity != null ? parseInt(velocity, 10) || SPRINT_DEFAULTS.sprintVelocity : SPRINT_DEFAULTS.sprintVelocity,
    capacityFactor: capacity != null ? parseFloat(capacity) || SPRINT_DEFAULTS.capacityFactor : SPRINT_DEFAULTS.capacityFactor,
    aiAssisted: getGlobalPolicy('ai_assisted_enabled') === 'true',
  };
}

// ── Enabled specialist stages ──────────────────────────────────────────────────

/**
 * All known specialist stages — each defaults to enabled when no policy is set.
 * Must stay in sync with the toggleable stages in the Settings UI (frontend
 * STAGE_ORDER in SettingsPanel.tsx) — a stage missing here silently ignores its
 * toggle, since setEnabledStages()/getEnabledStages() only read/write this list.
 */
export const ALL_STAGES = [
  'analyst', 'pm_prd', 'prototype', 'figma_design',
  'solution_architect', 'epic_feature_planner', 'story_decomposition',
];

const STAGE_KEY_PREFIX = 'stage_enabled:';

export function getEnabledStages(): Record<string, boolean> {
  const result: Record<string, boolean> = Object.fromEntries(ALL_STAGES.map(s => [s, true]));
  for (const stage of ALL_STAGES) {
    const val = getGlobalPolicy(`${STAGE_KEY_PREFIX}${stage}`);
    if (val != null) result[stage] = val === 'true';
  }
  return result;
}

export function setEnabledStages(stages: Record<string, boolean>): void {
  for (const [stage, enabled] of Object.entries(stages)) {
    if (!ALL_STAGES.includes(stage)) continue;
    setGlobalPolicy(`${STAGE_KEY_PREFIX}${stage}`, String(enabled));
  }
}
