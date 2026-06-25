import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { hasAnyUsers } from '../data/users';
import { isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { findRepoRoot } from '../utils/find-repo-root';

export const skillRoutes = Router();

const PROJECT_ROOT = findRepoRoot(__dirname);
const PERSONAS_DIR = path.join(PROJECT_ROOT, 'agents', 'personas');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'agents', 'templates');

/**
 * Which roles may edit each agent file, keyed by its filename stem (e.g. "analyst"
 * for analyst.md, "research.template" for research.template.md). null = any
 * authenticated user. [] = admin only. Files not listed here default to null
 * (unrestricted).
 */
const AGENT_EDIT_ROLES: Record<string, string[]> = {
  // Product agents
  analyst:                  ['product'],
  'research.template':      ['product'],
  pm:                       ['product'],
  'prd.template':           ['product'],
  'epic-feature-planner':   ['product'],
  'epic-features.template': ['product'],
  'story-decomposition':    ['product'],
  'backlog.template':       ['product'],
  curator:                  ['product'],
  'doc-reviewer':           ['product'],
  'doc-review.template':    ['product'],
  'discovery-scout':        ['product'],
  'discovery.template':     ['product'],
  // Technical agents
  architect:                ['tech_lead'],
  'architecture.template':  ['tech_lead'],
  'ios-engineer':            ['tech_lead'],
  'android-engineer':        ['tech_lead'],
  'backend-engineer':        ['tech_lead'],
  'web-engineer':            ['tech_lead'],
  'qa-engineer':             ['qa'],
  'figma-designer':          ['design'],
  'figma-design.template':  ['design'],
  // Meta / infrastructure agents — admin only
  coordinator:               [],
  'critic-core':             [],
  'prototype-builder':       [],
  'prototype.template':      [],
};

interface AgentFile {
  key: string;
  dir: 'personas' | 'templates';
}

/** One source of truth for "what's editable" — a directory scan, not a hardcoded map. */
function listAgentFiles(): AgentFile[] {
  const files: AgentFile[] = [];
  for (const name of fs.readdirSync(PERSONAS_DIR)) {
    if (!name.endsWith('.md')) continue;
    files.push({ key: name.slice(0, -3), dir: 'personas' });
  }
  for (const name of fs.readdirSync(TEMPLATES_DIR)) {
    if (!name.endsWith('.md')) continue;
    files.push({ key: name.slice(0, -3), dir: 'templates' });
  }
  return files;
}

/**
 * Resolve a client-supplied key to a file path — only ever via exact match against
 * the directory scan above, never by joining the raw key directly. Rules out path
 * traversal: an unmatched key (e.g. containing "..") simply resolves to null.
 */
function resolveFile(key: string): { dir: AgentFile['dir']; filePath: string } | null {
  const match = listAgentFiles().find(f => f.key === key);
  if (!match) return null;
  const baseDir = match.dir === 'personas' ? PERSONAS_DIR : TEMPLATES_DIR;
  return { dir: match.dir, filePath: path.join(baseDir, `${match.key}.md`) };
}

function canEditFile(user: AuthRequest['user'], key: string): boolean {
  if (!hasAnyUsers()) return true;
  if (!user) return false;
  if (user.is_admin) return true;
  if (isViewOnly(user)) return false;
  const roles = AGENT_EDIT_ROLES[key];
  if (roles === undefined) return true;   // unlisted file — unrestricted
  if (roles.length === 0) return false;   // admin only
  return roles.some(r => user.roles.includes(r));
}

skillRoutes.get('/', (_req, res) => {
  const files = listAgentFiles().map(f => ({ ...f, editRoles: AGENT_EDIT_ROLES[f.key] ?? null }));
  res.json(files);
});

skillRoutes.get('/:key', (req, res) => {
  const resolved = resolveFile(req.params.key);
  if (!resolved) return res.status(404).json({ error: `Agent file "${req.params.key}" not found` });

  try {
    const content = fs.readFileSync(resolved.filePath, 'utf-8');
    res.json({ key: req.params.key, dir: resolved.dir, content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

skillRoutes.put('/:key', (req: AuthRequest, res) => {
  const resolved = resolveFile(req.params.key);
  if (!resolved) return res.status(404).json({ error: `Agent file "${req.params.key}" not found` });

  if (!canEditFile(req.user, req.params.key)) {
    return res.status(403).json({ error: 'You do not have permission to edit this agent file', code: 'INSUFFICIENT_ROLE' });
  }

  const { content } = req.body as { content?: string };
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }

  try {
    fs.writeFileSync(resolved.filePath, content, 'utf-8');
    res.json({ key: req.params.key, saved: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
