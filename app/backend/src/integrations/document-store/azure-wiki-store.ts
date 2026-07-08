import { getAzureDevOpsClient } from '../azure-devops';
import Logger from '../../utils/logger';

const logger = new Logger('WIKI-STORE');

// Wiki page labels per stage — matches the path structure used by the existing auto-publish flow
export const STAGE_WIKI_LABELS: Record<string, string> = {
  analyst:            'Research Brief',
  pm_prd:             'PRD',
  solution_architect: 'Architecture',
  story_decomposition:'Backlog',
  qa_engineer:        'QA Test Plan',
};

const BASE_PATH = '/Product Documentation/Features';

/**
 * Build the canonical wiki path for an artifact.
 * e.g. /Product Documentation/Features/In-App Messaging/PRD
 */
export function wikiPathForArtifact(itemTitle: string, stage: string): string {
  const safeName = itemTitle.replace(/[/\\:*?"<>|#]/g, '').trim();
  const pageLabel = STAGE_WIKI_LABELS[stage] ?? stage;
  return `${BASE_PATH}/${safeName}/${pageLabel}`;
}

// Reuse the shared client (lazily created — avoids instantiation at import time
// before dotenv runs).
const getClient = getAzureDevOpsClient;

/**
 * Save content to the wiki at the given path.
 * Creates parent pages if needed. Returns the path and browser URL.
 */
export async function saveToWiki(path: string, content: string): Promise<{ path: string; url: string }> {
  const client = getClient();
  await client.ensureWikiPath(client.wikiIdentifier, path);
  const { url } = await client.upsertWikiPage(client.wikiIdentifier, path, content);
  logger.info(`Saved to wiki: ${path}`);
  return { path, url };
}

/**
 * Fetch content from the wiki page at the given path.
 */
export async function loadFromWiki(path: string): Promise<string> {
  const client = getClient();
  return client.getWikiPageContent(client.wikiIdentifier, path);
}

/**
 * Update an existing wiki page (alias for saveToWiki — upsert is idempotent).
 */
export async function updateInWiki(path: string, content: string): Promise<{ url: string }> {
  const client = getClient();
  const { url } = await client.upsertWikiPage(client.wikiIdentifier, path, content);
  logger.info(`Updated wiki page: ${path}`);
  return { url };
}

/**
 * Delete a wiki page. Silently swallows 404 (already deleted or never created).
 */
export async function deleteFromWiki(path: string): Promise<void> {
  const client = getClient();
  await client.deleteWikiPage(client.wikiIdentifier, path);
}
