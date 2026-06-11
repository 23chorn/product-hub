import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import db from '../data/database';
import { STAGE_ARTIFACT_TYPE } from './stage-metadata';
import { saveToWiki, loadFromWiki, wikiPathForArtifact } from '../integrations/document-store/azure-wiki-store';
import Logger from '../utils/logger';

const logger = new Logger('ARTIFACT-HELPERS');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

type ArtifactRow = {
  file_path: string;
  external_system: string | null;
  external_path: string | null;
};

/**
 * Resolve a stored artifact file_path to the current project root.
 *
 * Artifact paths are stored as absolute paths in the DB. If the project
 * directory is moved or renamed, the stored paths become stale. This
 * function extracts the relative portion (from 'data/' onwards) and
 * re-resolves it against the current PROJECT_ROOT.
 *
 * Falls back to the original path if the relative portion can't be extracted.
 */
export function resolveArtifactPath(storedPath: string): string {
  if (!storedPath) return storedPath;
  // If the file exists at the stored path, use it as-is (fast path)
  if (fs.existsSync(storedPath)) return storedPath;

  // Extract relative portion from 'data/' onwards
  const dataIdx = storedPath.indexOf('/data/sessions/');
  if (dataIdx >= 0) {
    const relativePath = storedPath.slice(dataIdx + 1); // 'data/sessions/...'
    const resolved = path.join(PROJECT_ROOT, relativePath);
    if (fs.existsSync(resolved)) return resolved;
  }

  // Last resort: return original path (caller handles the read error)
  return storedPath;
}

/**
 * Read content from an artifact row — fetches from the wiki for external artifacts,
 * reads from disk for local ones.
 */
async function readArtifactRow(row: ArtifactRow): Promise<string | null> {
  if (row.external_system === 'azure_wiki' && row.external_path) {
    logger.info(`[FETCH] azure_wiki → ${row.external_path}`);
    try {
      const content = await loadFromWiki(row.external_path);
      logger.info(`[FETCH] azure_wiki ✓ ${row.external_path} (${content?.length ?? 0} chars)`);
      return content;
    } catch (err: any) {
      logger.warn(`[FETCH] azure_wiki ✗ ${row.external_path}: ${err.message}`);
      return null;
    }
  }
  if (row.file_path) {
    try {
      return fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
    } catch {
      return null;
    }
  }
  return null;
}

// ── Main artifact save (wiki-backed) ─────────────────────────────────────────

/**
 * Saves a main document artifact to the Azure Wiki and inserts an artifact row
 * with the external reference. Returns the artifact row ID.
 *
 * Used for all human-facing document types: research, PRD, architecture, backlog,
 * GTM strategy, feature marketing, QA tests, tech refinement, and prototype.
 */
