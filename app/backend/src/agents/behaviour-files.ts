/**
 * Behaviour Files — shared path constants and file-mutation helpers for the
 * Gherkin-style context/behaviour/features/*.feature corpus. Single source of
 * truth so behaviour-context.ts (reads), behaviour-file-routes.ts (manual
 * edits), and context-diff-routes.ts (curator-proposed diffs) all agree on
 * where the corpus lives and how it's kept in sync.
 */
import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import Logger from '../utils/logger';
import { findRepoRoot } from '../utils/find-repo-root';

const logger = new Logger('BEHAVIOUR-FILES');

const PROJECT_ROOT = findRepoRoot(__dirname);
export const BEHAVIOUR_DIR = path.join(PROJECT_ROOT, 'context', 'behaviour');
export const FEATURES_DIR = path.join(BEHAVIOUR_DIR, 'features');
export const FEATURE_MAP_PATH = path.join(BEHAVIOUR_DIR, 'feature-map.json');

export const SAFE_FEATURE_FILENAME = /^[a-z0-9][a-z0-9-_]*\.feature$/;

/** Namespace behaviour docs in the shared context_file_versions table so they never collide with context/*.md file names. */
export const behaviourVersionKey = (fileName: string) => `behaviour/${fileName}`;

/** Record a saved behaviour doc's content as a new version row, however the save happened (manual edit or an approved curator diff). */
export function recordBehaviourFileVersion(fileName: string, content: string): void {
  db.prepare('INSERT INTO context_file_versions (file_name, content, created_at) VALUES (?, ?, ?)')
    .run(behaviourVersionKey(fileName), content, Date.now());
}

interface FeatureMapEntry { name: string; file: string; businessRules: number; flows: Array<{ name: string; scenarioCount: number }> }

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  authentication: 'Login, signup, onboarding, password reset, account recovery',
  trading: 'Buy/sell flows, order entry, futures trading, order validation',
  portfolio: 'Portfolio view, holdings, account management, watchlists',
  funding: 'Deposits, withdrawals, bank transfers',
  discovery: 'Explore, search, company details, charts, market depth',
  ipo: 'IPO subscription and application flows',
  advisor: 'Advisor-specific workflows and features',
  other: 'Settings, CDs, and miscellaneous features',
};

function categorize(fileName: string): string {
  const name = fileName.toLowerCase();
  if (/login|onboard|signup|recover|forget/.test(name)) return 'authentication';
  if (/trade|order|buy|sell|future/.test(name)) return 'trading';
  if (/portfolio|account|watchlist/.test(name)) return 'portfolio';
  if (/deposit|bank|transfer/.test(name)) return 'funding';
  if (/explore|search|company|chart|market/.test(name)) return 'discovery';
  if (/ipo/.test(name)) return 'ipo';
  if (/advisor/.test(name)) return 'advisor';
  return 'other';
}

function extractKeywords(featureName: string, fileName: string, flows: Array<{ name: string }>): string[] {
  const keywords = new Set<string>();
  fileName.replace('.feature', '').split(/[-_]/).forEach(w => { if (w.length > 2) keywords.add(w.toLowerCase()); });
  featureName.split(/\s+/).forEach(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (clean.length > 2) keywords.add(clean);
  });
  flows.forEach(f => f.name.split(/\s+/).forEach(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (clean.length > 3) keywords.add(clean);
  }));
  return Array.from(keywords).sort();
}

function parseFeatureFile(filePath: string): FeatureMapEntry {
  const content = fs.readFileSync(filePath, 'utf-8');
  let name = '';
  let businessRules = 0;
  const flows: Array<{ name: string; scenarioCount: number }> = [];
  let currentFlow: { name: string; scenarioCount: number } | null = null;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('Feature:')) name = trimmed.substring(8).trim();
    if (trimmed.startsWith('#') && /[A-Z]-\d+:/.test(trimmed)) businessRules++;
    if (trimmed.startsWith('# USER FLOW:')) {
      if (currentFlow) flows.push(currentFlow);
      currentFlow = { name: trimmed.replace('# USER FLOW:', '').trim(), scenarioCount: 0 };
    }
    if (trimmed.startsWith('Scenario:') && currentFlow) currentFlow.scenarioCount++;
  }
  if (currentFlow) flows.push(currentFlow);
  return { name, file: path.basename(filePath), businessRules, flows };
}

