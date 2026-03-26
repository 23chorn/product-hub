/**
 * Prototype Agent — generates interactive React prototypes from workflow artifacts.
 *
 * Runs as a workflow stage (between solution_architect and pm_backlog).
 *
 * If FIGMA_DESIGN_SYSTEM_FILE is set, it first connects to figma-developer-mcp to read
 * the real design system components and tokens, then feeds that context to Claude for
 * accurate, brand-consistent prototype generation. Falls back to the design-tokens.css
 * file when Figma is not configured.
 *
 * The generated prototype is a self-contained React app rendered via an srcdoc iframe
 * using React 18 UMD + Babel Standalone — no external sandbox service required.
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { streamAI, resolveModelId, type SystemPrompt, type TokenUsage } from '../utils/ai-provider';
import { loadLatestArtifactForStage } from './artifact-helpers';
import db from '../data/database';
import Logger from '../utils/logger';

// MCP SDK — loaded via require to avoid ESM/CJS interop issues with moduleResolution:node
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require('@modelcontextprotocol/sdk/client') as typeof import('@modelcontextprotocol/sdk/client/index.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js') as typeof import('@modelcontextprotocol/sdk/client/stdio.js');

const logger = new Logger('PROTOTYPE-AGENT');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');
const PERSONAS_DIR = path.join(AGENTS_ROOT, 'personas');
const TEMPLATES_DIR = path.join(AGENTS_ROOT, 'templates');
const PROTOTYPE_DIR = path.join(TEMPLATES_DIR, 'prototype');
const CONTEXT_ROOT = path.join(PROJECT_ROOT, 'context');

// ── Result type ────────────────────────────────────────────────────────────────

export interface PrototypeResult {
  title: string;
  description: string;
  screens: string[];
  entryScreen: string;
  files: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function loadWorkflowArtifacts(itemId: string): string {
  const stages = ['analyst', 'pm_prd', 'solution_architect'] as const;
  const labels: Record<string, string> = {
    analyst: 'Research Brief',
    pm_prd: 'PRD',
    solution_architect: 'Architecture Document',
  };
  const sections: string[] = [];
  for (const stage of stages) {
    const content = loadLatestArtifactForStage(itemId, stage);
    if (content) sections.push(`## ${labels[stage]}\n\n${content}`);
  }
  return sections.join('\n\n---\n\n');
}

async function loadPersona(): Promise<string> {
  return fsAsync.readFile(path.join(PERSONAS_DIR, 'prototype-builder.md'), 'utf-8');
}

async function loadTemplate(): Promise<string> {
  return fsAsync.readFile(path.join(TEMPLATES_DIR, 'prototype.template.md'), 'utf-8');
}

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
  } catch {
    return '';
  }
}

/** Load local design system CSS files (fallback when Figma is not configured). */
export async function loadLocalDesignSystem(): Promise<string> {
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

// ── Figma design system reader ─────────────────────────────────────────────────

/** Resolve the figma-developer-mcp binary path — prefer local install over npx. */
function resolveFigmaDevMcpBin(): { command: string; args: string[] } {
  const token = process.env.FIGMA_API_KEY ?? process.env.FIGMA_ACCESS_TOKEN ?? '';
  const apiKeyArg = `--figma-api-key=${token}`;
  try {
    const pkgPath = require.resolve('figma-developer-mcp/package.json');
    const pkg = require(pkgPath) as { bin?: Record<string, string> };
    const binFile = pkg.bin?.['figma-developer-mcp'];
    if (binFile) {
      const resolved = path.join(path.dirname(pkgPath), binFile);
      return { command: 'node', args: [resolved, '--stdio', apiKeyArg] };
    }
  } catch { /* fall back */ }
  return { command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio', apiKeyArg] };
}

/**
 * Optionally connect to figma-developer-mcp and call get_figma_data on the design system file.
 * Returns a formatted string of design system context, or an empty string if not configured.
 */
export async function loadFigmaDesignSystem(statusCb: (msg: string) => void): Promise<string> {
  const fileKey = process.env.FIGMA_DESIGN_SYSTEM_FILE;
  const token = process.env.FIGMA_API_KEY ?? process.env.FIGMA_ACCESS_TOKEN;
  if (!fileKey || !token) return '';

  statusCb('Reading Figma design system...\n');

  const { command, args } = resolveFigmaDevMcpBin();
  logger.info(`Starting figma-developer-mcp: ${command} ${args.join(' ')}`);

  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...(process.env as Record<string, string>), FIGMA_API_KEY: token },
  });

  const client = new Client(
    { name: 'product-hub', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport, { timeout: 8_000 });

    const result = await client.callTool({
      name: 'get_figma_data',
      arguments: { fileKey },
    }, undefined, { timeout: 30_000 });

    const content = Array.isArray(result.content)
      ? result.content.map((c: { type: string; text?: string }) => c.text ?? '').join('\n')
      : String(result.content);

    if (content.trim()) {
      statusCb('Design system loaded from Figma.\n');
      logger.info(`Loaded Figma design system data (${content.length} chars)`);
      return `## Design System (from Figma file ${fileKey})\n\n${content}`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not load Figma design system: ${msg} — falling back to local tokens`);
    statusCb('Figma unavailable, using local design tokens.\n');
  } finally {
    try { await transport.close(); } catch { /* ignore */ }
  }

  return '';
}

// ── JSON repair (for truncated model output) ───────────────────────────────────

export function repairTruncatedJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  try { JSON.parse(s); return s; } catch { /* needs repair */ }

  let inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') inString = !inString;
  }
  if (inString) {
    if (s.endsWith('\\')) s = s.slice(0, -1);
    s += '"';
  }
  s = s.replace(/,\s*$/, '');

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
  while (stack.length > 0) s += stack.pop();
  return s;
}

// ── Artifact persistence ───────────────────────────────────────────────────────

async function savePrototypeArtifact(
  itemId: string,
  _workflowId: string,
  prototype: PrototypeResult,
): Promise<void> {
  const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, 'prototype', 'artifacts');
  await fsAsync.mkdir(artifactDir, { recursive: true });

  const artifactPath = path.join(artifactDir, `${Date.now()}-prototype.json`);
  await fsAsync.writeFile(artifactPath, JSON.stringify(prototype, null, 2), 'utf-8');

  const session = db.prepare<[string], { id: string }>(`
    SELECT id FROM sessions WHERE item_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(itemId);

  db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `).run(session?.id ?? null, 'prototype', artifactPath, Date.now());

  logger.info(`Saved prototype artifact → ${artifactPath}`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate an interactive React prototype from workflow artifacts.
 * Yields status/content strings for SSE streaming.
 * Returns the PrototypeResult (React file map) when complete.
 *
 * If FIGMA_DESIGN_SYSTEM_FILE is configured, reads real component/token data from
 * Figma first to inform the generated prototype's design language.
 */
export async function* generatePrototype(
  workflowId: string,
  scope?: string,
  onTokens?: (usage: TokenUsage) => void,
): AsyncGenerator<string, PrototypeResult | null, unknown> {
  const workflow = db.prepare<[string], { item_id: string; goal: string }>(`
    SELECT item_id, goal FROM workflows WHERE id = ?
  `).get(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const artifacts = loadWorkflowArtifacts(workflow.item_id);
  if (!artifacts.trim()) throw new Error('No workflow artifacts found — run earlier stages first');

  const statusLines: string[] = [];
  const statusCb = (msg: string) => { statusLines.push(msg); };

  // Load all context in parallel (Figma call is separate to handle failures gracefully)
  const [persona, template, localDesignSystem, projectContext] = await Promise.all([
    loadPersona(),
    loadTemplate(),
    loadLocalDesignSystem(),
    loadProjectContext(),
  ]);

  // Try to enrich with real Figma design system data
  const figmaDesignSystem = await loadFigmaDesignSystem(statusCb);
  const designSystemContext = figmaDesignSystem || localDesignSystem;

  // Flush any status messages collected during Figma load
  for (const line of statusLines) yield line;
  statusLines.length = 0;

  // Build system prompt
  const stable = [
    persona,
    '\n\n## Design System\n\n' + designSystemContext,
    projectContext ? '\n\n' + projectContext : '',
    '\n\n## Output Template\n\n' + template,
  ].join('');

  const dynamicParts = [
    '## Workflow Artifacts\n\nUse these documents to understand what to prototype:\n\n' + artifacts,
  ];
  if (scope) dynamicParts.push(`\n\n## Scope\n\nFocus the prototype on: ${scope}`);

  const systemPrompt: SystemPrompt = { stable, dynamic: dynamicParts.join('') };

  const userMessage = scope
    ? `Generate an interactive React prototype focused on: ${scope}\n\nThe workflow goal was: ${workflow.goal}`
    : `Generate an interactive React prototype for the complete feature described in the workflow artifacts.\n\nThe workflow goal was: ${workflow.goal}`;

  const model = resolveModelId(undefined);
  logger.info(`Generating prototype for workflow ${workflowId} (item ${workflow.item_id}), model=${model}`);

  let fullResponse = '';
  const generator = streamAI(model, systemPrompt, [{ role: 'user', content: userMessage }], 64_000, { onTokens });

  for await (const chunk of generator) {
    fullResponse += chunk;
    yield chunk;
  }

  // Save raw output
  const rawDir = path.join(PROJECT_ROOT, 'data', 'sessions', workflow.item_id, 'prototype', 'raw');
  await fsAsync.mkdir(rawDir, { recursive: true });
  await fsAsync.writeFile(path.join(rawDir, `${Date.now()}-raw.txt`), fullResponse, 'utf-8');

  try {
    const repaired = repairTruncatedJson(fullResponse);
    const parsed = JSON.parse(repaired) as PrototypeResult;
    logger.info(`Prototype generated: "${parsed.title}" — ${parsed.screens.length} screens, ${Object.keys(parsed.files).length} files`);
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

  const [persona, template, localDesignSystem, projectContext] = await Promise.all([
    loadPersona(),
    loadTemplate(),
    loadLocalDesignSystem(),
    loadProjectContext(),
  ]);

  const figmaDesignSystem = await loadFigmaDesignSystem(() => {});
  const designSystemContext = figmaDesignSystem || localDesignSystem;

  const stable = [
    persona,
    '\n\n## Design System\n\n' + designSystemContext,
    projectContext ? '\n\n' + projectContext : '',
    '\n\n## Output Template\n\n' + template,
  ].join('');

  const systemPrompt: SystemPrompt = { stable };

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

  const rawDir = path.join(PROJECT_ROOT, 'data', 'sessions', workflow.item_id, 'prototype', 'raw');
  await fsAsync.mkdir(rawDir, { recursive: true });
  await fsAsync.writeFile(path.join(rawDir, `${Date.now()}-revision-raw.txt`), fullResponse, 'utf-8');

  try {
    const repaired = repairTruncatedJson(fullResponse);
    const partial = JSON.parse(repaired) as Partial<PrototypeResult>;

    const merged: PrototypeResult = {
      title: partial.title ?? currentPrototype.title,
      description: partial.description ?? currentPrototype.description,
      screens: partial.screens ?? currentPrototype.screens,
      entryScreen: partial.entryScreen ?? currentPrototype.entryScreen,
      files: { ...currentPrototype.files, ...(partial.files ?? {}) },
    };

    logger.info(`Prototype revised: ${Object.keys(partial.files ?? {}).length} files changed`);
    await savePrototypeArtifact(workflow.item_id, workflowId, merged);
    return merged;
  } catch (err) {
    logger.error('Failed to parse revised prototype JSON', err);
    return null;
  }
}

/**
 * Load the most recent prototype artifact for a workflow.
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
    return JSON.parse(fs.readFileSync(row.file_path, 'utf-8')) as PrototypeResult;
  } catch {
    return null;
  }
}
