/**
 * Context Curator Agent — Context Archivist
 *
 * Standalone class (does NOT extend SpecialistAgent).
 * Runs post-workflow: fetches artifacts, reads context files, calls LLM once
 * (non-streaming, output buffered), parses JSON output, stores context_diffs records.
 * No menu, no session, no streaming output to UI.
 */

import * as fs from 'fs';
import { resolveArtifactPath } from './artifact-helpers';
import * as path from 'path';
import { streamAI, resolveModelId, type TokenUsage } from '../utils/ai-provider';
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
   * @returns Number of diff proposals stored plus reasoning log.
   */
  async runCuration(workflowId: string, model?: string, onTokens?: (usage: TokenUsage) => void): Promise<{ diffCount: number; reasoning: string }> {
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
        const content = fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8');
        artifactSections.push(`### Artifact: ${row.type} (id=${row.id})\n\n${content.slice(0, 3000)}${content.length > 3000 ? '\n[…truncated]' : ''}`);
      } catch {
        // File missing — skip silently
      }
    }

    if (artifactSections.length === 0) {
      logger.info(`Curator: no readable artifacts for workflow ${workflowId} — skipping`);
      return { diffCount: 0, reasoning: 'No readable artifacts found — nothing to curate.' };
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

    // Ensure current-state.md exists so the curator can target it
    const CURRENT_STATE = 'current-state.md';
    if (!contextFileNames.includes(CURRENT_STATE)) {
      const template = '# Current State\n\n## What is live today\n\n## Active work\n\n## Recent decisions\n';
      const csPath = path.join(CONTEXT_ROOT, CURRENT_STATE);
      fs.writeFileSync(csPath, template, 'utf-8');
      contextSections.push(`### ${CURRENT_STATE}\n\n${template}`);
      contextFileNames.push(CURRENT_STATE);
      logger.info('Curator: auto-created current-state.md for phase tracking');
    }

    const contextBlock = contextSections.length > 0
      ? contextSections.join('\n\n---\n\n')
      : '(no context files exist yet — do not propose any changes)';

    // ── Build prompt ────────────────────────────────────────────────────────
    // Plain string — curator runs once per workflow so there's no subsequent cache
    // read to recoup the cache_write surcharge. Split prompt not beneficial here.
    const systemPrompt = this.persona;

    const userMessage =
      `You are curating context updates after workflow **${workflowId}** completed.\n\n` +
      `**Goal:** ${workflow.goal}\n\n` +
      `**Available context files:** ${contextFileNames.length > 0 ? contextFileNames.join(', ') : '(none)'}\n\n` +
      `## Current Context Files\n\n${contextBlock}\n\n` +
      `---\n\n` +
      `## Workflow Artifacts\n\n${artifactSections.join('\n\n---\n\n')}\n\n` +
      `---\n\n` +
      `Review the artifacts above. Identify any facts that should update the context files.\n\n` +
      `Respond in two clearly separated sections:\n\n` +
      `**Section 1 — REASONING** (between <reasoning> tags):\n` +
      `Walk through your thought process. For each context file, note what you checked, what questions you considered, and why you decided to propose (or skip) changes. Be specific about what evidence from the artifacts supports each decision.\n\n` +
      `**Section 2 — DIFFS** (between <diffs> tags):\n` +
      `A raw JSON array. Each element: {"fileName":"...","section":"...","action":"add|update|remove","content":"...","rationale":"..."}. ` +
      `Keep content values concise (1-3 sentences). If no changes are warranted, output exactly: []\n\n` +
      `Example format:\n` +
      `<reasoning>\nChecked strategy.md — the workflow produced new OKR data...\n</reasoning>\n` +
      `<diffs>\n[{"fileName":"strategy.md","section":"OKRs","action":"update","content":"...","rationale":"..."}]\n</diffs>`;

    logger.info(`Curator running for workflow ${workflowId} (${artifactSections.length} artifact(s), ${contextFileNames.length} context file(s))`);

    // ── Call LLM — buffer full response (non-streaming to caller) ──────────
    const resolvedModel = resolveModelId(model);
    let fullResponse = '';
    for await (const chunk of streamAI(resolvedModel, systemPrompt, [{ role: 'user', content: userMessage }], undefined, { onTokens })) {
      fullResponse += chunk;
    }

    // ── Extract reasoning log ─────────────────────────────────────────────
    const reasoningMatch = fullResponse.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
    const reasoning = reasoningMatch?.[1]?.trim() ?? '';
    if (reasoning) {
      logger.info(`Curator reasoning (${reasoning.length} chars):\n${reasoning.slice(0, 500)}`);
    }

    // ── Extract diffs section and parse JSON ────────────────────────────
    const diffsMatch = fullResponse.match(/<diffs>([\s\S]*?)<\/diffs>/);
    const diffsText = diffsMatch?.[1]?.trim() ?? fullResponse;

    const diffs = parseJsonDiffs(diffsText);
    if (diffs.length === 0) {
      logger.info(`Curator: no context changes proposed for workflow ${workflowId}`);
      return { diffCount: 0, reasoning: reasoning || 'Curator found no changes needed.' };
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
    return { diffCount: stored, reasoning };
  }
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function parseJsonDiffs(text: string): ContextDiffSpec[] {
  // Try to extract a JSON array — may be wrapped in a code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/m) ??
                    text.match(/(\[[\s\S]*)/m);
  let raw = jsonMatch?.[1]?.trim() ?? text.trim();

  // Strip leading non-JSON text (e.g. "Here are the changes:")
  const arrayStart = raw.indexOf('[');
  if (arrayStart > 0) raw = raw.slice(arrayStart);

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ContextDiffSpec[];
  } catch {
    // Truncated JSON — try to salvage complete objects
    // Find the last complete object (ending with }) before truncation
    const lastComplete = raw.lastIndexOf('}');
    if (lastComplete > 0) {
      const salvaged = raw.slice(0, lastComplete + 1) + ']';
      try {
        const parsed = JSON.parse(salvaged);
        if (Array.isArray(parsed)) {
          logger.warn(`Curator: JSON was truncated — salvaged ${parsed.length} complete object(s)`);
          return parsed as ContextDiffSpec[];
        }
      } catch { /* fall through */ }
    }

    logger.warn(`Curator: failed to parse LLM JSON output (${raw.slice(0, 200)})`);
    return [];
  }
}
