import { SpecialistAgent } from './specialist-agent';
import { StatusChange } from '@pap/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import Logger from '../utils/logger';
import { stripJsonFence } from '../utils/json-repair';
import { findRepoRoot } from '../utils/find-repo-root';

const logger = new Logger('CONTEXT-REVIEW');

const CONTEXT_ROOT = path.join(findRepoRoot(__dirname), 'context');

export interface ProposalItem {
  fileName: string;
  sectionHint: string;
  proposedText: string;
  rationale: string;
}

/**
 * Load all context/*.md files as a map of fileName → content.
 */
async function loadAllContextFiles(): Promise<Record<string, string>> {
  const entries = await fs.readdir(CONTEXT_ROOT, { withFileTypes: true });
  const mdFiles = entries.filter(e =>
    e.isFile() &&
    e.name.endsWith('.md') &&
    !e.name.endsWith('.example.md') &&
    e.name.toLowerCase() !== 'readme.md'
  );
  const result: Record<string, string> = {};
  for (const file of mdFiles) {
    result[file.name] = await fs.readFile(path.join(CONTEXT_ROOT, file.name), 'utf-8');
  }
  return result;
}

/**
 * Build the one-shot review prompt for Kira.
 */
function buildReviewPrompt(changes: StatusChange[], contextFiles: Record<string, string>): string {
  const changesText = changes.map(c =>
    `- "${c.title}" (ID: ${c.airtableId}): ${c.oldStatus} → ${c.newStatus}`
  ).join('\n');

  const filesText = Object.entries(contextFiles).map(([name, content]) =>
    `### ${name}\n\`\`\`\n${content || '(empty file)'}\n\`\`\``
  ).join('\n\n');

  return `The following Airtable initiative status changes have been detected:

${changesText}

Here are all current context documents:

${filesText}

Please review these status changes against the context documents and propose specific, targeted updates.

IMPORTANT: Respond with ONLY a valid JSON array. No preamble, no explanation outside the JSON. If no changes are needed, respond with an empty array [].

Each item in the array must have exactly these fields:
- "fileName": the context file to update (e.g. "current-state.md")
- "sectionHint": the markdown section heading this edit targets (e.g. "## Active Initiatives")
- "proposedText": the full replacement text for that section (include the section heading)
- "rationale": one sentence explaining which status transition drove this proposal

Example format:
[
  {
    "fileName": "current-state.md",
    "sectionHint": "## Active Initiatives",
    "proposedText": "## Active Initiatives\\n\\n- Feature X is now in active development.",
    "rationale": "Feature X transitioned from Ready to In Progress, so Active Initiatives must reflect it."
  }
]`;
}

/**
 * Run a non-streaming AI call to get context proposals.
 * Accumulates the full streamed response before parsing.
 */
export async function generateContextProposals(
  agent: SpecialistAgent,
  changes: StatusChange[],
  modelOverride?: string
): Promise<ProposalItem[]> {
  const contextFiles = await loadAllContextFiles();
  const userMessage = buildReviewPrompt(changes, contextFiles);

  const persona = await agent.loadPersona();
  const systemPrompt = await agent.buildSystemPrompt(persona);

  let fullResponse = '';
  for await (const chunk of agent.streamResponse(
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    modelOverride
  )) {
    fullResponse += chunk;
  }

  logger.info(`Context review raw response: ${fullResponse.length} chars`);

  // Strip markdown code fences (and any preamble) the model may wrap around JSON.
  // The previous local regex required a "json" language tag, so a plain ``` fence
  // was never stripped — stripJsonFence handles both.
  const cleaned = stripJsonFence(fullResponse);

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
    const valid = parsed.filter(
      (item: any) => item.fileName && item.proposedText && item.rationale
    ) as ProposalItem[];
    logger.info(`Parsed ${valid.length} valid proposal(s)`);
    return valid;
  } catch (err: any) {
    logger.error('Failed to parse context proposals JSON', err);
    logger.error('Raw response (first 500 chars):', fullResponse.slice(0, 500));
    return [];
  }
}

/**
 * Write a confirmed proposal to the appropriate context file.
 * Replaces the target section if sectionHint is found; otherwise appends.
 */
export async function writeContextProposal(proposal: {
  fileName: string;
  sectionHint: string | null;
  proposedText: string;
}): Promise<void> {
  const filePath = path.join(CONTEXT_ROOT, proposal.fileName);

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    content = '';
  }

  if (proposal.sectionHint && content.includes(proposal.sectionHint)) {
    // Replace from the matching heading up to the next ## heading (or end of file)
    const escaped = proposal.sectionHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |$)`);
    const updated = content.replace(sectionRegex, proposal.proposedText + '\n\n');
    await fs.writeFile(filePath, updated, 'utf-8');
    logger.info(`Replaced section "${proposal.sectionHint}" in ${proposal.fileName}`);
    return;
  }

  // Fallback: append to file
  const appended = content.trimEnd() + '\n\n' + proposal.proposedText + '\n';
  await fs.writeFile(filePath, appended, 'utf-8');
  logger.info(`Appended to ${proposal.fileName}`);
}
