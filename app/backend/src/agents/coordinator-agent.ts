import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import type { SystemPrompt, TokenUsage } from '../utils/ai-provider';
import { getPolicies } from '../data/database';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('COORDINATOR');

// ── Paths ─────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONA_PATH = path.join(PROJECT_ROOT, 'agents', 'personas', 'coordinator.md');

// ── Per-stage output format specifications ────────────────────────────────────

/**
 * Defines the expected output format the Coordinator briefs each specialist with.
 * These are injected into generateStageBrief() so specialists know what to produce.
 */
const STAGE_OUTPUT_FORMATS: Record<string, { label: string; format: string }> = {
  analyst: {
    label: 'Research Brief (Sage)',
    format: `Produce a comprehensive market research document in markdown following the research output template injected into your system prompt. Use web search to find and verify facts before writing each section.

**CITATION FORMAT — MANDATORY:**
- Every factual claim must have a bracketed number [N] immediately after it: "Market reached $4.2B [1]."
- NEVER use footnotes, superscripts, inline URLs, or "(Source: ...)" format.
- If web search found no source for a claim, write "[Assumption — no source found]" instead of inventing a reference.
- Never fabricate URLs. Only cite URLs that your web search actually returned.

The output template defines the exact section structure. Fill every section. End with a ## References section listing every source as: [N] Page title — URL. Every inline [N] must appear in References; every References entry must be cited inline.

Depth guide: each section should be as long as the evidence warrants. Do not pad short sections or truncate evidence-rich ones. Aim for a document the PM can use directly to write a PRD without doing additional research.`,
  },

  pm_prd: {
    label: 'Product Requirements Document (Rex)',
    format: `Produce a PRD in markdown with these required sections:

## Problem Statement
What problem are we solving and for whom. One paragraph.

## User Personas
The primary user types. Bullet list, 2–4 personas max.

## Key User Journeys
The 2–3 most important user journeys as step-by-step narratives.

## Success Metrics
Three tables as defined in the template:
- **Primary metric** — the single number that defines success. Must include baseline, target, timeframe, and how it is measured.
- **Secondary metrics** — 2–3 supporting signals with the same fields.
- **Counter-metrics** — 1–2 metrics that must not regress, with an acceptable floor value. These are as important as the primary metric — omitting them is a quality failure.

## Non-Functional Requirements
NFR-numbered table covering only the categories relevant to this initiative: performance (with specific thresholds), scalability, security, accessibility, data retention, availability. Each NFR must have a measurable threshold and a priority (Must / Should / Nice-to-have). Omit categories that genuinely do not apply.

## Functional Requirements
FR-numbered list (FR1, FR2, …) of capabilities the feature must have. Each FR states WHAT the system does, not HOW. Aim for 10–20 FRs.

## Open Questions & Risks
Up to 10 unresolved questions or identified risks ranked by impact. Each entry has: Type (Question/Risk), description, Impact (High/Med/Low), Owner, Status (Open). If more than 10 exist, include the top 10 and note the rest belong in a separate risk sheet.

Do not include non-functional requirements, domain compliance, innovation patterns, or appendices in the default output — those go in a separate extended document only if requested.`,
  },

  solution_architect: {
    label: 'Architecture Document (Atlas)',
    format: `Produce a solution architecture document in markdown following the architecture output template injected into your system prompt. The template defines the exact section structure — fill every section with specific, implementation-ready content. Key requirements:

- **Key Technology Decisions**: Name specific products, versions, and pricing tiers. State alternatives and tradeoffs in the table.
- **Data Model**: Full entity table with PKs, fields, relationships, and notes. Include an ASCII entity-relationship diagram.
- **API Surface**: Every endpoint with method, path, request/response shapes, and notes on auth/idempotency.
- **System Architecture**: ASCII service diagram showing all components and data flow. Include 2-3 detailed data flow walkthroughs for primary user journeys.
- **Infrastructure Notes**: Hosting topology with per-component cost estimates. Deployment pipeline steps. Failure modes table with mitigations.
- **Open Questions & Risks**: Unresolved decisions table with recommendations. Known risks with severity and specific mitigations.

If a context/tech-stack.md file was provided, align all choices with the existing stack and explain any deviations. If no tech stack was provided, recommend specific technologies with tradeoffs for each choice.`,
  },

  pm_backlog: {
    label: 'Backlog JSON (Pip)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block. Use the minimum structure that fits:

Tier 1 — Single story (1 deliverable):
{ "story": { "title": "string", "persona": "string", "goal": "string", "benefit": "string", "acceptanceCriteria": ["Given … When … Then …"], "effort": number } }

Tier 2 — Single feature (2–8 related stories, one capability):
{ "feature": { "title": "string", "description": "string", "phase": "string", "stories": [ { ...story fields... } ] } }

Tier 3 — Epic with features (multiple distinct capabilities, 2+ features):
{ "epic": { "title": "string", "description": "string", "businessValue": "string", "prdLink": "string" }, "features": [ { "title": "string", "description": "string", "phase": "string", "stories": [ { ...story fields... } ] } ] }

Decision: 1 story → Tier 1. Multiple stories, one capability → Tier 2. Multiple distinct capabilities → Tier 3.
Constraints: max 6 features per epic, max 12 stories per feature. Each story independently deliverable in a single sprint. Stories in dependency order.`,
  },

  critic: {
    label: 'Critic Review — Flint',
    format: `Produce a structured review in markdown with these sections:

## Overall Assessment
One-paragraph verdict: is this artifact ready to proceed, or must it be revised?

## Strengths
Bullet list of what is solid and should be preserved.

## Issues
Bullet list. Prefix each with severity: [BLOCKER], [MAJOR], or [MINOR].
At least one BLOCKER must be present to recommend rejection.

## Recommended Changes
Concrete, specific changes required before this artifact should be approved. Be prescriptive — "add X to section Y" not "consider improving Z".`,
  },

  gtm_strategy: {
    label: 'GTM Strategy (Quinn)',
    format: `Produce a GTM Strategy document in markdown following the GTM output template injected into your system prompt. Key requirements:

- **Positioning Statement**: Use the Geoffrey Moore template exactly: "For [segment] who [need], [product] is [category] that [benefit]. Unlike [alternative], [product] [differentiator]."
- **Target Segments & Channels**: Ranked table with columns: Segment | Description | Priority | Channels | Rationale | Cost-to-Reach. Every segment must have a channel and a rationale.
- **Messaging Framework**: Headline (≤8 words), sub-headline (≤25 words), 3 supporting bullets (each starting with a bold outcome word, ≤15 words each).
- **Launch Timeline**: Phases table with columns: Phase | Duration | Key Activities | Success Signal. Must include Pre-launch, Launch Week, and Post-Launch phases — each with a success signal.
- **Competitive Positioning**: We-win / We-lose table (3–5 rows each) plus a response playbook paragraph for the top competitive threat.
- **GTM Success Metrics**: Two tables — leading indicators (tracked weekly in first 30 days) and lagging indicators (at 30/60/90 days). Each metric must have a target and measurement method.

Do not propose budget figures. Do not redefine personas or success metrics from the PRD. Do not propose new features.`,
  },

  feature_marketing: {
    label: 'Feature Marketing Content Pack (Milo)',
    format: `Produce a Feature Marketing Content Pack in markdown following the feature marketing output template injected into your system prompt. Key requirements:

- **Feature Name & Tagline**: Recommended name + tagline, plus Alternative A and Alternative B — each with a one-sentence rationale.
- **Value Proposition Sentence**: ≤20 words, benefit-first (not a feature description). This is the north star all channel copy must trace back to.
- **Messaging Hierarchy**: Headline (≤8 words) → sub-headline (≤25 words) → 3 supporting bullets.
- **Channel Copy Pack** (all channels required):
  - App Store / Play Store: ≤170 chars, plain text, no markdown
  - Website hero: headline + 2-sentence body
  - Email announcement: subject line + 3-paragraph body
  - LinkedIn post: ≤150 words, ends with a question
  - X / Twitter: ≤280 chars + one hashtag
  - Short-form social strategy: Instagram and TikTok — hook concept, format, caption style, hashtag approach (this is a strategy section, not copy)
- **Internal FAQ**: Exactly 5 Q&A pairs. Real sales/support questions with 2–3 sentence answers. No implementation detail.

Do not reference features or capabilities not in the approved PRD or GTM strategy. Do not suggest product changes.`,
  },

  curator: {
    label: 'Context Diff (Ivy)',
    format: `Produce one or more unified diffs for files in the context/ directory.
Format each diff block as:

\`\`\`diff
--- context/<filename>
+++ context/<filename>
@@ -<line>,<count> +<line>,<count> @@
 unchanged line
-removed line
+added line
\`\`\`

Only propose changes that are factually grounded in the workflow outputs provided.
Do not invent or speculate. File names must already exist in context/.`,
  },
};

