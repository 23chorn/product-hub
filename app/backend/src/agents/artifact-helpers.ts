import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import db from '../data/database';
import { itemSessionDir } from './item-metadata';
import { STAGE_ARTIFACT_TYPE } from './stage-metadata';
import { saveToWiki, loadFromWiki, updateInWiki, wikiPathForArtifact } from '../integrations/document-store/azure-wiki-store';
import { convertArtifactToMarkdown } from '../utils/artifact-to-markdown';
import Logger from '../utils/logger';
import { findRepoRoot } from '../utils/find-repo-root';

const logger = new Logger('ARTIFACT-HELPERS');

const PROJECT_ROOT = findRepoRoot(__dirname);

type ArtifactRow = {
  id: number;
  session_id: string;
  type: string;
  file_path: string;
  external_url: string | null;
  wiki_path?: string | null;
  wiki_url?: string | null;
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

  // Extract relative portion from 'data/' onwards (handle both Unix and Windows separators)
  const dataIdx = Math.max(storedPath.indexOf('/data/sessions/'), storedPath.indexOf('\\data\\sessions\\'));
  if (dataIdx >= 0) {
    const relativePath = storedPath.slice(dataIdx + 1); // 'data/sessions/...' or 'data\sessions\...'
    const resolved = path.join(PROJECT_ROOT, relativePath);
    if (fs.existsSync(resolved)) return resolved;
  }

  // Last resort: return original path (caller handles the read error)
  return storedPath;
}

/**
 * Read content from an artifact row — disk first, wiki as last resort.
 * The wiki is a one-way export mirror, never the primary source — it's only
 * consulted here if the disk file is missing (e.g. moved/deleted).
 */
async function readArtifactRow(row: ArtifactRow): Promise<string | null> {
  if (row.file_path) {
    try {
      return fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
    } catch (err: any) {
      logger.warn(`Disk read failed for artifact file_path=${row.file_path}: ${err.message} — falling back`);
    }
  }

  if (row.wiki_path) {
    try {
      logger.info(`Falling back to wiki for artifact (disk unavailable): ${row.wiki_path}`);
      return await loadFromWiki(row.wiki_path);
    } catch (err: any) {
      logger.warn(`Wiki fallback read failed for path=${row.wiki_path}: ${err.message}`);
    }
  }

  return null;
}

function wikiStatusBanner(status: 'draft' | 'approved', date?: string, approvedBy?: string): string {
  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  if (status === 'approved') {
    const by = approvedBy ? ` by ${approvedBy}` : '';
    return `> **Status:** Approved${by} — ${dateStr}\n\n---\n\n`;
  }
  return `> **Status:** Draft — Pending review\n\n---\n\n`;
}

function stripStatusBanner(content: string): string {
  return content.replace(/^> \*\*Status:\*\*[^\n]*\n\n---\n\n/, '');
}

function toWikiContent(artifactType: string, rawContent: string, status: 'draft' | 'approved', approvedBy?: string): string {
  const clean = stripStatusBanner(rawContent);
  return wikiStatusBanner(status, undefined, approvedBy) + convertArtifactToMarkdown(artifactType, clean);
}

/**
 * Sync a local artifact to the Azure Wiki (first publish).
 * Content is converted from JSON to markdown where a converter exists.
 * The wiki is a one-way mirror — this only sets wiki_path/wiki_url, never touches
 * file_path, so the disk pointer (the primary source) stays intact.
 */
export async function syncArtifactToWiki(artifactId: number): Promise<string> {
  const artifact = db.prepare<[number], ArtifactRow>(
    'SELECT * FROM artifacts WHERE id = ?'
  ).get(artifactId);

  if (!artifact) throw new Error(`Artifact ${artifactId} not found`);
  if (artifact.wiki_path && artifact.wiki_url) {
    logger.info(`Artifact ${artifactId} already synced to wiki`);
    return artifact.wiki_url;
  }

  // Read content from the primary store (disk)
  const content = await readArtifactRow(artifact);
  if (!content) throw new Error(`Could not read artifact ${artifactId} content from disk`);

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

  // Convert JSON to markdown, prefix with Draft status banner
  const wikiPath = wikiPathForArtifact(item.title, stage);
  const { url } = await saveToWiki(wikiPath, toWikiContent(artifact.type, content, 'draft'));

  db.prepare(`
    UPDATE artifacts
    SET wiki_path = ?, wiki_url = ?
    WHERE id = ?
  `).run(wikiPath, url, artifactId);

  logger.info(`Artifact ${artifactId} synced to wiki: ${wikiPath}`);
  return url;
}

