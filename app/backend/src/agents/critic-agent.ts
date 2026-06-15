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
const PERSONAS_DIR = path.join(PROJECT_ROOT, 'agents', 'personas');
const CORE_PERSONA_PATH = path.join(PERSONAS_DIR, 'critic-core.md');

const STAGE_CRITIC_FILE: Record<string, string> = {
  analyst:           'critic-analyst.md',
  pm_prd:            'critic-prd.md',
  solution_architect:'critic-architect.md',
  story_decomposition:'critic-backlog.md',
  qa_engineer:       'critic-qa.md',
};

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

Structural validation (citation counts, references section, suspicious URLs, assumption markers) has already been performed by automated tools before this review. Do not re-raise those checks.

Focus on:
- Is the analysis genuinely insightful, or does it only restate commonly known facts?
- Are risks and opportunities specific to this domain, market, and user segment — or generic?
- Does the research directly address the stated initiative goal, or drift into adjacent topics?
- Are strategic implications actionable enough for the PM to make a scoping decision?
- If the brief names a specific geography or segment, is it actually covered — not just a proxy market?

`;

    case 'pm_prd':
      return `## Artifact Stage: PRD (Rex)

Structural validation (required sections, metric baselines/targets, counter-metric presence, NFR measurability, personas section, Out of Scope presence, Open Questions presence) has already been performed by automated tools. Do not re-raise those checks.

Focus on:
- Does every FR trace to a stated user problem — or is it a solution assumption?
- Are FRs written as capabilities ("users can…"), not implementation instructions?
- Are missing FRs for obviously implied behaviour present (error states, empty states, permission failures)?
- Are personas grounded in the research brief — or invented archetypes?
- Are success metrics measuring the right outcome (not a vanity proxy)?
- Are metric targets directionally plausible — or aspirational with no basis?
- Are counter-metrics protecting the specific existing flows at risk from this change?
- The PRD is provided as a reference document — use it to check FR completeness.

`;

    case 'solution_architect':
      return `## Artifact Stage: Architecture Document (Atlas)

Structural validation (TBD detection, Repository Impact section, Cross-Platform Contracts section, cost estimates, failure mode table) has already been performed by automated tools. Do not re-raise those checks.

Focus on:
- **CRITICAL**: Does any technology in technology_decisions that is absent from the existing tech stack also appear in the new_dependencies field with a credible justification? If not, the architecture has introduced an undeclared dependency.
- **CRITICAL**: Does any technology choice duplicate a capability already provided by the existing stack (e.g. SignalR when WebSocket exists, Kafka/RabbitMQ when Redis pub/sub exists, a new auth provider when existing auth covers it)? Name the overlap explicitly.
- **MAJOR**: Is each new_dependencies entry justified with a specific, nameable gap in the existing stack — or does it use vague language ("better performance", "needed for real-time")?
- Are Repository Impact entries that say "No changes" plausible — or has the architect silently omitted repos that clearly need work?
- Are Cross-Platform Contracts internally consistent with the API surface described elsewhere in the document?
- Does every NFR from the PRD have a specific architectural decision addressing it — not just an acknowledgement?
- Are PRD open questions resolved or explicitly acknowledged with a mitigation approach?
- Is the data model sound (normalisation choices, indexing for query patterns)?
- Does the scalability approach actually support the stated load assumptions?
- PM Questions cover business constraints only — not technology choices.

`;

    case 'epic_feature_planner':
      return `## Artifact Stage: Epic & Feature Plan (Apex)

Structural validation (phase labels, feature count limits, AC count, FR ID format, prdRef presence) has already been performed by automated tools. Do not re-raise those checks.

Focus on:
- Are feature descriptions genuinely informative — or vague summaries a PM could have written without reading the PRD? A description like "Users can send messages" fails. It must state what the user gains, why it matters to the product hypothesis, and why it belongs in this phase.
- Does each feature include a rationale that explains why it is in this phase rather than earlier or later? Absent rationale is a MAJOR issue — it signals the phase plan was not thought through.
- Are acceptance criteria specific enough that a QA engineer can write a test plan from them? Vague ACs like "performs well" or "works correctly" are MAJOR issues. ACs covering a feature constrained by an NFR must cite the measurable threshold from that NFR.
- Are the nonFunctionalRequirements in prdRef accurate — do the referenced NFR IDs actually exist in the PRD, and do they genuinely constrain this feature? A feature that touches latency, security, compliance, or availability should reference the relevant NFR. An empty nonFunctionalRequirements on a latency-sensitive or compliance-relevant feature is suspicious — flag it.
- Does the phasing tell a coherent story? MVP should contain the minimum to validate the core hypothesis — nothing more. Features in Phase 1+ that could have been in MVP without scope risk are a MAJOR issue. Features in MVP that are clearly non-essential are also a MAJOR issue.
- Is the out-of-scope list explicit and credible? It should make clear what is NOT being built and why, not just list vague deferrals.
- PM Questions should cover scope decisions and phase sequencing that only the PM can confirm — not implementation details.

`;

    case 'story_decomposition':
      return `## Artifact Stage: Backlog (Pip)

Structural validation (story_id format, field names, Given/When/Then format, AC counts, Fibonacci points, platform tags, technical ACs, test cases) has already been performed by automated tools. Do not re-raise those checks.

The PRD document is provided above in the Reference Documents section. Use it to verify that every functional requirement has a corresponding story.

Focus on:
- Are stories independently deliverable — or do hidden dependencies exist?
- Are circular dependencies present (CRITICAL)?
- Are ACs testable by a QA engineer, or do they require judgement calls?
- Are effort scores internally consistent across similar-complexity stories?
- Are stories covering significant integration work underestimated?
- Does every PRD functional requirement have a corresponding story — or has scope been silently dropped?
- Are platform tags accurate — does a "web-only" story hide backend work?
- Do phase tags contradict the PRD's Out of Scope section (CRITICAL)?

`;

    default:
      return '';
  }
}

// ── CriticAgent ───────────────────────────────────────────────────────────────

export class CriticAgent {
  private readonly corePersona: string;

  constructor() {
    this.corePersona = fs.readFileSync(CORE_PERSONA_PATH, 'utf-8');
    logger.info('Critic core persona loaded');
  }

  private loadStageChecks(stage?: string): string {
    if (!stage) return '';
    const file = STAGE_CRITIC_FILE[stage];
    if (!file) return '';
    try {
      return fs.readFileSync(path.join(PERSONAS_DIR, file), 'utf-8');
    } catch {
      logger.warn(`No stage-specific critic file found for stage "${stage}" (${file})`);
      return '';
    }
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

    const stable = `${this.corePersona}${providerNote}

---

Review the document provided below according to your identity, output format, and the stage-specific checks injected below. Produce Issues, Questions for the PM, Strengths, and Verdict sections.`;

    const stageChecks = this.loadStageChecks(stage);
    const stageInstructions = stageChecks
      ? `## Stage-Specific Review Checks\n\n${stageChecks}\n\n`
      : buildStageInstructions(stage); // fallback to inline for unlisted stages

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
