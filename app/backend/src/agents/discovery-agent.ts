/**
 * Discovery Agent ("Scout")
 *
 * One-shot batch generation of candidate opportunities from PM-supplied source
 * documents (user interviews, app store reviews, competitor notes) plus a snapshot
 * of the current backlog. Runs outside the staged workflow machinery — there is no
 * per-stage checkpoint/approval model for discovery, just a direct LLM call whose
 * output is persisted as draft opportunities for a PM to review.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import db from '../data/database';
import { streamAI, resolveAgentModel, getActiveProvider } from '../utils/ai-provider';
import { repairTruncatedJson } from '../utils/json-repair';
import Logger from '../utils/logger';
import type { DiscoveryOpportunityEvidence, DiscoverySourceType } from '@pap/shared';

const logger = new Logger('DISCOVERY-AGENT');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONA_PATH = path.join(PROJECT_ROOT, 'agents/personas/discovery-scout.md');
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'agents/templates/discovery.template.md');

const MAX_APP_STATE_ITEMS = 60;
const APP_STATE_DESC_LENGTH = 150;

export interface OpportunityDraft {
  title: string;
  description: string;
  rationale: string;
  confidence?: number;
  evidence: DiscoveryOpportunityEvidence[];
}

interface SourceRow {
  id: string;
  source_type: DiscoverySourceType;
  title: string;
  content: string;
}

async function loadPersona(): Promise<string> {
  const raw = await fs.readFile(PERSONA_PATH, 'utf-8');
  return raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
}

async function loadTemplate(): Promise<string> {
  return fs.readFile(TEMPLATE_PATH, 'utf-8');
}

function loadSources(sourceIds: string[]): SourceRow[] {
  if (sourceIds.length === 0) return [];
  const placeholders = sourceIds.map(() => '?').join(',');
  return db.prepare(`SELECT id, source_type, title, content FROM discovery_sources WHERE id IN (${placeholders})`).all(...sourceIds) as SourceRow[];
}

function formatSources(sources: SourceRow[]): string {
  if (sources.length === 0) return '(none provided)';
  return sources.map(s => `### [${s.source_type}] ${s.title} (sourceId: ${s.id})\n${s.content}`).join('\n\n');
}

/** Cap+truncate snapshot of the active backlog, used to bias Scout away from re-pitching what's already in flight. */
function summarizeCurrentAppState(): string {
  const rows = db.prepare(`
    SELECT title, description FROM items
    WHERE status IN ('active', 'in_progress')
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(MAX_APP_STATE_ITEMS) as Array<{ title: string; description: string | null }>;

  if (rows.length === 0) return '(no existing items in the backlog yet)';
  return rows.map(r => {
    const desc = (r.description ?? '').slice(0, APP_STATE_DESC_LENGTH);
    return `- ${r.title}${desc ? `: ${desc}` : ''}`;
  }).join('\n');
}

function extractJsonBlock(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = stripped.indexOf('{');
  return jsonStart > 0 ? stripped.slice(jsonStart) : stripped;
}

/** Escapes literal control characters (raw newlines/tabs) inside JSON string values — weaker models sometimes emit these unescaped. */
function sanitizeControlChars(text: string): string {
  let result = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && inString) { result += ch + (text[i + 1] ?? ''); i++; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && (ch === '\n' || ch === '\r' || ch === '\t')) {
      result += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    result += ch;
  }
  return result;
}

/** Extracts just the first complete top-level JSON object — weaker models sometimes append prose (or echo the whole response again) after it. String/escape-aware so a stray "{" or "}" inside a quoted value doesn't throw off the count. */
function extractFirstObject(text: string): string {
  let braceCount = 0;
  let end = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braceCount++;
    else if (ch === '}') {
      braceCount--;
      if (braceCount === 0) { end = i + 1; break; }
    }
  }
  return end > 0 ? text.slice(0, end) : text;
}

/** Quotes bare object keys (e.g. `{title: "x"}` instead of `{"title": "x"}`) — weaker models sometimes emit JS-object-literal style. */
function quoteUnquotedKeys(text: string): string {
  return text.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');
}

/** Best-effort JSON.parse with fallbacks for the malformed-output patterns weaker models tend to produce. */
function parseJsonLoose(text: string): any {
  const sanitized = sanitizeControlChars(text);
  const quoted = quoteUnquotedKeys(sanitized);
  const attempts = [
    text,
    sanitized,
    quoted,
    extractFirstObject(quoted),
    repairTruncatedJson(quoted),
    repairTruncatedJson(extractFirstObject(quoted)),
  ];
  let lastErr: any;
  for (const attempt of attempts) {
    try { return JSON.parse(attempt); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

function parseOpportunities(raw: string): OpportunityDraft[] {
  const jsonContent = extractJsonBlock(raw);
  const parsed = parseJsonLoose(jsonContent);

  const opportunities = parsed.opportunities;
  if (!Array.isArray(opportunities)) {
    throw new Error('Discovery output missing "opportunities" array');
  }

  return opportunities
    .filter((o: any) => o && typeof o.title === 'string' && typeof o.description === 'string')
    .map((o: any) => ({
      title: o.title,
      description: o.description,
      rationale: typeof o.rationale === 'string' ? o.rationale : '',
      confidence: typeof o.confidence === 'number' ? o.confidence : undefined,
      evidence: Array.isArray(o.evidence)
        ? o.evidence.filter((e: any) => e && typeof e.sourceTitle === 'string')
        : [],
    }));
}

/**
 * Run a discovery batch over the given source documents and return parsed opportunity
 * drafts. Does not persist anything — callers (discovery-routes.ts) own writing the
 * discovery_runs/discovery_opportunities rows.
 */
export async function runDiscovery(sourceIds: string[]): Promise<OpportunityDraft[]> {
  const [persona, template] = await Promise.all([loadPersona(), loadTemplate()]);
  const sources = loadSources(sourceIds);
  const appState = summarizeCurrentAppState();

  const system = `${persona}\n\n## Output Template\n${template}\n\n## Source Documents\n${formatSources(sources)}\n\n## Current App State\n${appState}`;

  const webSearch = getActiveProvider() === 'anthropic';
  logger.info(`Running discovery over ${sources.length} source(s), webSearch: ${webSearch}`);

  let output = '';
  for await (const token of streamAI(
    resolveAgentModel('discovery'),
    system,
    [{ role: 'user', content: 'Run discovery and surface opportunities per your output template.' }],
    12_000,
    { webSearch },
  )) {
    output += token;
  }

  const drafts = parseOpportunities(output);
  logger.info(`Discovery run produced ${drafts.length} opportunity draft(s)`);
  return drafts;
}