/**
 * Re-derive feature-map.json from the current .feature files on disk. Kept in
 * sync after every save (manual edit or approved curator diff) so the
 * searchable index (used by the PRD-phase behaviour lookup) never drifts.
 */
export function regenerateFeatureMap(): void {
  let files: string[];
  try {
    files = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.feature')).sort();
  } catch {
    return; // no features dir — nothing to regenerate
  }

  const categories: Record<string, { description: string; features: FeatureMapEntry[] }> = {};
  for (const [key, description] of Object.entries(CATEGORY_DESCRIPTIONS)) categories[key] = { description, features: [] };

  const index: Array<{ feature: string; file: string; category: string; keywords: string[] }> = [];
  let totalFlows = 0;
  let totalScenarios = 0;
  let totalBusinessRules = 0;

  for (const file of files) {
    const parsed = parseFeatureFile(path.join(FEATURES_DIR, file));
    const category = categorize(file);
    categories[category].features.push(parsed);
    totalFlows += parsed.flows.length;
    totalScenarios += parsed.flows.reduce((sum, f) => sum + f.scenarioCount, 0);
    totalBusinessRules += parsed.businessRules;
    index.push({ feature: parsed.name, file, category, keywords: extractKeywords(parsed.name, file, parsed.flows) });
  }

  const featureMap = {
    generated: new Date().toISOString(),
    totalFeatures: files.length,
    totalFlows,
    totalScenarios,
    totalBusinessRules,
    categories,
    index,
  };

  try {
    fs.writeFileSync(FEATURE_MAP_PATH, JSON.stringify(featureMap, null, 2));
    logger.info(`Regenerated feature-map.json (${files.length} feature files)`);
  } catch (err: any) {
    logger.error(`Failed to write feature-map.json: ${err.message}`);
  }
}

export interface BehaviourDiffSpec {
  section: string; // the target Scenario name (ignored for a brand-new file, where `content` is the whole file)
  action: 'add' | 'update' | 'remove';
  content: string;
}

/**
 * Apply a structured diff spec to a Gherkin .feature file's content, splicing
 * on `Scenario:` block boundaries the same way context-diff-routes.ts's
 * applyDiff() splices `.md` files on `## heading` boundaries.
 *
 * - existingContent === null (file doesn't exist yet): action must be 'add';
 *   `content` is written verbatim as the whole new file (including its own
 *   `Feature:` header and one or more `Scenario:` blocks).
 * - add: appends a new `Scenario:` block at the end of the file.
 * - update: replaces the named scenario's block with `content`.
 * - remove: deletes the named scenario's block entirely.
 * - update/remove on a scenario name that isn't found: no-op (logged), same
 *   as applyDiff()'s behavior for a missing `.md` section.
 */
export function applyBehaviourDiff(existingContent: string | null, spec: BehaviourDiffSpec): string {
  const { section, action, content } = spec;

  if (existingContent === null || existingContent.trim() === '') {
    if (action !== 'add') {
      logger.warn(`Behaviour diff: cannot ${action} scenario "${section}" — file does not exist yet`);
      return existingContent ?? '';
    }
    return content.trim() + '\n';
  }

  const base = existingContent.endsWith('\n') ? existingContent : existingContent + '\n';

  const scenarioRe = new RegExp(`(^|\n)(Scenario:\\s*${escapeRegex(section)}\\s*\n)`, 'm');
  const match = scenarioRe.exec(base);

  if (!match) {
    if (action === 'add') {
      return base.trimEnd() + '\n\n' + content.trim() + '\n';
    }
    logger.warn(`Behaviour diff: scenario "${section}" not found — no-op for action=${action}`);
    return base;
  }

  const blockStart = match.index + match[1].length;
  const nextBlockRe = /\n(Scenario:|Feature:)\s/g;
  nextBlockRe.lastIndex = blockStart + match[2].length;
  const nextMatch = nextBlockRe.exec(base);
  const blockEnd = nextMatch ? nextMatch.index + 1 : base.length;

  if (action === 'remove') {
    return base.slice(0, blockStart) + base.slice(blockEnd);
  }

  if (action === 'update') {
    return base.slice(0, blockStart) + content.trim() + '\n\n' + base.slice(blockEnd);
  }

  // action === 'add' with an existing (matched) name is unexpected — treat as append.
  return base.trimEnd() + '\n\n' + content.trim() + '\n';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
