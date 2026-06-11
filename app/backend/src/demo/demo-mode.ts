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
  analyst:               'analyst.md',
  pm_prd:                'prd.md',
  epic_feature_planner:  'epic-features.json',
  solution_architect:    'architecture.md',
  story_decomposition:   'backlog.json',
  pm_backlog:            'backlog.json',
  tech_refinement:       'tech-backlog.json',
  qa_engineer:           'qa-tests.json',
  gtm_strategy:          'gtm-strategy.md',
  feature_marketing:     'feature-marketing.md',
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
 * JSON stages (backlog, qa_engineer) return the raw JSON string.
 * For feature-specific stages (story_decomposition_F1, F2, etc.), returns a backlog with
 * stories ONLY for that specific feature (other features have empty stories arrays).
 *
 * Falls back to base fixtures directory if theme-specific fixture not found.
 */
export function getDemoFixture(stage: string): string | null {
  // Handle feature-specific story decomposition and tech refinement stages
  const featureMatch = stage.match(/^(story_decomposition|tech_refinement)_F(\d+)$/);
  if (featureMatch) {
    const featureIndex = parseInt(featureMatch[2], 10) - 1; // Convert to 0-based
    const isTechRefinement = featureMatch[1] === 'tech_refinement';
    const fixturePath = path.join(getFixturesDir(), isTechRefinement ? 'tech-backlog.json' : 'backlog.json');
    try {
      const fullBacklogContent = fs.readFileSync(fixturePath, 'utf-8');
      // Parse and extract only the target feature's stories
      const fullBacklog = JSON.parse(fullBacklogContent);

      if (!fullBacklog.features || !Array.isArray(fullBacklog.features)) {
        console.error(`[DEMO FIXTURE ERROR] Invalid backlog structure in ${fixturePath}`);
        return null;
      }

      // Create a copy with all features but only populate stories for the target feature
      const featureSpecificBacklog = {
        ...fullBacklog,
        features: fullBacklog.features.map((feature: any, index: number) => ({
          ...feature,
          stories: index === featureIndex ? feature.stories : []
        }))
      };

      return JSON.stringify(featureSpecificBacklog, null, 2);
    } catch (err: any) {
      console.error(`[DEMO FIXTURE ERROR] Failed to process feature-specific backlog for ${stage}:`, err.message);
      return null;
    }
  }

  // Handle feature-specific QA engineer stages
  const qaFeatureMatch = stage.match(/^qa_engineer_F(\d+)$/);
  if (qaFeatureMatch) {
    const featureNum = parseInt(qaFeatureMatch[1], 10); // 1-based feature number
    const fixturePath = path.join(getFixturesDir(), 'qa-tests.json');
    try {
      const fullQaContent = fs.readFileSync(fixturePath, 'utf-8');
      const fullQa = JSON.parse(fullQaContent);

      if (!fullQa.test_cases || !Array.isArray(fullQa.test_cases)) {
        console.error(`[DEMO FIXTURE ERROR] Invalid QA structure in ${fixturePath} - expected test_cases array`);
        return null;
      }

      // Filter test cases to only include those for the target feature (story_ref starts with "F{num}.")
      const featurePrefix = `F${featureNum}.`;
      const featureTestCases = fullQa.test_cases.filter((tc: any) =>
        tc.story_ref && typeof tc.story_ref === 'string' && tc.story_ref.startsWith(featurePrefix)
      );

      // Recalculate coverage for this subset
      const coverage = {
        total: featureTestCases.length,
        happy_paths: featureTestCases.filter((tc: any) => tc.type === 'happy_path').length,
        bad_paths: featureTestCases.filter((tc: any) => tc.type === 'bad_path').length,
        edge_cases: featureTestCases.filter((tc: any) => tc.type === 'edge_case').length,
        by_priority: {
          critical: featureTestCases.filter((tc: any) => tc.priority === 'critical').length,
          high: featureTestCases.filter((tc: any) => tc.priority === 'high').length,
          medium: featureTestCases.filter((tc: any) => tc.priority === 'medium').length,
          low: featureTestCases.filter((tc: any) => tc.priority === 'low').length,
        },
        by_fr: {} as Record<string, number>
      };

      // Build by_fr coverage map
      featureTestCases.forEach((tc: any) => {
        if (tc.prd_ref) {
          coverage.by_fr[tc.prd_ref] = (coverage.by_fr[tc.prd_ref] || 0) + 1;
        }
      });

      const featureSpecificQa = {
        ...fullQa,
        test_cases: featureTestCases,
        coverage
      };

      return JSON.stringify(featureSpecificQa, null, 2);
    } catch (err: any) {
      console.error(`[DEMO FIXTURE ERROR] Failed to process feature-specific QA for ${stage}:`, err.message);
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
    console.error(`[DEMO FIXTURE ERROR] Failed to load both theme and base fixtures for "${stage}":`, err.message);
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
  pm_backlog:            2_000,
  tech_refinement:       2_500,
  qa_engineer:           2_000,
  gtm_strategy:          2_000,
  feature_marketing:     2_000,
  prototype:             3_000,
  curator:               1_500,
};
