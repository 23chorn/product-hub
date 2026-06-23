/**
 * tool-context — context-retrieval tools the agents can call: read a project
 * context file by name. Registered in tool-registry.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

// ── get_context_file ──────────────────────────────────────────────────────────

export function getContextFile(input: Record<string, unknown>): string {
  const filename = input.filename;
  if (typeof filename !== 'string' || !filename) {
    return 'Error: filename must be a non-empty string';
  }

  const safe = path.basename(filename);
  if (safe !== filename || filename.includes('..') || filename.includes('/')) {
    return 'Error: invalid filename — provide only the filename, not a path';
  }

  const filePath = path.join(PROJECT_ROOT, 'context', safe);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return `Error: context file "${safe}" not found`;
  }
}