export async function saveMainArtifact(
  sessionId: string,
  stage: string,
  content: string,
  itemId: string,
  skillVersionId?: number | null
): Promise<number> {
  const artifactType = STAGE_ARTIFACT_TYPE[stage] ?? stage;

  const itemRow = db.prepare<[string], { title: string }>(
    'SELECT title FROM items WHERE id = ?'
  ).get(itemId);
  if (!itemRow) throw new Error(`Item ${itemId} not found`);

  const wikiPath = wikiPathForArtifact(itemRow.title, stage);
  const { url } = await saveToWiki(wikiPath, content);

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, external_system, external_path, external_url, skill_version_id, created_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?)
  `).run(sessionId, artifactType, 'azure_wiki', wikiPath, url, skillVersionId ?? null, Date.now());

  logger.info(`Main artifact "${stage}" saved to wiki: ${wikiPath}`);
  return result.lastInsertRowid as number;
}

/**
 * Sync a local artifact to Azure Wiki after first human approval.
 * Updates the artifact row to add external_system, external_path, and external_url.
 */
export async function syncArtifactToWiki(artifactId: number): Promise<string> {
  const artifact = db.prepare<[number], ArtifactRow>(
    'SELECT * FROM artifacts WHERE id = ?'
  ).get(artifactId);

  if (!artifact) throw new Error(`Artifact ${artifactId} not found`);
  if (artifact.external_system === 'azure_wiki') {
    logger.info(`Artifact ${artifactId} already synced to wiki`);
    return artifact.external_url!;
  }

  // Read local content
  const content = await fsAsync.readFile(artifact.file_path, 'utf-8');

  // Get item title for wiki path
  const session = db.prepare<[string], { item_id: string }>(
    'SELECT item_id FROM sessions WHERE id = ?'
  ).get(artifact.session_id);
  if (!session) throw new Error(`Session ${artifact.session_id} not found`);

  const item = db.prepare<[string], { title: string }>(
    'SELECT title FROM items WHERE id = ?'
  ).get(session.item_id);
  if (!item) throw new Error(`Item ${session.item_id} not found`);

  // Determine stage from artifact type (reverse mapping)
  const stageEntry = Object.entries(STAGE_ARTIFACT_TYPE).find(([, type]) => type === artifact.type);
  const stage = stageEntry ? stageEntry[0] : artifact.type;

  // Push to wiki
  const wikiPath = wikiPathForArtifact(item.title, stage);
  const { url } = await saveToWiki(wikiPath, content);

  // Update artifact row
  db.prepare(`
    UPDATE artifacts
    SET external_system = ?, external_path = ?, external_url = ?
    WHERE id = ?
  `).run('azure_wiki', wikiPath, url, artifactId);

  logger.info(`Artifact ${artifactId} synced to wiki: ${wikiPath}`);
  return url;
}

// ── Local artifact save (disk only, no wiki push) ────────────────────────────

/**
 * Saves an artifact to local disk only — no wiki push.
 * Used for stages whose output goes directly to ADO rather than the Azure Wiki
 * (pm_backlog, tech_refinement, qa_engineer).
 */
export async function saveLocalArtifact(
  sessionId: string,
  stage: string,
  content: string,
  itemId: string,
  skillVersionId?: number | null
): Promise<number> {
  // Feature-specific stages (story_decomposition_F1, F2, etc.) use 'backlog' type
  // QA feature-specific stages (qa_engineer_F1, F2, etc.) use 'qa_tests' type
  // Tech refinement feature-specific stages (tech_refinement_F1, F2, etc.) use 'backlog' type
  const isFeatureStage = /^story_decomposition_F\d+$/.test(stage);
  const isQaFeatureStage = /^qa_engineer_F\d+$/.test(stage);
  const isTechRefinementFeatureStage = /^tech_refinement_F\d+$/.test(stage);
  const artifactType = isFeatureStage ? 'backlog'
    : isQaFeatureStage ? 'qa_tests'
    : isTechRefinementFeatureStage ? 'backlog'
    : (STAGE_ARTIFACT_TYPE[stage] ?? stage);
  const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, stage, 'artifacts');
  await fsAsync.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${Date.now()}-${stage}.json`);
  await fsAsync.writeFile(artifactPath, content, 'utf-8');

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, skill_version_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, artifactType, artifactPath, skillVersionId ?? null, Date.now());

  logger.info(`Local artifact "${stage}" saved: ${artifactPath}`);
  return result.lastInsertRowid as number;
}

// ── Critic artifact save (local disk) ────────────────────────────────────────

/**
 * Saves the critic's full markdown review to disk and inserts an artifact row.
 * Critic reviews are internal workflow plumbing — they stay local.
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

// ── Content loaders (async — fetches from wiki or disk) ───────────────────────

/**
 * Load content for a specific artifact by DB row ID.
 */
