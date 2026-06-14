/**
 * Prototype Agent — generates interactive React prototypes from workflow artifacts.
 *
 * Runs as a workflow stage (between solution_architect and story_decomposition).
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
import { loadLatestArtifactContent, saveMainArtifact, resolveArtifactPath } from './artifact-helpers';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('PROTOTYPE-AGENT');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');
const PERSONAS_DIR = path.join(AGENTS_ROOT, 'personas');
const TEMPLATES_DIR = path.join(AGENTS_ROOT, 'templates');
const PROTOTYPE_DIR = path.join(TEMPLATES_DIR, 'prototype');
const CONTEXT_ROOT = path.join(PROJECT_ROOT, 'context');

// ── Result types ───────────────────────────────────────────────────────────────

export interface PrototypeResult {
  title: string;
  description: string;
  screens: string[];
  entryScreen: string;
  files: Record<string, string>;
}

export type PrototypePlatform = 'web' | 'mobile' | 'both';

// ── Helpers ────────────────────────────────────────────────────────────────────

export async function loadWorkflowArtifacts(itemId: string): Promise<string> {
  // Prototype runs after PRD, before architecture — only load what's available at that point
  const stages: Array<{ type: string; label: string }> = [
    { type: 'analyst', label: 'Research Brief' },
    { type: 'prd', label: 'PRD' },
  ];
  const results = await Promise.all(stages.map(s => loadLatestArtifactContent(itemId, s.type)));
  const sections: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    if (results[i]) sections.push(`## ${stages[i].label}\n\n${results[i]}`);
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

  let Client: any;
  let StdioClientTransport: any;
  try {
    ({ Client } = require('@modelcontextprotocol/sdk/client') as typeof import('@modelcontextprotocol/sdk/client/index.js'));
    ({ StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js') as typeof import('@modelcontextprotocol/sdk/client/stdio.js'));
  } catch {
    logger.warn('MCP SDK not installed — Figma design system integration unavailable');
    statusCb('Figma unavailable, using local design tokens.\n');
    return '';
  }

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

// ── Platform resolution ────────────────────────────────────────────────────────

/**
 * Read productArea from items.metadata and map to a prototype platform.
 * productArea values from Airtable e.g. "Web", "Mobile", "iOS", "Android", "Web, Mobile".
 */
export function resolveItemPlatform(itemId: string): PrototypePlatform {
  const row = db.prepare<[string], { metadata: string | null }>(
    'SELECT metadata FROM items WHERE id = ?'
  ).get(itemId);
  if (!row?.metadata) return 'web';
  try {
    const meta = JSON.parse(row.metadata) as { productArea?: string };
    const area = (meta.productArea ?? '').toLowerCase();
    const hasWeb = /web|browser|desktop/.test(area);
    const hasMobile = /mobile|ios|android|app/.test(area);
    if (hasWeb && hasMobile) return 'both';
    if (hasMobile) return 'mobile';
    return 'web';
  } catch {
    return 'web';
  }
}

/** Mobile-specific prompt instructions injected when generating a mobile prototype. */
const MOBILE_PLATFORM_HINT = `## Platform: Mobile App

Generate a **native mobile app** prototype, NOT a web layout. Apply these conventions:

- **Navigation**: Bottom tab bar (4–5 tabs) as the primary nav. Use full-screen card sheets (slide up from bottom) for detail views. No top horizontal navbars.
- **Touch targets**: All interactive elements minimum 44×44 px (use \`min-h-[44px]\`). No hover states.
- **Layout**: Constrained to ~390 px wide. Full-width cards with \`rounded-2xl\`. Sticky headers with safe-area padding (\`pt-safe\` / \`pb-safe\` — approximate with \`pt-12\` / \`pb-8\`).
- **Gestures**: Simulate swipe-back as a "← Back" button. Simulate pull-to-refresh as a "Refresh" button at the top.
- **Typography**: Slightly larger base font (\`text-base\` / \`text-lg\`) for readability on small screens.
- **Lists**: Use card-based lists with subtle dividers; avoid dense table layouts.
- **Forms**: Full-width inputs, large submit buttons pinned to the bottom of the screen.
- **Screens**: Name them like iOS/Android screens — Home, Detail, Modal, Settings, etc.`;

const WEB_PLATFORM_HINT = `## Platform: Web App

Generate a **desktop/browser** prototype with web-native conventions:

- **Navigation**: Top header nav or left sidebar. Tabs and breadcrumbs for secondary navigation.
- **Layout**: Use the full viewport width. Multi-column layouts where appropriate (sidebar + main content, grid views).
- **Hover states**: Interactive elements should have hover feedback (\`hover:bg-ui-02\`, \`hover:opacity-80\`).
- **Data density**: Tables, data grids, and compact list rows are appropriate. Users are on wide screens with precise pointing.
- **Forms**: Inline labels, compact inputs, form sections with clear headings.
- **Screens**: Name them like web pages — Dashboard, List, Detail, Settings, etc.`;

// ── Artifact persistence ───────────────────────────────────────────────────────

async function savePrototypeArtifact(
  itemId: string,
  prototype: PrototypeResult,
  artifactType: 'prototype' | 'prototype_web' | 'prototype_mobile' = 'prototype',
): Promise<void> {
  const session = db.prepare<[string], { id: string }>(`
    SELECT id FROM sessions WHERE item_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(itemId);

  await saveMainArtifact(session?.id ?? '', artifactType, JSON.stringify(prototype, null, 2), itemId);
  logger.info(`Saved ${artifactType} artifact for item ${itemId}`);
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
    const platform = resolveItemPlatform(workflow.item_id);
    const artifactType = platform === 'mobile' ? 'prototype_mobile' : platform === 'both' ? 'prototype_web' : 'prototype_web';
    await savePrototypeArtifact(workflow.item_id, merged, artifactType);
    await savePrototypeArtifact(workflow.item_id, merged, 'prototype');
    return merged;
  } catch (err) {
    logger.error('Failed to parse revised prototype JSON', err);
    return null;
  }
}

/**
 * Load the most recent prototype artifact for a workflow.
 * Returns both web and mobile variants if both were generated.
 */
export function loadLatestPrototype(workflowId: string): { platform: PrototypePlatform; web?: PrototypeResult; mobile?: PrototypeResult } | null {
  const workflow = db.prepare<[string], { item_id: string }>(`
    SELECT item_id FROM workflows WHERE id = ?
  `).get(workflowId);
  if (!workflow) return null;

  const loadByType = (type: string): PrototypeResult | null => {
    const row = db.prepare<[string, string], { file_path: string }>(`
      SELECT a.file_path
      FROM artifacts a
      LEFT JOIN sessions s ON a.session_id = s.id
      WHERE (s.item_id = ? OR a.session_id IS NULL) AND a.type = ?
      ORDER BY a.created_at DESC LIMIT 1
    `).get(workflow.item_id, type);
    if (!row?.file_path) return null;
    try {
      return JSON.parse(fs.readFileSync(resolveArtifactPath(row.file_path), 'utf-8')) as PrototypeResult;
    } catch {
      return null;
    }
  };

  const webResult = loadByType('prototype_web');
  const mobileResult = loadByType('prototype_mobile');

  if (webResult && mobileResult) return { platform: 'both', web: webResult, mobile: mobileResult };
  if (mobileResult) return { platform: 'mobile', mobile: mobileResult };
  if (webResult) return { platform: 'web', web: webResult };

  // Backward compat: fall back to untyped 'prototype' artifact
  const legacy = loadByType('prototype');
  return legacy ? { platform: 'web', web: legacy } : null;
}
