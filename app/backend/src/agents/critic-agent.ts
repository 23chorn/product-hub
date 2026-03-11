/**
 * Critic Agent — Adversarial Reviewer
 *
 * Standalone class (does NOT extend BmadAgent).
 * Single-shot reviewer: takes an artifact string, returns a structured review.
 * No menu, no session, no multi-turn conversation.
 * The artifact is injected into the system prompt, not passed as a user message.
 */

import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveModelId, getActiveProvider, type SystemPrompt, type TokenUsage } from '../utils/ai-provider';
import Logger from '../utils/logger';

const logger = new Logger('CRITIC');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONA_PATH = path.join(PROJECT_ROOT, 'agents', 'personas', 'critic.md');

// ── Public types ──────────────────────────────────────────────────────────────

export interface CriticIssue {
  severity: 'critical' | 'major' | 'minor';
  description: string;
}

export interface CriticReview {
  verdict: 'approve' | 'revise';
  issues: CriticIssue[];
  questions: string[];
  strengths: string[];
  fullText: string;
}

// ── CriticAgent ───────────────────────────────────────────────────────────────

export class CriticAgent {
  private readonly persona: string;

  constructor() {
    this.persona = fs.readFileSync(PERSONA_PATH, 'utf-8');
    logger.info('Critic persona loaded');
  }

  /**
   * Review an artifact and return a structured critique.
   *
   * @param artifactContent  Full text of the artifact to review.
   * @param artifactType     Human-readable type label, e.g. "PRD", "Research Brief".
   * @param model            Optional model override.
   */
  async review(
    artifactContent: string,
    artifactType: string,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): Promise<CriticReview> {
    const resolvedModel = resolveModelId(model);

    // Split prompt for caching: persona is stable (cached across reviews),
    // artifact is dynamic (changes each call). This saves ~90% of persona
    // input tokens on subsequent reviews.
    const providerNote = getActiveProvider() !== 'anthropic'
      ? `\n\n**IMPORTANT — No web search available:** The analyst did NOT have access to web search for this document. It was produced using the model's prior knowledge only. Therefore:
- Do NOT flag missing citations, unsourced claims, or lack of references as issues
- Do NOT flag "[Unverified]" markers as defects — they are expected and correct behaviour
- Do NOT flag the absence of a References section as a problem
- Focus your review on the quality of analysis, reasoning, structure, completeness, and actionability of the content itself`
      : '';

    const stable = `${this.persona}${providerNote}

---

Review the document provided below according to your persona and output format. Produce Issues, Questions for the PM, Strengths, and Verdict sections.`;

    const dynamic = `## Document Under Review

**Type:** ${artifactType}

${artifactContent}`;

    const systemPrompt: SystemPrompt = { stable, dynamic };
    const userMessage = `Please review the ${artifactType} above.`;

    logger.info(`Critic reviewing ${artifactType} (${artifactContent.length} chars) via ${resolvedModel}`);

    // Buffer stream — output goes to DB, not the UI
    let fullText = '';
    for await (const chunk of streamAI(resolvedModel, systemPrompt, [{ role: 'user', content: userMessage }], undefined, { onTokens })) {
      fullText += chunk;
    }

    const review = parseReview(fullText);
    logger.info(`Critic verdict: ${review.verdict} | issues: ${review.issues.length}`);
    return review;
  }
}

// ── Output parser ─────────────────────────────────────────────────────────────

/**
 * Extract a section by heading (supports ##, ###, ####, or **bold** headings).
 * Returns the body text between this heading and the next heading of same/higher level.
 */
