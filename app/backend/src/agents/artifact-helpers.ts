import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import db from '../data/database';
import { STAGE_ARTIFACT_TYPE } from './stage-metadata';
import Logger from '../utils/logger';

const logger = new Logger('ARTIFACT-HELPERS');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

/**
 * Saves the critic's full markdown review to disk and inserts an artifact row.
 * Returns the artifact row ID.
 */
export async function saveCriticArtifact(
  itemId: string,
  stage: string,
  fullText: string,
  sessionId?: string | null
): Promise<number> {
  const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, 'critic', 'artifacts');
  await fsAsync.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${Date.now()}-critic-${stage}.md`);
  await fsAsync.writeFile(artifactPath, fullText, 'utf-8');

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId ?? null, 'critic_review', artifactPath, Date.now());

  logger.info(`Saved critic review artifact for stage "${stage}" → ${artifactPath}`);
  return result.lastInsertRowid as number;
}

/**
 * Get the file path of the most recent architecture artifact for an item.
 */
export function getLatestArchitectureArtifactPath(itemId: string): string | null {
  const row = db.prepare<[string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode = 'architecture'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  return row?.file_path ?? null;
}

/**
 * Get the file path of the most recent artifact of a given type for an item.
 * Used to load reference documents for the critic (e.g. GTM strategy when reviewing feature marketing).
 */
export function getLatestArtifactPathByType(itemId: string, artifactType: string): string | null {
  const row = db.prepare<[string, string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  return row?.file_path ?? null;
}

/**
 * Load the most recently created artifact for an item, across all sessions.
 * Used by the critic stage to find the document to review.
 */
export function loadLatestArtifactForItem(itemId: string): { content: string; type: string } {
  const row = db.prepare<[string], { file_path: string; type: string }>(`
    SELECT a.file_path, a.type
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode IN ('prd', 'analyst', 'architecture', 'backlog')
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);

  if (!row?.file_path) return { content: '(no artifact found)', type: 'document' };
  try {
    return { content: fs.readFileSync(row.file_path, 'utf-8'), type: row.type };
  } catch {
    return { content: '(artifact file unreadable)', type: row.type };
  }
}

/**
 * Load the most recent artifact content for a specific stage.
 */
export function loadLatestArtifactForStage(itemId: string, stage: string): string | undefined {
  const artifactType = STAGE_ARTIFACT_TYPE[stage];
  if (!artifactType) return undefined;
  const row = db.prepare<[string, string], { file_path: string }>(`
    SELECT a.file_path FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  if (!row?.file_path) return undefined;
  try {
    return fs.readFileSync(row.file_path, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Load full artifact content by artifact ID.
 */
export function loadFullArtifact(artifactId: number): string | undefined {
  const row = db.prepare<[number], { file_path: string }>(
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row?.file_path) return undefined;
  try {
    return fs.readFileSync(row.file_path, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Load a truncated summary of an artifact by artifact ID.
 */
export function loadArtifactSummary(artifactId: number): string | undefined {
  const row = db.prepare<[number], { file_path: string }>(
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row?.file_path) return undefined;
  try {
    const content = fs.readFileSync(row.file_path, 'utf-8');
    return content.slice(0, 500) + (content.length > 500 ? '\n[…truncated]' : '');
  } catch {
    return undefined;
  }
}
