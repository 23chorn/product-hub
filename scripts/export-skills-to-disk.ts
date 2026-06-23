#!/usr/bin/env tsx
/**
 * One-off migration step: write the currently-active skill_versions DB content back to
 * disk for the personas where the DB has drifted ahead of disk (the DB is what's actually
 * live for these — see specialist-agent.ts's getActiveSkill()-first persona loading).
 * Preserves each file's existing YAML frontmatter block; only the body is replaced.
 *
 * Run before removing the skill_versions DB-read path, so going disk-only doesn't
 * silently regress these personas back to stale content.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const dbPath = path.join(PROJECT_ROOT, 'db', 'product-ops.db');
const personasDir = path.join(PROJECT_ROOT, 'agents', 'personas');

// skill_name -> persona file. Excludes critic/curator (always disk-only, DB row is dead)
// and figma_design (no active DB row — already disk-authoritative by fallback).
const SKILL_PERSONA_FILE: Record<string, string> = {
  coordinator:          'coordinator.md',
  qa_engineer:          'qa-engineer.md',
  epic_feature_planner: 'epic-feature-planner.md',
  story_decomposition:  'story-decomposition.md',
  prototype:            'prototype-builder.md',
  'ios-engineer':       'ios-engineer.md',
};

const FRONTMATTER_RE = /^(---[\s\S]*?---\s*\n?)/;

const db = new Database(dbPath, { readonly: true });
console.log(`[EXPORT] Reading database: ${dbPath}`);

for (const [skillName, fileName] of Object.entries(SKILL_PERSONA_FILE)) {
  const active = db
    .prepare<[string], { version: string; persona_prompt: string }>(
      `SELECT version, persona_prompt FROM skill_versions WHERE skill_name = ? AND deprecated_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(skillName);

  if (!active) {
    console.log(`[EXPORT] "${skillName}" — no active DB row, skipping`);
    continue;
  }

  const filePath = path.join(personasDir, fileName);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const frontmatterMatch = existing.match(FRONTMATTER_RE);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';

  const newContent = frontmatter + active.persona_prompt.trim() + '\n';

  if (existing === newContent) {
    console.log(`[EXPORT] "${skillName}" v${active.version} — disk already matches, skipping`);
    continue;
  }

  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log(`[EXPORT] "${skillName}" v${active.version} -> wrote ${fileName} (${active.persona_prompt.length} chars body)`);
}

db.close();
console.log('[EXPORT] Complete');
