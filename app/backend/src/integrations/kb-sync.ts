/**
 * kb-sync — pulls `.md` files from a tracked Azure DevOps repo into kb_files.
 * Read-only against the repo: never writes back, never edits the fetched content.
 */

import db from '../data/database';
import { getAzureDevOpsClient } from './azure-devops';
import Logger from '../utils/logger';

const logger = new Logger('KB-SYNC');

export interface KbRepoRow {
  id: number;
  repository: string;
  branch: string | null;
  project: string | null;
}

export interface DocFrontmatter {
  fileName: string | null;
  owner: string | null;
  status: string | null;
  valid: boolean;
}

/** Split the required `file-name:`/`owner:`/`status:` frontmatter block from a doc's body. */
export function parseDocFrontmatter(raw: string): DocFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { fileName: null, owner: null, status: null, valid: false };

  const block = match[1];
  const read = (key: string): string | null => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };

  const fileName = read('file-name');
  const owner = read('owner');
  const status = read('status');
  return { fileName, owner, status, valid: Boolean(fileName && owner && status) };
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  invalidFrontmatterCount: number;
}

/** Re-fetch every `.md` file in a tracked repo and reconcile it against kb_files. */
export async function syncRepo(repo: KbRepoRow): Promise<SyncResult> {
  const client = getAzureDevOpsClient();
  const remoteFiles = await client.listAdoMarkdownFiles(repo.repository, repo.branch ?? undefined, repo.project ?? undefined);

  const existingRows = db.prepare('SELECT id, path FROM kb_files WHERE repo_id = ?').all(repo.id) as Array<{ id: number; path: string }>;
  const existingByPath = new Map(existingRows.map((row) => [row.path, row.id]));
  const remotePaths = new Set(remoteFiles.map((f) => f.path));

  const now = Date.now();
  let added = 0;
  let updated = 0;
  let invalidFrontmatterCount = 0;

  const insert = db.prepare(`
    INSERT INTO kb_files (repo_id, path, frontmatter_file_name, frontmatter_owner, frontmatter_status, frontmatter_valid, content, commit_id, last_synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE kb_files SET frontmatter_file_name = ?, frontmatter_owner = ?, frontmatter_status = ?, frontmatter_valid = ?, content = ?, commit_id = ?, last_synced_at = ?
    WHERE id = ?
  `);

  for (const file of remoteFiles) {
    const { content, commitId } = await client.getAdoFileContent(repo.repository, file.path, repo.branch ?? undefined, repo.project ?? undefined);
    const frontmatter = parseDocFrontmatter(content);
    if (!frontmatter.valid) invalidFrontmatterCount++;

    const existingId = existingByPath.get(file.path);
    if (existingId) {
      update.run(frontmatter.fileName, frontmatter.owner, frontmatter.status, frontmatter.valid ? 1 : 0, content, commitId, now, existingId);
      updated++;
    } else {
      insert.run(repo.id, file.path, frontmatter.fileName, frontmatter.owner, frontmatter.status, frontmatter.valid ? 1 : 0, content, commitId, now, now);
      added++;
    }
  }

  const removedPaths = existingRows.filter((row) => !remotePaths.has(row.path));
  if (removedPaths.length > 0) {
    const del = db.prepare('DELETE FROM kb_files WHERE id = ?');
    for (const row of removedPaths) del.run(row.id);
  }

  db.prepare('UPDATE kb_repos SET last_synced_at = ? WHERE id = ?').run(now, repo.id);

  logger.info(`Synced ${repo.repository}: +${added} ~${updated} -${removedPaths.length} (${invalidFrontmatterCount} missing/invalid frontmatter)`);
  return { added, updated, removed: removedPaths.length, invalidFrontmatterCount };
}