/**
 * Re-publish an already-synced wiki mirror with "Approved" status and update
 * the artifact status in the database.
 * Re-reads source content from the primary store (disk) and regenerates
 * the markdown, replacing the Draft banner.
 */
export async function approveWikiArtifact(artifactId: number, approvedBy?: string): Promise<void> {
  const artifact = db.prepare<[number], ArtifactRow>(
    'SELECT * FROM artifacts WHERE id = ?'
  ).get(artifactId);

  if (!artifact || !artifact.wiki_path) return;

  const content = await readArtifactRow(artifact);
  if (!content) {
    logger.warn(`approveWikiArtifact: could not read content for artifact ${artifactId}`);
    return;
  }

  await saveToWiki(artifact.wiki_path, toWikiContent(artifact.type, content, 'approved', approvedBy));

  // Update artifact status to approved in the database
  db.prepare(`
    UPDATE artifacts
    SET status = 'approved'
    WHERE id = ?
  `).run(artifactId);

  logger.info(`Artifact ${artifactId} wiki status updated to Approved${approvedBy ? ` by ${approvedBy}` : ''}`);
}

// ── Local artifact save (disk only, no wiki push) ────────────────────────────

/**
 * One source of truth for where a stage's on-disk outputs live:
 * data/sessions/<…>/<itemId>/<stage>/artifacts/. Both the artifact and its
 * revision diff are written here, so everything for a stage stays in one folder
 * (e.g. the analyst stage keeps its brief and brief-diff together). Callers must
 * pass the same `stage` key for the artifact and its diff so they don't split.
 */
function stageArtifactDir(itemId: string, stage: string): string {
  return path.join(itemSessionDir(itemId), stage, 'artifacts');
}

/**
 * Saves an artifact to disk under data/sessions/<itemId>/<stage>/artifacts/.
 * Used for all specialist-stage outputs that don't go to Azure Wiki or ADO directly.
 */
export async function saveLocalArtifact(
  sessionId: string,
  stage: string,
  content: string,
  itemId: string
): Promise<number> {
  const isFeatureStage             = /^story_decomposition_F\d+$/.test(stage);
  const isQaFeatureStage           = /^qa_engineer_F\d+$/.test(stage);
  const isTechRefinementFeatureStage = /^tech_refinement_F\d+$/.test(stage);
  const artifactType = isFeatureStage ? 'backlog'
    : isQaFeatureStage ? 'qa_tests'
    : isTechRefinementFeatureStage ? 'backlog'
    : (STAGE_ARTIFACT_TYPE[stage] ?? stage);

  const artifactDir = stageArtifactDir(itemId, stage);
  await fsAsync.mkdir(artifactDir, { recursive: true });
  // Every stage routed through here produces JSON by design (see STAGE_OUTPUT_FORMATS) — use
  // .json unconditionally rather than sniffing content, which mislabeled truncated/fenced JSON as .md.
  // The random suffix guards against collisions when parallel feature stages save artifacts of the
  // same type in the same millisecond — e.g. story_decomposition_F* all write type 'qa_tests' into a
  // shared dir, so a bare `${Date.now()}-${stage}.json` had them clobbering one file into corrupt JSON.
  const artifactPath = path.join(artifactDir, `${Date.now()}-${randomUUID().slice(0, 8)}-${stage}.json`);
  await fsAsync.writeFile(artifactPath, content, 'utf-8');

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, artifactType, artifactPath, Date.now());

  logger.info(`Artifact "${stage}" saved to disk: ${artifactPath}`);
  return result.lastInsertRowid as number;
}

// ── Critic artifact save ──────────────────────────────────────────────────────

/**
 * Saves the critic's full markdown review to disk. Returns the artifact row ID.
 */
