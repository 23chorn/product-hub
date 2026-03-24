/**
 * Prototype Agent — generates self-contained React prototypes from workflow artifacts.
 *
 * Not a workflow stage — invoked on-demand after a workflow completes.
 * Reads PRD, architecture, and backlog artifacts, combines them with the design system
 * tokens and prototype persona, and streams a JSON file-map that Sandpack can render.
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { streamAI, resolveModelId, type SystemPrompt, type TokenUsage } from '../utils/ai-provider';
import { loadLatestArtifactForStage } from './artifact-helpers';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('PROTOTYPE-AGENT');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');
const PERSONAS_DIR = path.join(AGENTS_ROOT, 'personas');
const TEMPLATES_DIR = path.join(AGENTS_ROOT, 'templates');
const PROTOTYPE_DIR = path.join(TEMPLATES_DIR, 'prototype');
const CONTEXT_ROOT = path.join(PROJECT_ROOT, 'context');

/**
 * Load all available artifacts for an item (PRD, architecture, backlog).
 * Returns a combined string for injection into the prompt.
 */
function loadWorkflowArtifacts(itemId: string): string {
  const stages = ['analyst', 'pm_prd', 'solution_architect', 'pm_backlog'] as const;
  const labels: Record<string, string> = {
    analyst: 'Research Brief',
    pm_prd: 'PRD',
    solution_architect: 'Architecture Document',
    pm_backlog: 'Backlog',
  };

  const sections: string[] = [];
  for (const stage of stages) {
    const content = loadLatestArtifactForStage(itemId, stage);
    if (content) {
      sections.push(`## ${labels[stage]}\n\n${content}`);
    }
  }
  return sections.join('\n\n---\n\n');
}

/**
 * Load the design system files (tokens CSS + tailwind config) for injection.
 */
async function loadDesignSystem(): Promise<string> {
  const parts: string[] = [];
  try {
    const tokens = await fsAsync.readFile(path.join(PROTOTYPE_DIR, 'design-tokens.css'), 'utf-8');
    parts.push(`### design-tokens.css\n\`\`\`css\n${tokens}\n\`\`\``);
  } catch { /* missing */ }
  try {
    const tw = await fsAsync.readFile(path.join(PROTOTYPE_DIR, 'tailwind.config.js'), 'utf-8');
    parts.push(`### tailwind.config.js (Tailwind utility classes available)\n\`\`\`js\n${tw}\n\`\`\``);
  } catch { /* missing */ }
  return parts.join('\n\n');
}

/**
 * Load the prototype builder persona markdown.
 */
async function loadPersona(): Promise<string> {
  return fsAsync.readFile(path.join(PERSONAS_DIR, 'prototype-builder.md'), 'utf-8');
}

/**
 * Load the prototype output template.
 */
async function loadTemplate(): Promise<string> {
  return fsAsync.readFile(path.join(TEMPLATES_DIR, 'prototype.template.md'), 'utf-8');
}

/**
 * Load project context files (same as BmadAgent).
 */
async function loadProjectContext(): Promise<string> {
  try {
    const files = await fsAsync.readdir(CONTEXT_ROOT);
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'README.md').sort();
    const sections: string[] = [];
    for (const file of mdFiles) {
      const content = await fsAsync.readFile(path.join(CONTEXT_ROOT, file), 'utf-8');
      if (content.trim()) sections.push(`### ${file}\n${content}`);
    }
    return sections.length > 0 ? `## Project & Company Context\n\n${sections.join('\n\n')}` : '';
  } catch { return ''; }
}

export interface PrototypeResult {
  title: string;
  description: string;
  screens: string[];
  entryScreen: string;
  files: Record<string, string>;
}

/**
 * Attempt to repair truncated JSON output (e.g. when the model hits max output tokens).
 * Closes unclosed strings, objects, and arrays to make the JSON parseable.
 */
export function repairTruncatedJson(raw: string): string {
  let s = raw.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  // If it already parses, return as-is
  try { JSON.parse(s); return s; } catch { /* needs repair */ }

  // Close unclosed string: if we're inside a string value, close it
  // Count unescaped quotes
  let inString = false;
  let lastQuoteIdx = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; } // skip escaped char
    if (s[i] === '"') { inString = !inString; lastQuoteIdx = i; }
  }
  if (inString) {
    // We're mid-string — close it. Escape any trailing backslash.
    if (s.endsWith('\\')) s = s.slice(0, -1);
    s += '"';
  }

  // Remove trailing comma (invalid before closing bracket)
  s = s.replace(/,\s*$/, '');

  // Count open/close braces and brackets, close any that are unclosed
  const stack: string[] = [];
  inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && inString) { i++; continue; }
    if (s[i] === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (s[i] === '{') stack.push('}');
    else if (s[i] === '[') stack.push(']');
    else if (s[i] === '}' || s[i] === ']') stack.pop();
  }

  // Close remaining open structures
  while (stack.length > 0) {
    s += stack.pop();
  }

  return s;
}

