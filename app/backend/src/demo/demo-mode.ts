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

function getFixturesDir(): string {
  const theme = process.env.DEMO_FIXTURE_THEME ?? 'price-alerts';
  if (theme === 'messaging') return path.join(__dirname, 'fixtures/messaging');
  return path.join(__dirname, 'fixtures');
}

// Alias for backwards-compatibility — always read at call time so theme changes take effect
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Stage → fixture file mapping
const DEMO_FIXTURE_FILES: Record<string, string> = {
  analyst:            'analyst.md',
  pm_prd:             'prd.md',
  solution_architect: 'architecture.md',
  pm_backlog:         'backlog.json',
  tech_refinement:    'tech-backlog.json',
  qa_engineer:        'qa-tests.json',
  gtm_strategy:       'gtm-strategy.md',
  feature_marketing:  'feature-marketing.md',
  prototype:          'prototype.json',
};

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
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
 */
export function getDemoFixture(stage: string): string | null {
  const filename = DEMO_FIXTURE_FILES[stage];
  if (!filename) return null;

  const fixturePath = path.join(getFixturesDir(), filename);
  try {
    return fs.readFileSync(fixturePath, 'utf-8');
  } catch {
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
  analyst:            3_000,
  pm_prd:             2_500,
  solution_architect: 2_500,
  pm_backlog:         2_000,
  tech_refinement:    2_500,
  qa_engineer:        2_000,
  gtm_strategy:       2_000,
  feature_marketing:  2_000,
  prototype:          3_000,
  curator:            1_500,
};