export async function saveCriticArtifact(
  itemId: string,
  stage: string,
  fullText: string,
  sessionId?: string | null
): Promise<number> {
  const artifactDir = path.join(itemSessionDir(itemId), 'critic', 'artifacts');
  await fsAsync.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${Date.now()}-critic-${stage}.md`);
  await fsAsync.writeFile(artifactPath, fullText, 'utf-8');

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId ?? null, 'critic_review', artifactPath, Date.now());

  logger.info(`Critic review for stage "${stage}" saved to disk: ${artifactPath}`);
  return result.lastInsertRowid as number;
}

// ── Revision diff save ────────────────────────────────────────────────────────

/**
 * Saves a revision diff document to disk. Returns the artifact row ID, or null on failure.
 *
 * The diff is written into the same `<stage>/artifacts/` folder as the stage's artifact
 * (see saveLocalArtifact), so a stage's outputs stay together. Pass the same `stage` key
 * that was used to save the artifact — for feature revisions that's the artifact type
 * (e.g. 'backlog_F2'), not the suffixed stage name.
 */
export async function saveDiffArtifact(
  itemId: string,
  stage: string,
  diffText: string,
  sessionId: string
): Promise<number | null> {
  const artifactType = `${stage}_diff`;

  try {
    const diffDir = stageArtifactDir(itemId, stage);
    await fsAsync.mkdir(diffDir, { recursive: true });
    // Random suffix guards against collisions when sibling feature diffs (e.g. several
    // qa_tests revisions) land in the same folder in the same millisecond — mirrors saveLocalArtifact.
    const diffPath = path.join(diffDir, `${Date.now()}-${randomUUID().slice(0, 8)}-${stage}-diff.md`);
    await fsAsync.writeFile(diffPath, diffText, 'utf-8');
    const result = db.prepare(`
      INSERT INTO artifacts (session_id, type, file_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, artifactType, diffPath, Date.now());
    logger.info(`Revision diff for stage "${stage}" saved to disk: ${diffPath}`);
    return result.lastInsertRowid as number;
  } catch (err: any) {
    logger.warn(`Failed to save revision diff for "${stage}": ${err.message}`);
    return null;
  }
}

// ── Content loaders (async — fetches from wiki or disk) ───────────────────────

/**
 * True if `content` parses as JSON (optionally wrapped in a ```json fence). Every workflow
 * artifact is stored as JSON by design — this is used to detect when a loaded "prior draft"
 * is actually the wiki's markdown mirror leaking through readArtifactRow's last-resort
 * fallback (disk content unreadable), rather than the canonical artifact. Feeding that
 * markdown to a specialist as its own "previous response" during a revision confuses it about
 * the expected output format.
 */