function extractSection(text: string, sectionName: string): string {
  // Try markdown headings: ## Issues, ### Issues, #### Issues
  // Stop at next heading, horizontal rule (---), or end of string.
  // Using greedy match with explicit boundary alternatives avoids $ end-of-line issues.
  const headingPattern = new RegExp(
    `^#{2,4}\\s*${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{2,4}\\s|\\n---\\s*\\n|\\n---\\s*$)`,
    'im'
  );
  const headingMatch = text.match(headingPattern);
  if (headingMatch?.[1]?.trim()) return headingMatch[1];

  // Fallback: heading is near end of string — grab everything after it
  const headingFallback = new RegExp(
    `^#{2,4}\\s*${sectionName}[^\\n]*\\n([\\s\\S]*)$`,
    'im'
  );
  const fallbackMatch = text.match(headingFallback);
  if (fallbackMatch?.[1]?.trim()) return fallbackMatch[1];

  // Try bold headings: **Issues** or **Issues:**
  const boldPattern = new RegExp(
    `\\*\\*${sectionName}[^*]*\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|\\n#{2,4}\\s|\\n---\\s*\\n|\\n---\\s*$)`,
    'im'
  );
  const boldMatch = text.match(boldPattern);
  if (boldMatch?.[1]?.trim()) return boldMatch[1];

  return '';
}

function parseBulletList(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*]\s/.test(l) || /^\d+[.)]\s/.test(l))
    .map(l => l.replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter(l => l.length > 0);
}

function parseReview(text: string): CriticReview {
  // Extract Issues section
  const issuesText = extractSection(text, 'Issues');
  const issues: CriticIssue[] = parseBulletList(issuesText)
    .map(clean => {
      // Handle severity tags with optional backticks and/or bold:
      // `[MAJOR]`, [MAJOR], **[MAJOR]**, `[MAJOR]` **desc**, etc.
      const severityMatch = clean.match(/^[`*]*\[(critical|major|minor)\][`*]*\s*/i);
      const severity = (severityMatch?.[1]?.toLowerCase() ?? 'minor') as CriticIssue['severity'];
      const description = severityMatch
        ? clean.slice(severityMatch[0].length).replace(/^\*\*\s*/, '').replace(/\*\*\s*$/, '').trim()
        : clean;
      return { severity, description };
    })
    .filter(i => i.description.length > 0 && !/^no (issues|problems) found/i.test(i.description) && !/^none$/i.test(i.description));

  // Extract Questions section
  const questionsText = extractSection(text, 'Questions');
  const questions = parseBulletList(questionsText)
    .filter(q => !/^none$/i.test(q));

  // Extract Strengths section
  const strengthsText = extractSection(text, 'Strengths');
  const strengths = parseBulletList(strengthsText);

  // Extract Verdict — search broadly for approve/revise after a "Verdict" label
  // Try heading format first, then inline format like "**Verdict:** approve"
  const verdictMatches = [...text.matchAll(/(?:#{2,4}\s*)?Verdict[:\s*]*\n*\s*(approve|revise)/gim)];
  let rawVerdict = verdictMatches.at(-1)?.[1]?.toLowerCase();

  // Fallback: look for standalone "approve" or "revise" in the last 200 chars
  if (!rawVerdict) {
    const tail = text.slice(-200).toLowerCase();
    if (tail.includes('approve') && !tail.includes('revise')) rawVerdict = 'approve';
    else if (tail.includes('revise')) rawVerdict = 'revise';
  }

  const verdict: CriticReview['verdict'] = rawVerdict === 'approve' ? 'approve' : 'revise';

  // Override to 'revise' if any CRITICAL issue or 2+ MAJOR issues found
  const hasCritical = issues.some(i => i.severity === 'critical');
  const majorCount = issues.filter(i => i.severity === 'major').length;
  const forceRevise = hasCritical || majorCount >= 2;
  const finalVerdict: CriticReview['verdict'] = forceRevise ? 'revise' : verdict;

  // Safeguard: if verdict is 'revise' but there are no actionable issues, treat as 'approve'
  const safeVerdict = (finalVerdict === 'revise' && issues.length === 0) ? 'approve' : finalVerdict;
  if (safeVerdict !== finalVerdict) {
    logger.info(`Verdict overridden: ${finalVerdict} → approve (no actionable issues found)`);
  }

  logger.info(`Parsed review: verdict=${safeVerdict} issues=${issues.length} questions=${questions.length} strengths=${strengths.length}`);

  return { verdict: safeVerdict, issues, questions, strengths, fullText: text };
}