/**
 * Generate a prototype as an async generator (streams text chunks).
 * The final concatenated output is a JSON code block.
 *
 * @param workflowId - The workflow whose artifacts to use
 * @param scope - Optional scope override (e.g. specific feature/story titles to focus on)
 * @param onTokens - Token usage callback for cost tracking
 */
export async function* generatePrototype(
  workflowId: string,
  scope?: string,
  onTokens?: (usage: TokenUsage) => void,
): AsyncGenerator<string, PrototypeResult | null, unknown> {
  // Load workflow to get item_id
  const workflow = db.prepare<[string], { item_id: string; goal: string }>(`
    SELECT item_id, goal FROM workflows WHERE id = ?
  `).get(workflowId);

  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  // Load all inputs in parallel
  const [persona, template, designSystem, projectContext] = await Promise.all([
    loadPersona(),
    loadTemplate(),
    loadDesignSystem(),
    loadProjectContext(),
  ]);

  const artifacts = loadWorkflowArtifacts(workflow.item_id);
  if (!artifacts.trim()) throw new Error('No artifacts found for this workflow');

  // Build system prompt — persona + design system + template are stable/cacheable
  const stable = [
    persona,
    '\n\n## Design System\n\n' + designSystem,
    projectContext ? '\n\n' + projectContext : '',
    '\n\n## Output Template\n\n' + template,
  ].join('');

  // Dynamic part: the specific artifacts and scope
  const dynamicParts = [
    '## Workflow Artifacts\n\nUse these documents to understand what to prototype:\n\n' + artifacts,
  ];
  if (scope) {
    dynamicParts.push(`\n\n## Scope\n\nFocus the prototype on: ${scope}`);
  }
  const dynamic = dynamicParts.join('');

  const systemPrompt: SystemPrompt = { stable, dynamic };

  const userMessage = scope
    ? `Generate an interactive React prototype focused on: ${scope}\n\nThe workflow goal was: ${workflow.goal}`
    : `Generate an interactive React prototype for the complete feature described in the workflow artifacts.\n\nThe workflow goal was: ${workflow.goal}`;

  const model = resolveModelId(undefined);
  logger.info(`Generating prototype for workflow ${workflowId} (item ${workflow.item_id}), model=${model}`);

  let fullResponse = '';
  const generator = streamAI(
    model,
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    64_000,
    { onTokens },
  );

  for await (const chunk of generator) {
    fullResponse += chunk;
    yield chunk;
  }

  // Always save raw output to disk for recovery
  const rawDir = path.join(PROJECT_ROOT, 'data', 'sessions', workflow.item_id, 'prototype', 'raw');
  await fsAsync.mkdir(rawDir, { recursive: true });
  const rawPath = path.join(rawDir, `${Date.now()}-raw.txt`);
  await fsAsync.writeFile(rawPath, fullResponse, 'utf-8');
  logger.info(`Saved raw prototype output → ${rawPath}`);

  // Parse the result — try direct parse, then repair truncated JSON
  try {
    const repaired = repairTruncatedJson(fullResponse);
    const parsed = JSON.parse(repaired) as PrototypeResult;
    logger.info(`Prototype generated: "${parsed.title}" — ${parsed.screens.length} screens, ${Object.keys(parsed.files).length} files`);

    // Save as artifact
    await savePrototypeArtifact(workflow.item_id, workflowId, parsed);

    return parsed;
  } catch (err) {
    logger.error('Failed to parse prototype JSON output even after repair', err);
    return null;
  }
}

/**
 * Revise an existing prototype based on user feedback.
 * Uses conversation threading: prior prototype as assistant turn, feedback as user turn.
 */
