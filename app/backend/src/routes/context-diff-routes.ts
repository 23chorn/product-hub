import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import db from '../data/database';
import { invalidateContextCache } from '../agents/specialist-agent';
import Logger from '../utils/logger';
import { findRepoRoot } from '../utils/find-repo-root';

const logger = new Logger('CONTEXT-DIFF-ROUTES');
export const contextDiffRouter = Router();

const PROJECT_ROOT  = findRepoRoot(__dirname);
const CONTEXT_ROOT  = path.join(PROJECT_ROOT, 'context');

// ── DB row types ──────────────────────────────────────────────────────────────

interface ContextDiffRow {
  id: number;
  workflow_id: string | null;
  file_name: string;
  diff_content: string;   // JSON: { section, action, content }
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  created_at: number;
}

interface DiffSpec {
  section: string;
  action: 'add' | 'update' | 'remove';
  content: string;
}

// ── Prepared statements ───────────────────────────────────────────────────────

const stmts = {
  getDiff: db.prepare<[number], ContextDiffRow>('SELECT * FROM context_diffs WHERE id = ?'),
  updateStatus: db.prepare(`UPDATE context_diffs SET status = ?, approved_by = ? WHERE id = ?`),
  getPending: db.prepare<[], ContextDiffRow>(
    `SELECT * FROM context_diffs WHERE status = 'pending' ORDER BY created_at ASC`
  ),
};

// ── GET /api/context-diffs/pending ────────────────────────────────────────────

contextDiffRouter.get('/pending', (_req: Request, res: Response) => {
  try {
    const diffs = stmts.getPending.all();
    res.json({ diffs });
  } catch (err: any) {
    logger.error('Failed to fetch pending diffs', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/context-diffs/:id/approve ───────────────────────────────────────

contextDiffRouter.post('/:id/approve', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid diff ID' });

  const approvedBy: string = (req.body as { approvedBy?: string }).approvedBy ?? 'human';

  try {
    const diff = stmts.getDiff.get(id);
    if (!diff) return res.status(404).json({ error: `Context diff not found: ${id}` });
    if (diff.status !== 'pending') {
      return res.status(400).json({ error: `Diff ${id} is not pending (current: ${diff.status})` });
    }

    // Parse diff spec
    let spec: DiffSpec;
    try {
      spec = JSON.parse(diff.diff_content) as DiffSpec;
    } catch {
      return res.status(422).json({ error: 'diff_content is not valid JSON' });
    }

    const filePath = path.join(CONTEXT_ROOT, diff.file_name);

    // Read existing file (create empty string if it doesn't exist yet)
    let fileContent = '';
    try {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // New file — will be created
    }

    const updated = applyDiff(fileContent, spec);

    // ── Atomic write: temp file → rename ────────────────────────────────────
    const tmpPath = path.join(os.tmpdir(), `pap-ctx-${id}-${Date.now()}.md`);
    fs.writeFileSync(tmpPath, updated, 'utf-8');
    fs.mkdirSync(CONTEXT_ROOT, { recursive: true });
    fs.renameSync(tmpPath, filePath);

    logger.info(`Applied context diff ${id} (${spec.action}) to ${diff.file_name}`);

    // Invalidate the in-memory context cache so next agent request picks up the change
    invalidateContextCache();

    // Mark approved
    stmts.updateStatus.run('approved', approvedBy, id);

    res.json({ ok: true, fileName: diff.file_name, content: updated });
  } catch (err: any) {
    logger.error(`Failed to apply context diff ${id}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/context-diffs/:id/reject ───────────────────────────────────────

contextDiffRouter.post('/:id/reject', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid diff ID' });

  try {
    const diff = stmts.getDiff.get(id);
    if (!diff) return res.status(404).json({ error: `Context diff not found: ${id}` });
    if (diff.status !== 'pending') {
      return res.status(400).json({ error: `Diff ${id} is not pending (current: ${diff.status})` });
    }

    stmts.updateStatus.run('rejected', null, id);
    logger.info(`Rejected context diff ${id} for ${diff.file_name}`);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Failed to reject context diff ${id}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── Diff application logic ────────────────────────────────────────────────────

/**
 * Apply a structured diff spec to markdown file content.
 *
 * - add:    append `content` inside the target section (after existing content, before next ##).
 * - update: replace everything inside the target section with `content`.
 * - remove: delete the target section and its content entirely.
 *
 * If the target section does not exist and action is 'add', appends a new section to the file.
 */
function applyDiff(fileContent: string, spec: DiffSpec): string {
  const { section, action, content } = spec;

  // Normalise: ensure file ends with newline
  const base = fileContent.endsWith('\n') ? fileContent : fileContent + '\n';

  // Match `## {section}` heading (any amount of leading/trailing whitespace)
  const headingRe = new RegExp(`(^|\n)(##\\s+${escapeRegex(section)}\\s*\n)`, 'm');
  const headingMatch = headingRe.exec(base);

  if (!headingMatch) {
    // Section not found
    if (action === 'add') {
      // Append new section at end of file
      const block = `\n## ${section}\n\n${content.trim()}\n`;
      return base + block;
    }
    // update/remove on non-existent section — no-op
    logger.warn(`Context diff: section "## ${section}" not found in file — no-op for action=${action}`);
    return base;
  }

  const sectionStart = headingMatch.index + headingMatch[1].length; // start of "## {section}\n"
  const afterHeading = sectionStart + headingMatch[2].length;        // start of section body

  // Find where this section ends (next ## heading or EOF)
  const nextHeadingRe = /\n##\s/g;
  nextHeadingRe.lastIndex = afterHeading;
  const nextMatch = nextHeadingRe.exec(base);
  const sectionEnd = nextMatch ? nextMatch.index + 1 : base.length; // +1 to keep the leading \n

  if (action === 'remove') {
    return base.slice(0, sectionStart) + base.slice(sectionEnd);
  }

  if (action === 'update') {
    const newSection = headingMatch[2] + content.trim() + '\n\n';
    return base.slice(0, sectionStart) + newSection + base.slice(sectionEnd);
  }

  if (action === 'add') {
    // Insert content before the next section (or at sectionEnd)
    const body = base.slice(afterHeading, sectionEnd);
    const newBody = body.trimEnd() + '\n\n' + content.trim() + '\n\n';
    return base.slice(0, afterHeading) + newBody + base.slice(sectionEnd);
  }

  return base;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
