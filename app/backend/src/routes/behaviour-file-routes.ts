import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import db from '../data/database';
import { isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import {
  FEATURES_DIR,
  FEATURE_MAP_PATH,
  SAFE_FEATURE_FILENAME,
  behaviourVersionKey,
  recordBehaviourFileVersion,
  regenerateFeatureMap,
} from '../agents/behaviour-files';

const logger = new Logger('BEHAVIOUR-FILES');

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
  if (!SAFE_FEATURE_FILENAME.test(fileName)) {
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
    recordBehaviourFileVersion(fileName, content);
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
  if (!SAFE_FEATURE_FILENAME.test(fileName)) {
    res.status(400).json({ error: `Invalid file name: ${fileName}` });
    return;
  }

  const versions = db.prepare(
    'SELECT id, file_name, content, created_at FROM context_file_versions WHERE file_name = ? ORDER BY created_at DESC LIMIT 50'
  ).all(behaviourVersionKey(fileName)) as Array<{ id: number; file_name: string; content: string; created_at: number }>;

  res.json({ versions });
});