export async function* revisePrototype(
  workflowId: string,
  currentPrototype: PrototypeResult,
  feedback: string,
  onTokens?: (usage: TokenUsage) => void,
): AsyncGenerator<string, PrototypeResult | null, unknown> {
  const workflow = db.prepare<[string], { item_id: string; goal: string }>(`
    SELECT item_id, goal FROM workflows WHERE id = ?
  `).get(workflowId);

  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const [persona, template, designSystem, projectContext] = await Promise.all([
    loadPersona(),
    loadTemplate(),
    loadDesignSystem(),
    loadProjectContext(),
  ]);

  const stable = [
    persona,
    '\n\n## Design System\n\n' + designSystem,
    projectContext ? '\n\n' + projectContext : '',
    '\n\n## Output Template\n\n' + template,
  ].join('');

  const systemPrompt: SystemPrompt = { stable };

  // Thread: [user: original request, assistant: prior prototype, user: revision feedback]
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: `Generate an interactive React prototype for: ${workflow.goal}` },
    { role: 'assistant', content: '```json\n' + JSON.stringify(currentPrototype, null, 2) + '\n```' },
    { role: 'user', content: `Revise the prototype based on this feedback:\n\n${feedback}\n\nIMPORTANT: Output ONLY the files that need to change. Use the same JSON structure but include only the modified files in the "files" object. Unchanged files will be merged from the previous version automatically. Also update "screens" and "entryScreen" only if they changed — omit them to keep the current values.\n\nExample partial output:\n\`\`\`json\n{"title":"Same title","description":"Same desc","files":{"/screens/ChangedScreen.tsx":"// updated code..."}}\n\`\`\`` },
  ];

  const model = resolveModelId(undefined);
  logger.info(`Revising prototype for workflow ${workflowId}, feedback: "${feedback.slice(0, 80)}..."`);

  let fullResponse = '';
  const generator = streamAI(model, systemPrompt, messages, 64_000, { onTokens });

  for await (const chunk of generator) {
    fullResponse += chunk;
    yield chunk;
  }

  // Save raw
  const rawDir = path.join(PROJECT_ROOT, 'data', 'sessions', workflow.item_id, 'prototype', 'raw');
  await fsAsync.mkdir(rawDir, { recursive: true });
  await fsAsync.writeFile(path.join(rawDir, `${Date.now()}-revision-raw.txt`), fullResponse, 'utf-8');

  try {
    const repaired = repairTruncatedJson(fullResponse);
    const partial = JSON.parse(repaired) as Partial<PrototypeResult>;

    // Merge: start from the current prototype, overlay changed files
    const merged: PrototypeResult = {
      title: partial.title ?? currentPrototype.title,
      description: partial.description ?? currentPrototype.description,
      screens: partial.screens ?? currentPrototype.screens,
      entryScreen: partial.entryScreen ?? currentPrototype.entryScreen,
      files: { ...currentPrototype.files, ...(partial.files ?? {}) },
    };

    const changedCount = Object.keys(partial.files ?? {}).length;
    const totalCount = Object.keys(merged.files).length;
    logger.info(`Prototype revised: ${changedCount} files changed, ${totalCount} total files`);
    await savePrototypeArtifact(workflow.item_id, workflowId, merged);
    return merged;
  } catch (err) {
    logger.error('Failed to parse revised prototype JSON', err);
    return null;
  }
}

/**
 * Save a generated prototype as an artifact on disk and in the DB.
 */
async function savePrototypeArtifact(
  itemId: string,
  workflowId: string,
  prototype: PrototypeResult,
): Promise<number> {
  const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, 'prototype', 'artifacts');
  await fsAsync.mkdir(artifactDir, { recursive: true });

  const artifactPath = path.join(artifactDir, `${Date.now()}-prototype.json`);
  await fsAsync.writeFile(artifactPath, JSON.stringify(prototype, null, 2), 'utf-8');

  // Find a session for this item to link the artifact (use the latest)
  const session = db.prepare<[string], { id: string }>(`
    SELECT id FROM sessions WHERE item_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(itemId);

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `).run(session?.id ?? null, 'prototype', artifactPath, Date.now());

  logger.info(`Saved prototype artifact → ${artifactPath}`);
  return result.lastInsertRowid as number;
}

/**
 * Load the most recent prototype artifact for a workflow's item.
 */
export function loadLatestPrototype(workflowId: string): PrototypeResult | null {
  const workflow = db.prepare<[string], { item_id: string }>(`
    SELECT item_id FROM workflows WHERE id = ?
  `).get(workflowId);
  if (!workflow) return null;

  const row = db.prepare<[string, string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    LEFT JOIN sessions s ON a.session_id = s.id
    WHERE (s.item_id = ? OR a.session_id IS NULL) AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(workflow.item_id, 'prototype');

  if (!row?.file_path) return null;
  try {
    return JSON.parse(fs.readFileSync(row.file_path, 'utf-8'));
  } catch {
    return null;
  }
}
