/**
 * Critic Agent — Adversarial Reviewer
 *
 * Standalone class (does NOT extend SpecialistAgent).
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
      return `## Artifact Stage: Research Brief (Sage)

Apply the **Research Brief** stage-specific checks from your persona. Key enforcement reminder:
- Source/citation questions are **Issues**, never PM Questions. The PM cannot verify research provenance.
- Risks must be domain-specific — generic risks are **MAJOR**.
- PM Questions are limited to methodology scope only (geography, segments, depth requested).

`;

    case 'pm_prd':
      return `## Artifact Stage: PRD (Rex)

Apply the **PRD** stage-specific checks from your persona. Key enforcement reminders:
- Every FR must trace to a user problem. Solution-first requirements are **MAJOR**.
- Success metrics without a baseline, target, timeframe, or measurement method are **MAJOR**.
- Counter-metrics missing entirely is **MAJOR**.
- Empty or missing Out of Scope section is **MAJOR**.
- PM Questions cover scope, edge case behaviour, and business logic — not implementation.

`;

    case 'solution_architect':
      return `## Artifact Stage: Architecture Document (Atlas)

Apply the **Architecture Document** stage-specific checks from your persona. Key enforcement reminders:
- Unresolved technology choices are **CRITICAL** (core path) or **MAJOR** (non-critical).
- Every NFR from the PRD must be addressed — silence is **MAJOR**.
- Missing cost estimates are **MAJOR**.
- Silent introduction of technologies not in the existing tech stack is **MAJOR**.
- PM Questions cover business constraints only — not technology choices.

`;

    case 'pm_backlog':
      return `## Artifact Stage: Backlog (Pip)

Apply the **Backlog** stage-specific checks from your persona. Key enforcement reminders:
- The PRD document is provided above in the Reference Documents section. Use it to verify that every functional requirement has a corresponding story — do not flag FR coverage as unverifiable.
- ACs written as "system shall..." without Given/When/Then are **MAJOR**.
- Stories scored above 8 that haven't been decomposed are **MAJOR**.
- Inconsistent effort scoring across similar-complexity stories is **MAJOR**.
- PRD functional requirements with no corresponding story are **MAJOR** — scope has been silently dropped.
- Phase tags contradicting the PRD's Out of Scope section are **CRITICAL**.
- PM Questions cover scope ambiguity — not estimation or AC format.

`;

    case 'gtm_strategy':
      return `## Artifact Stage: GTM Strategy (Quinn)

Apply the **GTM Strategy** stage-specific checks. Key enforcement reminders:
- **CRITICAL**: Any new features or scope not present in the approved PRD introduced here.
- **MAJOR**: Positioning statement does not follow the Geoffrey Moore template exactly.
- **MAJOR**: Target segments table missing channel or rationale for any segment.
- **MAJOR**: Launch timeline missing any of the three required phases (Pre-launch, Launch Week, Post-Launch).
- **MAJOR**: GTM success metrics missing measurement method for any metric.
- **MAJOR**: Any target segment that contradicts the PRD's defined personas.
- **MINOR**: Specific budget figures included (out of scope for this document).
- **MINOR**: A single phase has activities but no success signal.
- PM Questions cover strategic tradeoffs only — not product scope or feature decisions.

`;

    case 'feature_marketing':
      return `## Artifact Stage: Feature Marketing Content Pack (Milo)

Apply the **Feature Marketing** stage-specific checks. Key enforcement reminders:
- **CRITICAL**: Any copy referencing features or benefits not present in the approved PRD or GTM strategy.
- **CRITICAL**: Any product change proposed or capability invented.
- **MAJOR**: Value proposition sentence exceeds 20 words or is feature-descriptive rather than benefit-focused.
- **MAJOR**: Generic superlatives (amazing, revolutionary, best-in-class) in the headline or value proposition sentence.
- **MAJOR**: App Store / Play Store copy exceeds 170 characters.
- **MAJOR**: Twitter / X post exceeds 280 characters.
- **MAJOR**: Any channel block missing entirely — all six channel types are required (App Store, website hero, email, LinkedIn, X/Twitter, short-form social strategy with Instagram and TikTok coverage).
- **MAJOR**: Fewer than 5 FAQ pairs in the Internal FAQ section.
- **MAJOR**: More than 2 FAQ answers containing implementation detail.
- **MINOR**: LinkedIn post exceeds 150 words.
- **MINOR**: Any FAQ answer exceeds 3 sentences.
- **MINOR**: Generic superlatives in supporting bullets only (not headline or VP sentence).
- PM Questions cover brand or audience tradeoffs only — not product or feature decisions.

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
    priorIssues?: string[],
    referenceDocuments?: string
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

    const referenceSection = referenceDocuments
      ? `## Reference Documents\n\nThe following documents were used to produce the artifact below. Use them to verify completeness and consistency — for example, confirming every PRD functional requirement has a corresponding story in the backlog.\n\n${referenceDocuments}\n\n---\n\n`
      : '';

    const dynamic = `${revisionContext}${stageInstructions}${referenceSection}## Document Under Review

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