// ── Database row types ────────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  status: string;
  current_stage: string | null;
  stage_sequence: string;
  policy_overrides: string;
  created_at: number;
  updated_at: number;
}

interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  status: string;
  human_feedback: string | null;
  coordinator_action: string | null;
  created_at: number;
  resolved_at: number | null;
}

// ── CoordinatorAgent ──────────────────────────────────────────────────────────

export class CoordinatorAgent {
  private readonly persona: string;

  constructor() {
    this.persona = fs.readFileSync(PERSONA_PATH, 'utf-8');
    logger.info('Coordinator persona loaded');
  }

  // ── Prompt construction ──────────────────────────────────────────────────

  /**
   * Build the stable portion of the system prompt: persona + governance policies.
   * This portion is cacheable across requests for the same coordinator session.
   */
  private buildStablePrompt(): string {
    const policies = getPolicies('global');
    const policyLines = policies.length > 0
      ? policies.map(p => `- **${p.rule_key}**: ${p.rule_value}`).join('\n')
      : '- (no global policies defined)';

    return `${this.persona}

## Governance Policies

The following policies govern all workflow decisions. Apply them without being asked:

${policyLines}`;
  }

  /**
   * Build the dynamic portion of the system prompt: workflow goal + completed stage
   * summaries + pending checkpoint feedback. Changes per workflow and per message.
   */
  private buildDynamicPrompt(workflowId: string): string {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    if (!workflow) return '';

    const stageSequence: string[] = JSON.parse(workflow.stage_sequence ?? '[]');

    // Completed checkpoints provide the stage summary
    const completedCheckpoints = db
      .prepare<[string], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE workflow_id = ? AND status IN ('approved', 'revised')
         ORDER BY created_at ASC`
      )
      .all(workflowId);

    // Pending checkpoint = current pause point awaiting human input
    const pendingCheckpoint = db
      .prepare<[string], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE workflow_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(workflowId);

    const lines: string[] = [
      '## Current Workflow',
      '',
      `**Goal:** ${workflow.goal}`,
      `**Status:** ${workflow.status}`,
      `**Planned stages:** ${stageSequence.join(' → ') || '(not yet determined)'}`,
      `**Current stage:** ${workflow.current_stage ?? 'not started'}`,
    ];

    if (completedCheckpoints.length > 0) {
      lines.push('', '## Completed Stage Summaries', '');
      for (const cp of completedCheckpoints) {
        lines.push(`### Stage: ${cp.stage}`);
        lines.push(`Status: ${cp.status}`);
        if (cp.human_feedback) {
          lines.push(`Human feedback: ${cp.human_feedback}`);
        }
        lines.push('');
      }
    }

    if (pendingCheckpoint) {
      lines.push('## Pending Checkpoint', '');
      lines.push(`Stage: **${pendingCheckpoint.stage}** — awaiting human decision.`);
      if (pendingCheckpoint.human_feedback) {
        lines.push(`Human feedback received: ${pendingCheckpoint.human_feedback}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Returns the full split system prompt for a workflow session.
   */
  buildSystemPrompt(workflowId: string): SystemPrompt {
    return {
      stable:  this.buildStablePrompt(),
      dynamic: this.buildDynamicPrompt(workflowId),
    };
  }

  // ── Stage briefing ────────────────────────────────────────────────────────

  /**
   * Generate a structured handoff brief for a specialist agent.
   * The brief is injected as the opening user message of the specialist's session.
   *
   * Warns if the brief exceeds 800 tokens (~3200 chars) — it should stay tight
   * because the specialist's own system prompt is already large.
   */
  async generateStageBrief(
    workflowId: string,
    stage: string,
    additionalContext?: string   // critic feedback text or revision notes (used in auto-revise path)
  ): Promise<string> {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    const goal = workflow?.goal ?? '(workflow goal not found)';
    const policyOverrides: Record<string, string> = JSON.parse(
      workflow?.policy_overrides ?? '{}'
    );

    const stageFormat = STAGE_OUTPUT_FORMATS[stage];
    const outputLabel = stageFormat?.label ?? stage;

    // Always use the inline format spec — it describes WHAT to produce.
    // Template files use [placeholder] syntax that models fill in literally
    // instead of researching and writing real content.
    const outputFormat = stageFormat?.format ?? '(no format specification defined for this stage)';

    // ── Constraints ────────────────────────────────────────────────────────────
    const policies = getPolicies('global');
    const relevantPolicies = policies
      .filter(p => !['auto_approve_analyst_output', 'require_critic_review'].includes(p.rule_key))
      .map(p => `- ${p.rule_key}: ${p.rule_value}`)
      .join('\n');
    const overrideLines = Object.entries(policyOverrides)
      .map(([k, v]) => `- ${k}: ${v} *(workflow override)*`)
      .join('\n');
    const constraintsText = [relevantPolicies, overrideLines].filter(Boolean).join('\n') || 'None.';

    // ── Prior stage outputs & human preferences (from approved checkpoints) ────
    const STAGE_LABELS_BRIEF: Record<string, string> = {
      analyst:            'Research Brief (Sage)',
      pm_prd:             'PRD (Rex)',
      solution_architect: 'Architecture Document (Atlas)',
      pm_backlog:         'Backlog (Pip)',
      gtm_strategy:       'GTM Strategy (Quinn)',
      feature_marketing:  'Feature Marketing Content Pack (Milo)',
    };

    interface CheckpointRow { stage: string; human_feedback: string | null; }
    const approvedCheckpoints = db
      .prepare<[string], CheckpointRow>(`
        SELECT stage, human_feedback FROM checkpoints
        WHERE workflow_id = ? AND status = 'approved'
        ORDER BY created_at ASC
      `)
      .all(workflowId);

    const priorStages = approvedCheckpoints.map(cp => cp.stage);
    const priorOutputsText = priorStages.length > 0
      ? priorStages
          .map(s => `- ${STAGE_LABELS_BRIEF[s] ?? s} — approved and available in this workflow`)
          .join('\n')
      : 'None — this is the first stage.';

    // Key decisions: approved stages are settled; list them so specialist knows what is locked
    const decisionsText = priorStages.length > 0
      ? priorStages
          .map(s => `- ${STAGE_LABELS_BRIEF[s] ?? s} is approved and final — do not re-litigate its scope or findings`)
          .join('\n')
      : 'None.';

    // Human preferences: non-null human_feedback from approved checkpoints
    const feedbackCheckpoints = approvedCheckpoints.filter(cp => cp.human_feedback);
    const humanPrefsText = feedbackCheckpoints.length > 0
      ? feedbackCheckpoints
          .map(cp => `- At ${STAGE_LABELS_BRIEF[cp.stage] ?? cp.stage} review: "${cp.human_feedback!.slice(0, 300)}"`)
          .join('\n')
      : 'None.';

    // ── Per-stage goal (one sentence) ──────────────────────────────────────────
    const STAGE_GOAL: Record<string, string> = {
      analyst:            `Produce a comprehensive, sourced research brief that gives the PM everything they need to write a PRD for: ${goal}`,
      pm_prd:             `Produce a complete PRD that translates research findings into clear product requirements and success criteria for: ${goal}`,
      solution_architect: `Produce an architecture document that makes all technology decisions needed to build the PRD's requirements for: ${goal}`,
      pm_backlog:         `Produce a prioritised backlog of epics, features, and stories covering the full MVP scope defined in the PRD for: ${goal}`,
      gtm_strategy:       `Produce a complete Go-to-Market strategy covering positioning, target segments, messaging, launch timeline, competitive positioning, and success metrics for: ${goal}`,
      feature_marketing:  `Produce a ready-to-use feature marketing content pack with channel copy and internal FAQ based on the approved PRD and GTM strategy for: ${goal}`,
    };
    const stageGoal = STAGE_GOAL[stage] ?? `Produce the required ${outputLabel} for: ${goal}`;

    // ── Explicit boundaries (what this specialist must NOT decide) ─────────────
    const NOT_DECIDE: Record<string, string> = {
      analyst:
        'Do not propose product solutions, features, or requirements. Do not suggest what to build. ' +
        'Surface evidence only — what the market shows, what users say, what competitors do. ' +
        'Architecture, product scope, and priorities are decisions for later stages.',
      pm_prd:
        'Do not choose technology implementations or architecture patterns — those belong to Atlas. ' +
        'Do not invent research findings not present in the Research Brief. ' +
        'Do not make build-vs-buy decisions or infrastructure choices.',
      solution_architect:
        'Do not redefine personas, success metrics, or product scope — those are fixed in the approved PRD. ' +
        'Do not create new requirements; if something is missing from the PRD, flag it as a gap rather than adding scope silently.',
      pm_backlog:
        'Do not invent requirements not present in the approved PRD. ' +
        'Do not make architecture or technology decisions — if a story requires an unresolved technical choice, flag it as a dependency. ' +
        'Do not use effort scores outside the Fibonacci scale (1, 2, 3, 5, 8).',
      gtm_strategy:
        'Do not redefine personas, success metrics, or product scope from the PRD — those are fixed. ' +
        'Do not propose new features or scope expansions. ' +
        'Do not commit to specific budget figures — produce a plan actionable at any spend level. ' +
        'Pricing decisions belong to the PM, not this document.',
      feature_marketing:
        'Do not invent capabilities or benefits not present in the approved PRD or GTM strategy. ' +
        'Do not make product decisions or suggest feature changes. ' +
        'Do not write technical documentation — user-facing benefits only. ' +
        'Brand guidelines and final copy approval belong to the marketing team.',
    };
    const notDecideText = NOT_DECIDE[stage]
      ?? 'Follow the output format and scope defined above. Do not add scope that was not in the workflow goal.';

    // ── Assemble brief using structured schema ─────────────────────────────────
    const lines: string[] = [
      `# Stage Brief: ${outputLabel}`,
      '',
      `**Goal:** ${stageGoal}`,
      '',
      `**Original request:** ${goal}`,
      '',
      '**Constraints:**',
      constraintsText,
      '',
      '**Prior stage outputs available:**',
      priorOutputsText,
      '',
      '**Key decisions already made:**',
      decisionsText,
      '',
      '**Human preferences expressed:**',
      humanPrefsText,
      '',
      '**Output required:**',
      outputFormat,
      '',
      `**What this specialist must NOT decide:** ${notDecideText}`,
      '',
      '---',
      '',
      '## Execution Instructions',
      'You are executing this task autonomously. Do NOT ask questions, show menus, or wait for input.',
      '',
      '- Your entire response must be the deliverable itself — nothing else.',
      '- Write real, substantive content about the specific goal stated above. Do not use placeholder text.',
      '- Produce the complete document in one response. Do not truncate or defer any section.',
      '- If any detail is genuinely ambiguous, make a reasonable assumption — do not ask.',
    ];

    if (additionalContext) {
      lines.push('');
      lines.push('## Additional Context');
      lines.push(additionalContext.trim());
    }

    const brief = lines.join('\n');

    // Token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(brief.length / 4);
    if (estimatedTokens > 1200) {
      logger.warn(
        `Stage brief for "${stage}" is ~${estimatedTokens} tokens (target ≤ 1200). ` +
        `Consider shortening format spec or human feedback entries.`
      );
    }

    return brief;
  }

  /**
   * Build a revision brief for a specialist stage.
   *
   * Unlike generateStageBrief (which produces a from-scratch brief), this tells
   * the specialist exactly what was wrong with its prior output and instructs it
   * to fix those specific issues — not rewrite the document from scratch.
   *
   * @param workflowId   Active workflow ID (used to fetch the goal).
   * @param stage        Stage name (e.g. 'analyst').
   * @param priorDraft   Full text of the specialist's previous output.
   * @param issues       Critic issues formatted as "[SEVERITY] description" strings.
   */
  generateRevisionBrief(
    workflowId: string,
    stage: string,
    priorDraft: string,
    issues: string[]
  ): string {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    const goal = workflow?.goal ?? '(workflow goal not found)';
    const stageFormat = STAGE_OUTPUT_FORMATS[stage];
    const outputLabel = stageFormat?.label ?? stage;
    const outputFormat = stageFormat?.format ?? '(no format specification defined for this stage)';

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

    const lines: string[] = [
      `# Revision Required: ${outputLabel}`,
      '',
      '## Goal',
      goal,
      '',
      '## Issues to Fix',
      'The following issues were identified in your prior output. You MUST address each one specifically.',
      '',
      issueList,
      '',
      '## Revision Instructions',
      'Your prior draft will follow as your previous response. You are revising that document — not starting from scratch.',
      '',
      '- For each numbered issue: locate the relevant section in your prior draft and fix it directly.',
      '- Keep unchanged sections intact. Do not reorganise sections that were not flagged.',
      '- Your response must be the complete revised document (all sections) — not a diff or commentary.',
      '- Do not use placeholder text. Every factual claim needs a [N] citation or an [Assumption — no source found] marker.',
      '- If a fix requires researching new information, do so before writing.',
      '- You are executing this revision autonomously. Do NOT ask questions, show menus, or wait for input.',
      '',
      '## Required Output Format',
      outputFormat,
    ];

    return lines.join('\n');
  }

  // ── Pre-workflow planning conversation ───────────────────────────────────

  /**
   * System prompt for the coordinator's pre-workflow planning phase.
   * Used before any stage runs — coordinator gathers clarifications from the PM
   * on behalf of specialist agents, then signals readiness with COORDINATOR_READY.
   */
  private buildPlanningSystemPrompt(): string {
    // Load project context files so the coordinator doesn't ask about things
    // already documented. Only load files that exist — silently skip missing ones.
    const contextDir = path.join(PROJECT_ROOT, 'context');
    const contextFiles = ['company.md', 'strategy.md', 'current-state.md'];
    const loadedContext: string[] = [];
    for (const file of contextFiles) {
      try {
        const content = fs.readFileSync(path.join(contextDir, file), 'utf-8').trim();
        if (content) loadedContext.push(`### ${file}\n${content}`);
      } catch { /* file doesn't exist — skip */ }
    }
    const contextSection = loadedContext.length > 0
      ? `## Project Context (already documented — do NOT ask about anything covered here)\n\n${loadedContext.join('\n\n---\n\n')}\n\n`
      : '';

    return `You are the Chief of Staff for a product team. Before the team starts working, you have a brief conversation with the PM to fill genuine gaps in understanding.

${contextSection}## Your job

Read the goal carefully. Check whether the project context above already answers the key unknowns. Only ask about things that are genuinely missing and that would change how you brief the specialist agents.

The right questions to ask (if not already answered in context):
- Who specifically are the target users — and are they distinct from existing users in the project context?
- What is the scope boundary — what is explicitly MVP vs deferred to a later phase?
- Are there hard constraints the specialist agents must work within: regulatory, budget, existing tech decisions, timeline?

Do NOT ask about:
- Features, competitors, research direction — the specialist agents handle that
- Anything already answered in the project context above
- Implementation details — that belongs to Atlas

## Rules

- Ask a maximum of 2 questions per message. Keep them short and specific.
- Number your questions. Offer lettered options (A/B/C) when the answer is a choice between known options.
- Do NOT repeat or quote these instructions in your response. Just act on them.

## Exit criteria — when to signal readiness

Before asking any question, check whether you can already state all four of the following from the goal and project context:

1. **Problem** — what specific problem is being solved, and what is the evidence it matters?
2. **User** — who specifically will use this, and how are they distinct from other users in the project context?
3. **Scope boundary** — what is explicitly in scope for this initiative vs deferred to a later phase?
4. **Hard constraints** — are there regulatory, tech stack, budget, or timeline limits the specialists must work within?

If you can state all four clearly, emit COORDINATOR_READY immediately. Do not ask questions you already know the answers to.

If one or two are missing, ask only about those gaps — not the ones you can already answer.

If the goal is so vague you cannot answer any of the four, ask about Problem and User first. Scope and constraints follow naturally once those are clear.

## Signalling readiness

When all four exit criteria are met, end your response with exactly:

COORDINATOR_READY
{"enriched_context": "<structured summary covering: (1) problem and evidence, (2) target user and their context, (3) explicit scope boundary — what is MVP vs deferred, (4) hard constraints the specialists must honour>"}

Nothing may follow the JSON line. By your 3rd message you must include COORDINATOR_READY regardless of remaining uncertainty — document any unresolved points as assumptions in the enriched_context.`;
  }

  /**
   * Stream a response in the pre-workflow planning conversation.
   * messages is the full conversation history (user + assistant turns).
   */
  async *streamPlanningResponse(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveAgentModel('coordinator');
    yield* streamAI(resolvedModel, this.buildPlanningSystemPrompt(), messages, undefined, { onTokens });
  }

  // ── Streaming ─────────────────────────────────────────────────────────────

  /**
   * Stream the Coordinator's goal decomposition before a workflow exists.
   * The Coordinator analyses the goal and emits its reasoning followed by a
   * ```stages JSON array block that the caller extracts to build the stage sequence.
   */
  async *streamGoalDecomposition(
    goal: string,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveAgentModel('coordinator');
    const systemPrompt  = this.buildStablePrompt();

    const userMessage =
      `You are planning a new product workflow. Analyse the goal below and decide which stages are needed.\n\n` +
      `**Goal:** ${goal}\n\n` +
      `Available stages (in typical order):\n` +
      `- analyst              — Sage, research & problem space analysis\n` +
      `- pm_prd               — Rex, Product Requirements Document\n` +
      `- solution_architect   — Atlas, system architecture, tech decisions, data model, API design\n` +
      `- pm_backlog           — Pip, backlog of epics/stories\n` +
      `- critic               — Flint, adversarial review of the above artifacts\n` +
      `- curator              — Ivy, update project context files with learnings\n\n` +
      `Explain your reasoning briefly, then output the chosen stage sequence as a JSON array in a \`\`\`stages code block.\n\n` +
      `Example:\n\`\`\`stages\n["analyst", "pm_prd", "pm_backlog"]\n\`\`\``;

    logger.info(`Coordinator decomposing goal: "${goal.slice(0, 80)}…"`);

    yield* streamAI(
      resolvedModel,
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      undefined,
      { onTokens }
    );
  }

  /**
   * Stream a coordinator response for a workflow session.
   * Token logging is handled internally by streamAI().
   */
  async *streamResponse(
    workflowId: string,
    userMessage: string,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveAgentModel('coordinator');
    const systemPrompt  = this.buildSystemPrompt(workflowId);

    logger.info(`Coordinator responding for workflow ${workflowId} via model ${resolvedModel}`);

    yield* streamAI(
      resolvedModel,
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      undefined,
      { onTokens }
    );
  }
}
