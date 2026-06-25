/**
 * swagger-sync — fetches a linked Swagger/OpenAPI doc URL and caches its raw body
 * in swagger_api_docs.content. Read-only against the remote source.
 */

import axios from 'axios';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('SWAGGER-SYNC');

export interface SwaggerDocRow {
  id: number;
  doc_url: string;
}

export interface SwaggerSyncResult {
  specTitle: string | null;
  specVersion: string | null;
  syncedAt: number;
}

/** Pulls `info.title`/`info.version` out of a parsed OpenAPI/Swagger JSON doc, if present. */
function extractSpecInfo(parsed: any): { title: string | null; version: string | null } {
  const info = parsed?.info;
  return {
    title: typeof info?.title === 'string' ? info.title : null,
    version: typeof info?.version === 'string' ? info.version : null,
  };
}

/** Fetch a tracked doc's URL, cache the raw body, and record title/version if it's valid JSON. */
export async function syncSwaggerDoc(doc: SwaggerDocRow): Promise<SwaggerSyncResult> {
  const now = Date.now();
  let body: string;
  try {
    const response = await axios.get(doc.doc_url, { responseType: 'text', transformResponse: (d) => d });
    body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  } catch (err: any) {
    const message = err.response ? `HTTP ${err.response.status}` : err.message;
    db.prepare('UPDATE swagger_api_docs SET last_sync_error = ?, last_synced_at = ? WHERE id = ?')
      .run(`Failed to fetch: ${message}`, now, doc.id);
    throw new Error(`Failed to fetch ${doc.doc_url}: ${message}`);
  }

  let title: string | null = null;
  let version: string | null = null;
  let syncError: string | null = null;
  try {
    const parsed = JSON.parse(body);
    ({ title, version } = extractSpecInfo(parsed));
  } catch {
    // Not JSON (e.g. YAML spec, or an HTML Swagger UI page instead of the raw doc) —
    // still cache the raw body as context, but flag it so the admin can fix the link.
    syncError = 'Response is not valid JSON — link the raw OpenAPI/Swagger JSON document, not the Swagger UI page.';
  }

  db.prepare(`
    UPDATE swagger_api_docs
    SET content = ?, spec_title = ?, spec_version = ?, last_synced_at = ?, last_sync_error = ?
    WHERE id = ?
  `).run(body, title, version, now, syncError, doc.id);

  logger.info(`Synced swagger doc #${doc.id} (${doc.doc_url})${syncError ? ' — ' + syncError : ''}`);
  return { specTitle: title, specVersion: version, syncedAt: now };
}
