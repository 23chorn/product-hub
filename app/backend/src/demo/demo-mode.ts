/**
 * Demo Mode — returns static fixture content per stage instead of calling the LLM.
 *
 * Enable via DEMO_MODE=true in .env. Useful for testing the workflow pipeline,
 * UI animations, and approval flow without incurring LLM costs.
 *
 * Two fixture themes are available:
 *   DEMO_FIXTURE_THEME=price-alerts  (default) — Price Alerts & Watchlist
 *   DEMO_FIXTURE_THEME=messaging               — In-App Messaging & Trade Chat
 */

import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';

// Use project root for reliable fixture path resolution
// Walk up from __dirname until we find package.json with workspaces
function findProjectRoot(): string {
  console.log(`[DEMO FIXTURE] Starting from __dirname: ${__dirname}`);
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    try {
      const pkgPath = path.join(dir, 'package.json');
      console.log(`[DEMO FIXTURE] Checking for package.json at: ${pkgPath}`);
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) {
          console.log(`[DEMO FIXTURE] Found project root: ${dir}`);
          return dir;
        }
      }
    } catch {}
    dir = path.resolve(dir, '..');
  }
  const fallback = path.resolve(__dirname, '../../../../');
  console.log(`[DEMO FIXTURE] Using fallback root: ${fallback}`);
  return fallback;
}
const PROJECT_ROOT = findProjectRoot();

function getFixturesDir(): string {
  const theme = process.env.DEMO_FIXTURE_THEME ?? 'price-alerts';
  const baseFixtures = path.join(PROJECT_ROOT, 'app/backend/src/demo/fixtures');
  console.log(`[DEMO FIXTURE] PROJECT_ROOT: ${PROJECT_ROOT}`);
  console.log(`[DEMO FIXTURE] Base fixtures dir: ${baseFixtures}`);
  console.log(`[DEMO FIXTURE] Theme from env: ${theme}`);
  if (theme === 'messaging') {
    const messagingDir = path.join(baseFixtures, 'messaging');
    console.log(`[DEMO FIXTURE] Using messaging theme dir: ${messagingDir}`);
    return messagingDir;
  }
  console.log(`[DEMO FIXTURE] Using base fixtures dir for theme: ${theme}`);
  return baseFixtures;
}

// Alias for backwards-compatibility — always read at call time so theme changes take effect
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Stage → fixture file mapping
const DEMO_FIXTURE_FILES: Record<string, string> = {
  analyst:               'analyst.json',
  pm_prd:                'prd.json',
  epic_feature_planner:  'epic-features.json',
  solution_architect:    'architecture.json',
  story_decomposition:   'backlog.json',
  prototype:             'prototype.json',
};

export function isDemoMode(): boolean {
  try {
    const row = db.prepare(
      `SELECT rule_value FROM policies WHERE scope = 'global' AND rule_key = 'demo_mode_enabled'`
    ).get() as { rule_value: string } | undefined;
    if (row) {
      console.log(`[DEMO MODE] Policy found: demo_mode_enabled = ${row.rule_value}`);
      return row.rule_value === 'true';
    }
  } catch (err: any) {
    console.log(`[DEMO MODE] Policy query failed: ${err.message}`);
  }
  const envMode = process.env.DEMO_MODE === 'true';
  console.log(`[DEMO MODE] Env var DEMO_MODE = ${process.env.DEMO_MODE} (returns ${envMode})`);
  return envMode;
}

/**
 * Returns demo fixture content for the given theme and stage, or null if no fixture exists.
 */
export function getDemoFixtureForTheme(theme: string, stage: string): string | null {
  const filename = DEMO_FIXTURE_FILES[stage];
  if (!filename) return null;
  const fixturePath = path.join(__dirname, 'fixtures', theme, filename);
  try {
    return fs.readFileSync(fixturePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Returns demo fixture content for the given stage, or null if no fixture exists.
 * For feature-specific stages (story_decomposition_F1, F2, etc.), returns a backlog with
 * stories ONLY for that specific feature (other features have empty stories arrays).
 *
 * Falls back to base fixtures directory if theme-specific fixture not found.
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
        console.error(`[DEMO FIXTURE ERROR] Invalid backlog structure in ${fixturePath}`);
        return null;
      }

      const targetFeature = fullBacklog.features[featureIndex];
      if (!targetFeature) {
        console.error(`[DEMO FIXTURE ERROR] Feature ${featureIndex + 1} not found in backlog`);
        return null;
      }

      return JSON.stringify({ epic: fullBacklog.epic, features: [targetFeature] }, null, 2);
    } catch (err: any) {
      console.error(`[DEMO FIXTURE ERROR] Failed to process feature-specific backlog for ${stage}:`, err.message);
      return null;
    }
  }

  const filename = DEMO_FIXTURE_FILES[stage];
  if (!filename) {
    console.log(`[DEMO FIXTURE] No mapping for stage "${stage}"`);
    return null;
  }

  // Try theme-specific fixture first
  const themeFixturePath = path.join(getFixturesDir(), filename);
  console.log(`[DEMO FIXTURE] Attempting to load: ${themeFixturePath}`);
  try {
    const content = fs.readFileSync(themeFixturePath, 'utf-8');
    console.log(`[DEMO FIXTURE] Successfully loaded ${themeFixturePath} (${content.length} chars)`);
    return content;
  } catch (err) {
    console.log(`[DEMO FIXTURE] Theme-specific fixture not found, trying base directory...`);
  }

  // Fallback to base fixtures directory
  const baseFixtures = path.join(PROJECT_ROOT, 'app/backend/src/demo/fixtures');
  const baseFixturePath = path.join(baseFixtures, filename);
  console.log(`[DEMO FIXTURE] Attempting fallback: ${baseFixturePath}`);
  try {
    const content = fs.readFileSync(baseFixturePath, 'utf-8');
    console.log(`[DEMO FIXTURE] Successfully loaded fallback ${baseFixturePath} (${content.length} chars)`);
    return content;
  } catch (err) {
    console.error(`[DEMO FIXTURE ERROR] Failed to load both theme and base fixtures for "${stage}":`, err instanceof Error ? err.message : String(err));
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
  analyst:               3_000,
  pm_prd:                2_500,
  epic_feature_planner:  2_000,
  solution_architect:    2_500,
  story_decomposition:   2_000,
  prototype:             3_000,
  curator:               1_500,
};