export function isJsonArtifactContent(content: string): boolean {
  const stripped = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try {
    JSON.parse(stripped);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the artifact `type` column value that holds a stage's latest output — the single
 * source of truth for the two cases STAGE_ARTIFACT_TYPE can't express as a static map:
 * story_decomposition_F<n> saves under 'backlog_F<n>' (see runMultiAgentFeatureStage), and
 * epic_qa saves under 'qa_tests' (see runEpicQaStage). Every reader that needs a stage's
 * prior artifact — human reiteration, change-request cascades — must resolve through this
 * so the two never drift out of sync with where the writers actually save.
 */
function resolveStageArtifactType(stage: string): string | undefined {
  const featureMatch = stage.match(/^story_decomposition_F(\d+)$/);
  if (featureMatch) return `backlog_F${featureMatch[1]}`;
  if (stage === 'epic_qa') return 'qa_tests';
  return STAGE_ARTIFACT_TYPE[stage];
}

/**
 * Load the prior draft for a stage so it can be threaded into a specialist's conversation
 * as its own previous response (surgical revision) instead of a from-scratch regeneration.
 * Returns undefined if the stage has no known artifact type, no artifact exists yet, or the
 * stored content isn't JSON (see isJsonArtifactContent — a wiki markdown mirror leaking
 * through as the "prior draft" would derail the revision, so treat it as absent instead).
 */
export async function loadPriorDraftForStage(itemId: string, stage: string): Promise<string | undefined> {
  const artifactType = resolveStageArtifactType(stage);
  if (!artifactType) return undefined;

  const content = await loadLatestArtifactContent(itemId, artifactType);
  if (!content) return undefined;

  if (!isJsonArtifactContent(content)) {
    logger.warn(`loadPriorDraftForStage: artifact content for stage "${stage}" is not JSON (likely wiki fallback) — treating as no prior draft`);
    return undefined;
  }
  return content;
}

/**
 * Load content for a specific artifact by DB row ID.
 */
export async function loadArtifactContentById(artifactId: number): Promise<string | null> {
  const row = db.prepare<[number], ArtifactRow>(
    'SELECT file_path, wiki_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) return null;
  logger.info(`Loading artifact id=${artifactId} from disk`);
  return readArtifactRow(row);
}

/**
 * Load the most recent artifact content for an item by artifact type.
 * Primary source is disk; falls back to the wiki mirror only if that's unavailable.
 */
export async function loadLatestArtifactContent(itemId: string, artifactType: string): Promise<string | null> {
  const row = db.prepare<[string, string], ArtifactRow>(`
    SELECT a.file_path, a.wiki_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);

  if (!row) {
    // A missing artifact is often expected (optional stages, prior-stage probes), so this
    // stays at debug. The full artifact inventory — useful when chasing an unexpected miss —
    // is only queried when debug logging is actually on, to avoid an extra query per miss.
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      const allArtifacts = db.prepare<[string], { type: string; created_at: number }>(`
        SELECT a.type, a.created_at
        FROM artifacts a
        JOIN sessions s ON a.session_id = s.id
        WHERE s.item_id = ?
        ORDER BY a.created_at DESC
      `).all(itemId);
      logger.debug(`No "${artifactType}" artifact for item ${itemId}; available:`, allArtifacts);
    }
    return null;
  }

  logger.debug(`Loaded "${artifactType}" artifact for item ${itemId}: ${row.file_path}`);
  return readArtifactRow(row);
}

/**
 * Look up the Azure Wiki URL for the most recent artifact of a given type for an item.
 * Cheap, sync, column-only read — does not load artifact content. Returns null if the
 * artifact doesn't exist yet or was never synced to the wiki.
 */
export function loadLatestArtifactWikiUrl(itemId: string, artifactType: string): string | null {
  const row = db.prepare<[string, string], { wiki_url: string | null }>(`
    SELECT a.wiki_url
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  return row?.wiki_url ?? null;
}

/**
 * Update artifact content — writes to the primary store (disk).
 * If a wiki mirror exists for this artifact, best-effort refreshes it too (as Draft) —
 * a wiki push failure must not block saving the primary content.
 */
export async function updateArtifactContent(artifactId: number, content: string): Promise<{ url?: string }> {
  const row = db.prepare<[number], ArtifactRow>(
    'SELECT id, session_id, type, file_path, external_url, wiki_path, wiki_url FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) throw new Error(`Artifact ${artifactId} not found`);

  if (row.file_path) {
    fs.writeFileSync(resolveArtifactPath(row.file_path), content, 'utf-8');
  } else {
    throw new Error(`Artifact ${artifactId} has no storage location`);
  }

  if (row.wiki_path) {
    try {
      const { url } = await updateInWiki(row.wiki_path, toWikiContent(row.type, content, 'draft'));
      if (url !== row.wiki_url) {
        db.prepare('UPDATE artifacts SET wiki_url = ? WHERE id = ?').run(url, artifactId);
      }
      logger.info(`[UPDATE] wiki mirror refreshed ✓ ${row.wiki_path}`);
      return { url };
    } catch (err: any) {
      logger.warn(`[UPDATE] wiki mirror refresh failed for ${row.wiki_path}: ${err.message}`);
    }
  }

  return {};
}

// ── Legacy sync loaders (kept for backward compat with non-async callers) ─────

/**
 * Load the most recently created artifact for an item across all sessions.
 * Used by the critic stage to find the document to review.
 */
export function loadLatestArtifactForItem(itemId: string): { content: string; type: string } {
  const row = db.prepare<[string], ArtifactRow & { type: string }>(`
    SELECT a.file_path, a.type
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode IN ('prd', 'analyst', 'architecture', 'backlog')
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);

  if (!row) return { content: '(no artifact found)', type: 'document' };
  if (!row.file_path) return { content: '(no artifact found)', type: row.type };

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
    SELECT a.file_path FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  if (!row) return undefined;
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
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) return undefined;
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
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row) return undefined;
  if (!row.file_path) return undefined;
  try {
    const content = fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
    return content.slice(0, 500) + (content.length > 500 ? '\n[…truncated]' : '');
  } catch {
    return undefined;
  }
}

// ── Path helpers (used by legacy code) ───────────────────────────────────────

/**
 * Get the file path of the most recent architecture artifact for an item.
 */
export function getLatestArchitectureArtifactPath(itemId: string): string | null {
  const row = db.prepare<[string], ArtifactRow>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode = 'architecture'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  if (!row || !row.file_path) return null;
  return resolveArtifactPath(row.file_path);
}

/**
 * Get the file path of the most recent artifact of a given type for an item.
 */
export function getLatestArtifactPathByType(itemId: string, artifactType: string): string | null {
  const row = db.prepare<[string, string], ArtifactRow>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  if (!row || !row.file_path) return null;
  return resolveArtifactPath(row.file_path);
}
