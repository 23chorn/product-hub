/**
 * Doc Reviewer Agent ("Cass")
 *
 * One-shot, single-file review triggered on demand from Knowledge Studio — never a
 * batch/whole-repo scan. Output is a list of suggestions persisted as kb_comments
 * with source='agent'; the reviewed file's content is never modified.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import { repairTruncatedJson, parseJsonLoose } from '../utils/json-repair';
import Logger from '../utils/logger';
import { findRepoRoot } from '../utils/find-repo-root';

const logger = new Logger('KB-REVIEWER-AGENT');

const PROJECT_ROOT = findRepoRoot(__dirname);
const PERSONA_PATH = path.join(PROJECT_ROOT, 'agents/personas/doc-reviewer.md');
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'agents/templates/doc-review.template.md');
const GUIDELINES_PATH = path.join(PROJECT_ROOT, 'context/doc-review-guidelines.md');

export interface DocSuggestion {
  quote?: string;
  comment: string;
  severity: 'minor' | 'major';
}

async function loadPersona(): Promise<string> {
  const raw = await fs.readFile(PERSONA_PATH, 'utf-8');
  return raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
}

async function loadTemplate(): Promise<string> {
  return fs.readFile(TEMPLATE_PATH, 'utf-8');
}

/** Committee-authored review instructions, edited via Knowledge Studio's Context section. Returns '' if not yet created. */
async function loadCommitteeGuidelines(): Promise<string> {
  try {
    return (await fs.readFile(GUIDELINES_PATH, 'utf-8')).trim();
  } catch {
    return '';
  }
}

function parseSuggestions(output: string): DocSuggestion[] {
  let parsed: any = null;
  try {
    parsed = JSON.parse(repairTruncatedJson(output));
  } catch {
    parsed = parseJsonLoose(output);
  }
  const suggestions = parsed?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .filter((s: any) => s && typeof s.comment === 'string' && s.comment.trim())
    .map((s: any) => ({
      quote: typeof s.quote === 'string' && s.quote.trim() ? s.quote.trim() : undefined,
      comment: s.comment.trim(),
      severity: s.severity === 'major' ? 'major' : 'minor',
    }));
}

/** Review a single doc against the committee's guidelines and return suggestions. Never rewrites the file. */
export async function runDocReview(file: { path: string; content: string; repoLabel: string }): Promise<DocSuggestion[]> {
  const [persona, template, guidelines] = await Promise.all([
    loadPersona(),
    loadTemplate(),
    loadCommitteeGuidelines(),
  ]);

  const system = [
    persona,
    `## Output Template\n${template}`,
    guidelines ? `## Committee Review Guidelines\n${guidelines}` : '',
  ].filter(Boolean).join('\n\n');

  const userMessage = `Review this file from "${file.repoLabel}" at \`${file.path}\`:\n\n${file.content}`;

  let output = '';
  for await (const token of streamAI(resolveAgentModel('doc_review'), system, [{ role: 'user', content: userMessage }], 4_000)) {
    output += token;
  }

  const suggestions = parseSuggestions(output);
  logger.info(`Reviewed ${file.path} (${file.repoLabel}): ${suggestions.length} suggestion(s)`);
  return suggestions;
}
