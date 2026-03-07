/**
 * Context Curator Agent — Context Archivist
 *
 * Standalone class (does NOT extend BmadAgent).
 * Runs post-workflow: fetches artifacts, reads context files, calls LLM once
 * (non-streaming, output buffered), parses JSON output, stores context_diffs records.
 * No menu, no session, no streaming output to UI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveModelId } from '../utils/ai-provider';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('CURATOR');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONA_PATH  = path.join(PROJECT_ROOT, 'agents', 'personas', 'curator.md');
const CONTEXT_ROOT  = path.join(PROJECT_ROOT, 'context');

// ── DB row types ──────────────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
}

interface ArtifactRow {
  id: number;
  type: string;
  file_path: string;
}

// ── LLM output schema ─────────────────────────────────────────────────────────

export interface ContextDiffSpec {
  fileName: string;
  section: string;
  action: 'add' | 'update' | 'remove';
  content: string;
  rationale: string;
}

// ── ContextCuratorAgent ───────────────────────────────────────────────────────

export class ContextCuratorAgent {
  private readonly persona: string;

  constructor() {
    this.persona = fs.readFileSync(PERSONA_PATH, 'utf-8');
    logger.info('Curator persona loaded');
  }

  /**
   * Run curation for a completed workflow.
   * Fetches artifacts, reads context files, calls LLM, stores context_diffs records.
   *
   * @returns Number of diff proposals stored.
   */
  async runCuration(workflowId: string, model?: string): Promise<number> {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT id, item_id, goal FROM workflows WHERE id = ?')
      .get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    // ── Collect workflow artifacts ──────────────────────────────────────────
    const artifactRows = db
      .prepare<[string], ArtifactRow>(`
        SELECT a.id, a.type, a.file_path
        FROM artifacts a
        JOIN sessions s ON a.session_id = s.id
        WHERE s.item_id = ?
        ORDER BY a.created_at ASC
      `)
      .all(workflow.item_id);

    const artifactSections: string[] = [];
    for (const row of artifactRows) {
      if (!row.file_path) continue;
      try {
        const content = fs.readFileSync(row.file_path, 'utf-8');
        artifactSections.push(`### Artifact: ${row.type} (id=${row.id})\n\n${content.slice(0, 3000)}${content.length > 3000 ? '\n[…truncated]' : ''}`);
      } catch {
        // File missing — skip silently
      }
    }

    if (artifactSections.length === 0) {
      logger.info(`Curator: no readable artifacts for workflow ${workflowId} — skipping`);
      return 0;
    }

    // ── Read current context files ──────────────────────────────────────────
    const contextSections: string[] = [];
    const contextFileNames: string[] = [];
    try {
      const entries = fs.readdirSync(CONTEXT_ROOT, { withFileTypes: true });
      const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.includes('.example'));
      for (const file of mdFiles) {
        const content = fs.readFileSync(path.join(CONTEXT_ROOT, file.name), 'utf-8');
        contextSections.push(`### ${file.name}\n\n${content}`);
        contextFileNames.push(file.name);
      }
    } catch {
      logger.warn('Curator: could not read context/ directory');
    }

    const contextBlock = contextSections.length > 0
      ? contextSections.join('\n\n---\n\n')
      : '(no context files exist yet — do not propose any changes)';

    // ── Build prompt ────────────────────────────────────────────────────────
    const systemPrompt = this.persona;

    const userMessage =
      `You are curating context updates after workflow **${workflowId}** completed.\n\n` +
      `**Goal:** ${workflow.goal}\n\n` +
      `**Available context files:** ${contextFileNames.length > 0 ? contextFileNames.join(', ') : '(none)'}\n\n` +
      `## Current Context Files\n\n${contextBlock}\n\n` +
      `---\n\n` +
      `## Workflow Artifacts\n\n${artifactSections.join('\n\n---\n\n')}\n\n` +
      `---\n\n` +
      `Review the artifacts above. Identify any facts that should update the context files. ` +
      `Output only a JSON array of change proposals. Each must cite its source artifact. ` +
      `If no changes are warranted, output \`[]\`.`;

    logger.info(`Curator running for workflow ${workflowId} (${artifactSections.length} artifact(s), ${contextFileNames.length} context file(s))`);

    // ── Call LLM — buffer full response (non-streaming to caller) ──────────
    const resolvedModel = resolveModelId(model);
    let fullResponse = '';
    for await (const chunk of streamAI(resolvedModel, systemPrompt, [{ role: 'user', content: userMessage }])) {
      fullResponse += chunk;
    }

    // ── Parse JSON output ───────────────────────────────────────────────────
    const diffs = parseJsonDiffs(fullResponse);
    if (diffs.length === 0) {
      logger.info(`Curator: no context changes proposed for workflow ${workflowId}`);
      return 0;
    }

    // ── Validate and store each diff ────────────────────────────────────────
    const insert = db.prepare(`
      INSERT INTO context_diffs (workflow_id, file_name, diff_content, rationale, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);

    const validFileNames = new Set(contextFileNames);
    let stored = 0;
    const now = Date.now();

    for (const diff of diffs) {
      if (!diff.fileName || !diff.action || !diff.section) {
        logger.warn(`Curator: skipping malformed diff: ${JSON.stringify(diff).slice(0, 80)}`);
        continue;
      }
      if (contextFileNames.length > 0 && !validFileNames.has(diff.fileName)) {
        logger.warn(`Curator: skipping diff for unknown file "${diff.fileName}"`);
        continue;
      }

      const diffContent = JSON.stringify({
        section: diff.section,
        action: diff.action,
        content: diff.content ?? '',
      });

      insert.run(workflowId, diff.fileName, diffContent, diff.rationale ?? '', now);
      stored++;
    }

    logger.info(`Curator: stored ${stored} context diff proposal(s) for workflow ${workflowId}`);
    return stored;
  }
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function parseJsonDiffs(text: string): ContextDiffSpec[] {
  // Try to extract a JSON array — may be wrapped in a code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/m) ??
                    text.match(/(\[[\s\S]*\])/m);
  const raw = jsonMatch?.[1]?.trim() ?? text.trim();

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ContextDiffSpec[];
  } catch {
    logger.warn(`Curator: failed to parse LLM JSON output (${raw.slice(0, 200)})`);
    return [];
  }
}