export async function loadArtifactContentById(artifactId: number): Promise<string | null> {
  const row = db.prepare<[number], ArtifactRow>(
    'SELECT file_path, external_system, external_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) return null;
  logger.info(`Loading artifact id=${artifactId} via ${row.external_system ?? 'local disk'}`);
  return readArtifactRow(row);
}

/**
 * Load the most recent artifact content for an item by artifact type.
 * Fetches from wiki for externally stored artifacts, reads from disk otherwise.
 */
export async function loadLatestArtifactContent(itemId: string, artifactType: string): Promise<string | null> {
  logger.info(`[ARTIFACT-LOAD] Looking for artifact: itemId=${itemId}, type=${artifactType}`);

  const row = db.prepare<[string, string], ArtifactRow>(`
    SELECT a.file_path, a.external_system, a.external_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);

  if (!row) {
    // Debug: show what artifacts exist for this item
    const allArtifacts = db.prepare<[string], { type: string; created_at: number; file_path: string }>(`
      SELECT a.type, a.created_at, a.file_path
      FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ?
      ORDER BY a.created_at DESC
    `).all(itemId);
    logger.warn(`[ARTIFACT-LOAD] No artifact found for type=${artifactType}. Available artifacts for item ${itemId}: ${JSON.stringify(allArtifacts)}`);
    return null;
  }

  logger.info(`[ARTIFACT-LOAD] Found artifact: ${row.file_path}`);
  return readArtifactRow(row);
}

/**
 * Update an externally stored artifact's content (pushes to wiki).
 * Falls back to overwriting the local file for disk-backed artifacts.
 */
export async function updateArtifactContent(artifactId: number, content: string): Promise<{ url?: string }> {
  const row = db.prepare<[number], ArtifactRow & { external_url: string | null }>(
    'SELECT file_path, external_system, external_path, external_url FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) throw new Error(`Artifact ${artifactId} not found`);

  if (row.external_system === 'azure_wiki' && row.external_path) {
    logger.info(`[UPDATE] azure_wiki → ${row.external_path}`);
    const { url } = await import('../integrations/document-store/azure-wiki-store').then(m =>
      m.updateInWiki(row.external_path!, content)
    );
    logger.info(`[UPDATE] azure_wiki ✓ ${row.external_path}`);
    db.prepare('UPDATE artifacts SET external_url = ? WHERE id = ?').run(url, artifactId);
    return { url };
  }

  if (row.file_path) {
    fs.writeFileSync(resolveArtifactPath(row.file_path), content, 'utf-8');
    return {};
  }

  throw new Error(`Artifact ${artifactId} has no storage location`);
}

// ── Legacy sync loaders (kept for backward compat with non-async callers) ─────

/**
 * Load the most recently created artifact for an item across all sessions.
 * Used by the critic stage to find the document to review.
 */
export function loadLatestArtifactForItem(itemId: string): { content: string; type: string } {
  const row = db.prepare<[string], ArtifactRow & { type: string }>(`
    SELECT a.file_path, a.external_system, a.external_path, a.type
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode IN ('prd', 'analyst', 'architecture', 'backlog')
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);

  if (!row) return { content: '(no artifact found)', type: 'document' };
  if (!row.file_path && !row.external_path) return { content: '(no artifact found)', type: row.type };

  // External artifacts — can't read synchronously; callers should migrate to loadLatestArtifactContent
  if (row.external_system === 'azure_wiki') {
    logger.warn(`loadLatestArtifactForItem called for wiki-backed artifact — content unavailable synchronously`);
    return { content: '(artifact stored in wiki — use async loader)', type: row.type };
  }

  try {
    return { content: fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8'), type: row.type };
  } catch {
    return { content: '(artifact file unreadable)', type: row.type };
  }
}

/**
 * Load the most recent artifact content for a specific stage (sync, disk only).
 * @deprecated Use loadLatestArtifactContent() for wiki-backed artifacts.
 */
export function loadLatestArtifactForStage(itemId: string, stage: string): string | undefined {
  const artifactType = STAGE_ARTIFACT_TYPE[stage];
  if (!artifactType) return undefined;
  const row = db.prepare<[string, string], ArtifactRow>(`
    SELECT a.file_path, a.external_system, a.external_path FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  if (!row) return undefined;
  if (row.external_system === 'azure_wiki') {
    logger.warn(`loadLatestArtifactForStage called for wiki-backed artifact (${stage}) — use async loader`);
    return undefined;
  }
  if (!row.file_path) return undefined;
  try {
    return fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Load full artifact content by artifact ID (sync, disk only).
 * @deprecated Use loadArtifactContentById() for wiki-backed artifacts.
 */
export function loadFullArtifact(artifactId: number): string | undefined {
  const row = db.prepare<[number], ArtifactRow>(
    'SELECT file_path, external_system, external_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) return undefined;
  if (row.external_system === 'azure_wiki') {
    logger.warn(`loadFullArtifact called for wiki-backed artifact ${artifactId} — use async loader`);
    return undefined;
  }
  if (!row.file_path) return undefined;
  try {
    return fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Load a truncated summary of an artifact by artifact ID (sync, disk only).
 */
export function loadArtifactSummary(artifactId: number): string | undefined {
  const row = db.prepare<[number], ArtifactRow>(
    'SELECT file_path, external_system, external_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) return undefined;
  if (row.external_system === 'azure_wiki') return '(stored in wiki)';
  if (!row.file_path) return undefined;
  try {
    const content = fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
    return content.slice(0, 500) + (content.length > 500 ? '\n[…truncated]' : '');
  } catch {
    return undefined;
  }
}

// ── Path helpers (used by legacy code; return null for external artifacts) ────

/**
 * Get the file path of the most recent architecture artifact for an item.
 * Returns null for externally stored artifacts — use loadLatestArtifactContent() instead.
 */
export function getLatestArchitectureArtifactPath(itemId: string): string | null {
  const row = db.prepare<[string], ArtifactRow>(`
    SELECT a.file_path, a.external_system, a.external_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode = 'architecture'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  if (!row) return null;
  if (row.external_system) return null;
  return resolveArtifactPath(row.file_path);
}

/**
 * Get the file path of the most recent artifact of a given type for an item.
 * Returns null for externally stored artifacts — use loadLatestArtifactContent() instead.
 */
export function getLatestArtifactPathByType(itemId: string, artifactType: string): string | null {
  const row = db.prepare<[string, string], ArtifactRow>(`
    SELECT a.file_path, a.external_system, a.external_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  if (!row) return null;
  if (row.external_system) return null;
  return resolveArtifactPath(row.file_path);
}
