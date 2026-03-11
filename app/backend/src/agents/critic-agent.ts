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

// ── Stage-specific review guidance ────────────────────────────────────────────

/**
 * Returns a block of stage-specific instructions injected into the dynamic
 * (uncached) portion of the critic's system prompt.
 *
 * Analyst: source/citation questions belong in Issues (agent-resolvable), NOT
 *   in Questions for the PM. The PM cannot verify research provenance.
 *
 * PRD / Backlog: questions should focus on scope, expected behaviour,
 *   functionality, and acceptance criteria — things only the PM can decide.
 */
function buildStageInstructions(stage?: string): string {
  switch (stage) {
    case 'analyst':
      return `## Stage Context: Research Brief

**Critical rule — source questions are Issues, not PM questions:**
Any uncertainty you have about where a data point came from, whether a statistic is real, or whether a URL is authentic MUST be raised as a \`[MAJOR]\` Issue — not as a Question for the PM.
The PM is not able to verify research sources. Instead, instruct the agent to take one of these actions:
1. Find a verifiable citation and add the correct \`[N]\` reference, OR
2. Add an explicit \`[Assumption — no source found]\` caveat inline, OR
3. Remove the unsupported claim entirely.

**Questions for the PM on this artifact** are limited to methodology scope questions only — e.g. "Should this cover the APAC market specifically?" or "Was a cost-comparison to legacy systems required?" Not anything about data provenance.

`;

    case 'pm_prd':
      return `## Stage Context: Product Requirements Document

**Questions for the PM** should focus on things only the PM can decide:
- **Scope**: What is explicitly in scope vs out of scope for this version?
- **Expected behaviour**: How should the system behave in specific edge cases — errors, empty states, permission boundaries, concurrent actions?
- **Functionality**: What exactly happens when the user does X? What triggers Y?
- **Business logic**: Are acceptance criteria specific enough to test? What does "success" look like for an ambiguous requirement?
- **Ownership**: Who decides if a requirement is satisfied? Who signs off on edge case behaviour?

Do NOT ask about technical implementation — that belongs in the architecture stage.

`;

    case 'solution_architect':
      return `## Stage Context: Architecture Document

**Questions for the PM** should cover only business or product constraints that affect architecture choices:
- Scale expectations or SLA requirements not stated in the PRD
- Compliance or regulatory constraints that affect data handling
- Feature priority that affects which services to build first vs later
- Unclear requirements that lead to two equally valid but incompatible designs

Do NOT ask about technology choices or implementation details — those are in the architect's domain.

`;

    case 'pm_backlog':
      return `## Stage Context: Product Backlog

**Questions for the PM** should focus on:
- **Story scope**: Is this story too large to deliver in a single sprint? Should it be split?
- **Acceptance criteria**: Are the Given/When/Then conditions unambiguous and independently testable?
- **Dependencies**: Can story X genuinely be delivered before story Y, or is there a hidden dependency?
- **Business value**: What user outcome does this feature enable? Is it clear from the story title?
- **Edge cases**: What happens when the user hits an error state, empty state, or permission boundary within this story?

Do NOT ask about technical implementation within stories — that is for the engineer to decide.

`;

    default:
      return '';
  }
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
   * @param stage            Workflow stage name — used to inject stage-specific review guidance.
   */
  async review(
    artifactContent: string,
    artifactType: string,
    model?: string,
    onTokens?: (usage: TokenUsage) => void,
    stage?: string,
    priorIssues?: string[]
  ): Promise<CriticReview> {
    const resolvedModel = resolveModelId(model);

    // Split prompt for caching: persona is stable (cached across reviews),
    // artifact + stage instructions are dynamic (vary per call).
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

    const stageInstructions = buildStageInstructions(stage);

    const revisionContext = (priorIssues && priorIssues.length > 0)
      ? `## This Is a Revision

The specialist has already revised this document in response to a previous review. The issues raised in that review were:

${priorIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

**Your job on this revision:**
- Check whether each prior issue has been adequately addressed. If it has, do NOT re-raise it.
- Only flag issues that are genuinely unresolved from the prior list, or new CRITICAL/MAJOR problems introduced by the revision itself.
- Do not invent new MAJOR issues simply because you are looking closely. If the revised document is substantially improved, approve it.
- Apply the same proportionate calibration as usual — the bar for CRITICAL/MAJOR has not changed.

`
      : '';

    const dynamic = `${revisionContext}${stageInstructions}## Document Under Review

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
