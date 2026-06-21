import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import db from '../data/database';
import { isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const logger = new Logger('BEHAVIOUR-FILES');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const BEHAVIOUR_DIR = path.join(PROJECT_ROOT, 'context', 'behaviour');
const FEATURES_DIR = path.join(BEHAVIOUR_DIR, 'features');
const FEATURE_MAP_PATH = path.join(BEHAVIOUR_DIR, 'feature-map.json');

const SAFE_FILENAME = /^[a-z0-9][a-z0-9-_]*\.feature$/;
/** Namespace behaviour docs in the shared context_file_versions table so they never collide with context/*.md file names. */
const versionKey = (fileName: string) => `behaviour/${fileName}`;

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

interface FeatureMapEntry { name: string; file: string; businessRules: number; flows: Array<{ name: string; scenarioCount: number }> }

/** Look up a file's entry (name/business rules/flow count) from feature-map.json, if it exists. */
function loadFeatureMapEntries(): Map<string, FeatureMapEntry> {
  const entries = new Map<string, FeatureMapEntry>();
  try {
    const raw = fs.readFileSync(FEATURE_MAP_PATH, 'utf-8');
    const map = JSON.parse(raw);
    for (const category of Object.values(map.categories ?? {}) as any[]) {
      for (const feature of category.features ?? []) {
        entries.set(feature.file, feature);
      }
    }
  } catch { /* feature-map.json may not exist yet */ }
  return entries;
}

function labelFromFileName(fileName: string): string {
  return fileName
    .replace(/\.feature$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Re-derive feature-map.json from the current .feature files on disk, mirroring
 * scripts/generate-feature-map.ts. Kept in sync with every save so the searchable
 * index (used by the PRD-phase behaviour lookup) never drifts from an edited doc.
 */
function regenerateFeatureMap(): void {
  let files: string[];
  try {
    files = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.feature')).sort();
  } catch {
    return; // no features dir — nothing to regenerate
  }

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

/** Anyone but a view_only user may edit behaviour docs — same default as process.md (no role restriction). */
function canEdit(user: AuthRequest['user']): boolean {
  if (!user) return true; // no-auth mode
  if (user.is_admin) return true;
  return !isViewOnly(user);
}

export const behaviourFileRouter = Router();

/**
 * GET / — list behaviour doc .feature files, enriched with feature-map.json metadata.
 */
behaviourFileRouter.get('/', (_req: Request, res: Response) => {
  let files: string[];
  try {
    files = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.feature')).sort();
  } catch {
    res.json({ files: [] });
    return;
  }

  const mapEntries = loadFeatureMapEntries();
  const result = files.map((fileName) => {
    const content = readFileOrEmpty(path.join(FEATURES_DIR, fileName));
    const entry = mapEntries.get(fileName);
    const label = entry?.name || labelFromFileName(fileName);
    const flowCount = entry?.flows?.length ?? 0;
    const description = entry
      ? `${entry.businessRules} business rule(s) · ${flowCount} flow(s)`
      : 'Behaviour doc';
    return { fileName, label, description, content, editRoles: null as string[] | null };
  });

  res.json({ files: result });
});

/**
 * PUT /:fileName — save a behaviour doc and regenerate feature-map.json.
 */
behaviourFileRouter.put('/:fileName', (req: AuthRequest, res: Response) => {
  const { fileName } = req.params;
  if (!SAFE_FILENAME.test(fileName)) {
    res.status(400).json({ error: `Invalid file name: ${fileName}` });
    return;
  }

  if (!canEdit(req.user)) {
    res.status(403).json({ error: 'You do not have permission to edit behaviour docs', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  const { content } = req.body;
  if (typeof content !== 'string' || content.trim() === '') {
    res.status(400).json({ error: 'content must be a non-empty string' });
    return;
  }

  const filePath = path.join(FEATURES_DIR, fileName);
  try {
    fs.mkdirSync(FEATURES_DIR, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    db.prepare('INSERT INTO context_file_versions (file_name, content, created_at) VALUES (?, ?, ?)')
      .run(versionKey(fileName), content, Date.now());
    logger.info(`Saved behaviour doc: ${fileName} (${content.length} chars)`);
  } catch (err: any) {
    logger.error(`Failed to write behaviour doc ${fileName}: ${err.message}`);
    res.status(500).json({ error: `Failed to save file: ${err.message}` });
    return;
  }

  regenerateFeatureMap();
  res.json({ ok: true });
});

/**
 * GET /:fileName/versions — list saved versions for a behaviour doc (newest first)
 */
behaviourFileRouter.get('/:fileName/versions', (req: Request, res: Response) => {
  const { fileName } = req.params;
  if (!SAFE_FILENAME.test(fileName)) {
    res.status(400).json({ error: `Invalid file name: ${fileName}` });
    return;
  }

  const versions = db.prepare(
    'SELECT id, file_name, content, created_at FROM context_file_versions WHERE file_name = ? ORDER BY created_at DESC LIMIT 50'
  ).all(versionKey(fileName)) as Array<{ id: number; file_name: string; content: string; created_at: number }>;

  res.json({ versions });
});
