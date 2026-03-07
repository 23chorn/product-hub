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
import { streamAI, resolveModelId } from '../utils/ai-provider';
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
    model?: string
  ): Promise<CriticReview> {
    const resolvedModel = resolveModelId(model);

    // Artifact injected into system prompt, not user message
    const systemPrompt = `${this.persona}

---

## Document Under Review

**Type:** ${artifactType}

${artifactContent}

---

Review the document above according to your persona and output format. Produce Issues, Questions for the PM, Strengths, and Verdict sections.`;

    const userMessage = `Please review the ${artifactType} above.`;

    logger.info(`Critic reviewing ${artifactType} (${artifactContent.length} chars) via ${resolvedModel}`);

    // Buffer stream — output goes to DB, not the UI
    let fullText = '';
    for await (const chunk of streamAI(resolvedModel, systemPrompt, [{ role: 'user', content: userMessage }])) {
      fullText += chunk;
    }

    const review = parseReview(fullText);
    logger.info(`Critic verdict: ${review.verdict} | issues: ${review.issues.length}`);
    return review;
  }
}

// ── Output parser ─────────────────────────────────────────────────────────────

function parseReview(text: string): CriticReview {
  // Extract Issues section
  const issuesMatch = text.match(/###\s*Issues\s*\n([\s\S]*?)(?=###|$)/im);
  const issuesText = issuesMatch?.[1] ?? '';
  const issues: CriticIssue[] = issuesText
    .split('\n')
    .filter(l => /^[-*]\s/.test(l.trim()))
    .map(line => {
      const clean = line.replace(/^[-*]\s*/, '').trim();
      const severityMatch = clean.match(/^\[(critical|major|minor)\]/i);
      const severity = (severityMatch?.[1]?.toLowerCase() ?? 'minor') as CriticIssue['severity'];
      const description = clean.replace(/^\[(critical|major|minor)\]\s*/i, '').trim();
      return { severity, description };
    })
    .filter(i => i.description.length > 0 && i.description !== 'No issues found');

  // Extract Questions section
  const questionsMatch = text.match(/###\s*Questions.*?\n([\s\S]*?)(?=###|$)/im);
  const questionsText = questionsMatch?.[1] ?? '';
  const questions = questionsText
    .split('\n')
    .filter(l => /^[-*]\s/.test(l.trim()))
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(q => q.length > 0 && q !== 'None');

  // Extract Strengths section
  const strengthsMatch = text.match(/###\s*Strengths\s*\n([\s\S]*?)(?=###|$)/im);
  const strengthsText = strengthsMatch?.[1] ?? '';
  const strengths = strengthsText
    .split('\n')
    .filter(l => /^[-*]\s/.test(l.trim()))
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(s => s.length > 0);

  // Extract Verdict — last occurrence wins (LLM sometimes restates it)
  const verdictMatches = [...text.matchAll(/###\s*Verdict\s*\n+(approve|revise)/gim)];
  const rawVerdict = verdictMatches.at(-1)?.[1]?.toLowerCase() ?? 'revise';
  const verdict: CriticReview['verdict'] = rawVerdict === 'approve' ? 'approve' : 'revise';

  // Override to 'revise' if any CRITICAL issue was found
  const hasCritical = issues.some(i => i.severity === 'critical');
  const finalVerdict: CriticReview['verdict'] = hasCritical ? 'revise' : verdict;

  return { verdict: finalVerdict, issues, questions, strengths, fullText: text };
}
