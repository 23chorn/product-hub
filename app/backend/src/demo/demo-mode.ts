/**
 * Demo Mode — returns static fixture content per stage instead of calling the LLM.
 *
 * Enabled via the "Demo mode enabled" toggle in Settings (demo_mode_enabled policy).
 * Useful for testing the workflow pipeline, UI animations, and approval flow
 * without incurring LLM costs.
 *
 * Fixture theme: In-App Messaging & Trade Chat (xCube)
 */

import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('DEMO');

// Use project root for reliable fixture path resolution
// Walk up from __dirname until we find package.json with workspaces
function findProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    try {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) return dir;
      }
    } catch {}
    dir = path.resolve(dir, '..');
  }
  const fallback = path.resolve(__dirname, '../../../../');
  logger.warn(`Could not locate workspace root by walking up from ${__dirname} — using fallback ${fallback}`);
  return fallback;
}
const PROJECT_ROOT = findProjectRoot();

function getFixturesDir(): string {
  const baseFixtures = path.join(PROJECT_ROOT, 'app/backend/src/demo/fixtures');
  return path.join(baseFixtures, 'messaging');
}

// Stage → fixture file mapping
const DEMO_FIXTURE_FILES: Record<string, string> = {
  analyst:               'analyst.json',
  pm_prd:                'prd.json',
  epic_feature_planner:  'epic-features.json',
  solution_architect:    'architecture.json',
  story_decomposition:   'backlog.json',
  prototype:             'prototype.json',
  figma_design:          'figma-design.json',
};

/**
 * Whether a specific workflow is a demo run, decided from its policy_overrides
 * (demo_mode or demo_auto_approve). Accepts either the raw policy_overrides JSON
 * string or an already-parsed object. Unlike isDemoMode() — which reads the global
 * demo toggle for UI visibility — this is the per-workflow signal that gates fixture
 * substitution and must drive real workflow behavior.
 */
export function isDemoWorkflow(policyOverrides: string | Record<string, unknown> | null | undefined): boolean {
  if (!policyOverrides) return false;
  let parsed: Record<string, unknown>;
  if (typeof policyOverrides === 'string') {
    try { parsed = JSON.parse(policyOverrides); } catch { return false; }
  } else {
    parsed = policyOverrides;
  }
  return parsed.demo_mode === 'true' || parsed.demo_auto_approve === 'true';
}

export function isDemoMode(): boolean {
  try {
    const row = db.prepare(
      `SELECT rule_value FROM policies WHERE scope = 'global' AND rule_key = 'demo_mode_enabled'`
    ).get() as { rule_value: string } | undefined;
    return row?.rule_value === 'true';
  } catch (err: any) {
    logger.warn(`demo_mode_enabled policy query failed: ${err.message}`);
    return false;
  }
}

/**
 * Returns demo fixture content for the given stage, or null if no fixture exists.
 * For feature-specific stages (story_decomposition_F1, F2, etc.), returns a backlog with
 * stories ONLY for that specific feature (other features have empty stories arrays).
 */
export function getDemoFixture(stage: string): string | null {
  // Handle feature-specific story decomposition stages
  const featureMatch = stage.match(/^story_decomposition_F(\d+)$/);
  if (featureMatch) {
    const featureIndex = parseInt(featureMatch[1], 10) - 1; // Convert to 0-based
    const fixturePath = path.join(getFixturesDir(), 'backlog.json');
    try {
      const fullBacklogContent = fs.readFileSync(fixturePath, 'utf-8').replace(/^﻿/, '');
      const fullBacklog = JSON.parse(fullBacklogContent);

      if (!fullBacklog.features || !Array.isArray(fullBacklog.features)) {
        logger.error(`Invalid backlog structure in ${fixturePath}`);
        return null;
      }

      const targetFeature = fullBacklog.features[featureIndex];
      if (!targetFeature) {
        logger.error(`Feature ${featureIndex + 1} not found in backlog ${fixturePath}`);
        return null;
      }

      return JSON.stringify({ epic: fullBacklog.epic, features: [targetFeature] }, null, 2);
    } catch (err: any) {
      logger.error(`Failed to process feature-specific backlog for ${stage}: ${err.message}`);
      return null;
    }
  }

  const filename = DEMO_FIXTURE_FILES[stage];
  if (!filename) {
    logger.debug(`No fixture mapping for stage "${stage}"`);
    return null;
  }

  const fixturePath = path.join(getFixturesDir(), filename);
  try {
    const content = fs.readFileSync(fixturePath, 'utf-8');
    logger.debug(`Loaded fixture for "${stage}" (${content.length} chars)`);
    return content;
  } catch (err) {
    logger.error(`Failed to load fixture for "${stage}" at ${fixturePath}`, err instanceof Error ? err : String(err));
    return null;
  }
}

/**
 * Sleep for a given number of milliseconds.
 * Used to simulate LLM latency in demo mode and as a general async delay utility.
 */
export function demoSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// How long each stage "works" before producing output in demo mode
export const DEMO_STAGE_DELAY_MS: Record<string, number> = {
  analyst:                  3_000,
  pm_prd:                   2_500,
  epic_feature_planner:     2_000,
  solution_architect:       2_500,
  story_decomposition:      2_000,
  // Wave 1 — F1/F2/F3 are kicked off together (independent features, no dependsOn) and
  // kept at the SAME delay so the UI visibly shows all three animating concurrently
  // instead of one finishing long before its wave-mates.
  story_decomposition_F1:   7_000,
  story_decomposition_F2:   7_000,
  story_decomposition_F3:   7_000,
  // Wave 2 — F4/F5 are independent too, but the default max_parallel_features=3 concurrency
  // cap spills them into a second batch. Shorter and equal so this smaller wave also reads
  // as visibly parallel rather than sequential.
  story_decomposition_F4:   4_000,
  story_decomposition_F5:   4_000,
  prototype:                3_000,
  figma_design:             2_500,
  curator:                  1_500,
};
