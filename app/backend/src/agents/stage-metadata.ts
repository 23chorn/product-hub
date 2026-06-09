import type { AppMode, AgentType } from '@pap/shared';

// ── Stage → specialist session mapping ────────────────────────────────────────

export const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  prototype:            { mode: 'prototype',         agentType: 'prototype-builder' },
  pm_backlog:           { mode: 'backlog',           agentType: 'pm' },
  gtm_strategy:         { mode: 'gtm',               agentType: 'gtm' },
  feature_marketing:    { mode: 'feature_marketing', agentType: 'marketer' },
  qa_engineer:          { mode: 'qa',                agentType: 'qa-engineer' },
  tech_refinement:      { mode: 'tech_refinement', agentType: 'tech-refinement' },
};

// Per-stage output token ceiling. Backlog gets more headroom because the JSON
// scales with story count (6 features × 12 stories at max = ~22k tokens).
// All Claude 4.x models support 64k output, so these are safe upper bounds.
export const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:            12_000,
  pm_prd:             12_000,
  solution_architect: 12_000,
  pm_backlog:         32_000,
  gtm_strategy:       12_000,
  prototype:          64_000,
  feature_marketing:  12_000,
  qa_engineer:        32_000,
  tech_refinement:    32_000,
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
export const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:            'analyst',
  pm_prd:             'prd',
  solution_architect: 'architecture',
  prototype:          'prototype',
  pm_backlog:         'backlog',
  gtm_strategy:       'gtm',
  feature_marketing:  'feature_marketing',
  qa_engineer:        'qa_tests',
  tech_refinement:    'backlog',
};

// Human-readable labels for stage names (used for revision diffs and events)
export const STAGE_ARTIFACT_LABEL: Record<string, string> = {
  analyst: 'Research Brief',
  pm_prd: 'PRD',
  solution_architect: 'Architecture Document',
  prototype: 'Prototype',
  pm_backlog: 'Backlog',
  gtm_strategy: 'GTM Strategy',
  feature_marketing: 'Feature Marketing Content Pack',
  qa_engineer: 'QA Test Suite',
  tech_refinement: 'Technical Refinement Backlog',
};

// Internal labels used for event messages and logging
export const STAGE_LABELS_INTERNAL: Record<string, string> = {
  analyst:            'Analyst — Sage',
  pm_prd:             'Requirements — Rex',
  solution_architect: 'Architect — Atlas',
  prototype:          'Prototype — Nova',
  pm_backlog:         'Backlog — Pip',
  gtm_strategy:       'GTM Strategy — Quinn',
  feature_marketing:  'Feature Marketing — Milo',
  qa_engineer:        'QA Engineer — Vera',
  critic:             'Critic — Flint',
  curator:            'Curator — Ivy',
  tech_refinement:    'Tech Refinement — Finn, Remi & Cole',
};

// Brief labels used in coordinator stage briefing
export const STAGE_LABELS_BRIEF: Record<string, string> = {
  analyst:            'Research Brief (Sage)',
  pm_prd:             'PRD (Rex)',
  solution_architect: 'Architecture Document (Atlas)',
  prototype:          'Prototype (Nova)',
  pm_backlog:         'Backlog (Pip)',
  gtm_strategy:       'GTM Strategy (Quinn)',
  feature_marketing:  'Feature Marketing Content Pack (Milo)',
  qa_engineer:        'QA Test Suite (Vera)',
  tech_refinement:    'Technical Refinement (Finn, Remi & Cole)',
};

// ── Per-stage output format specifications ────────────────────────────────────

/**
 * Defines the expected output format the Coordinator briefs each specialist with.
 * These are injected into generateStageBrief() so specialists know what to produce.
 */
export const STAGE_OUTPUT_FORMATS: Record<string, { label: string; format: string }> = {
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

  prototype: {
    label: 'Prototype (Nova)',
    format: `Generate an interactive React prototype demonstrating the key user journeys from the PRD and architecture document. The output is a JSON file-map rendered in-browser via Sandpack. The prototype should cover the primary screens and user flows described in the PRD — not implement full backend logic, but show realistic UI interactions and navigation. Focus on fidelity to the approved product design, not on inventing new features.`,
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

  tech_refinement: {
    label: 'Technical Refinement Backlog (Finn, Remi & Cole)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the tech-refinement template injected into your system prompt. This is a technically enriched version of the PM backlog. No prose before or after the JSON block.

Key requirements:
- **Preserve PM scope**: do not remove or change the scope of PM stories. You may add engineering stories (infra, migrations, platform setup) but cannot drop product stories.
- **Platform field required**: every story must have a \`platform\` field — use \`"ios"\`, \`"android"\`, \`"backend"\`, \`"all"\`, or a compound like \`"ios+android"\`.
- **Fully populated \`technical\` section**: name specific files, classes, API endpoints (with method, path, request/response shapes), and DB changes (table name, columns, types). No vague placeholders.
- **Dependency order enforced**: backend/infra stories before frontend/consumer stories within each feature.
- **Split oversized stories**: any story scored 8 that covers multiple platforms must be split into platform-specific stories before output.
- **Risks documented**: every story that carries a technical risk must have a \`risks\` array entry with severity and mitigation. Empty array is allowed when no risks exist.
- **Add missing engineering stories**: if the PM backlog is missing infra setup, DB migrations, or platform permission stories that are prerequisites for product stories, add them.`,
  },

  qa_engineer: {
    label: 'QA Test Suite (Vera)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the QA test suite template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **Trace every FR**: every Functional Requirement from the PRD must appear in \`coverage.by_fr\` and have at least one \`critical\` happy path test and one \`bad_path\` test.
- **Trace every story AC**: every backlog story acceptance criterion (Given/When/Then) must map to at least one test case via \`story_ref\`.
- **Concrete test data**: every test case's \`test_data\` object must contain the exact field names and values to use — no placeholders like "valid input".
- **Automation-first Given/When/Then**: steps must be specific enough to implement in Playwright or Cypress without interpretation.
- **Priority tagging**: mark at minimum one test per FR as \`critical\` and include \`@smoke\` tags on the smallest set of tests that confirm the feature fundamentally works.
- **Coverage summary**: the \`coverage\` object must be accurate — count and categorise every test case you produce.
- **Minimum thresholds**: aim for at least 3× more bad_path + edge_case tests than happy_path tests. Happy paths are the minority — failure modes are not.`,
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

// Per-stage goal sentence templates (used in coordinator briefing)
export function stageGoal(stage: string, goal: string): string {
  const STAGE_GOAL: Record<string, string> = {
    analyst:            `Produce a comprehensive, sourced research brief that gives the PM everything they need to write a PRD for: ${goal}`,
    pm_prd:             `Produce a complete PRD that translates research findings into clear product requirements and success criteria for: ${goal}`,
    solution_architect: `Produce an architecture document that makes all technology decisions needed to build the PRD's requirements for: ${goal}`,
    prototype:          `Produce an interactive React prototype that demonstrates the key user journeys from the PRD and architecture document for: ${goal}`,
    pm_backlog:         `Produce a prioritised backlog of epics, features, and stories covering the full MVP scope defined in the PRD for: ${goal}`,
    gtm_strategy:       `Produce a complete Go-to-Market strategy covering positioning, target segments, messaging, launch timeline, competitive positioning, and success metrics for: ${goal}`,
    feature_marketing:  `Produce a ready-to-use feature marketing content pack with channel copy and internal FAQ based on the approved PRD and GTM strategy for: ${goal}`,
    qa_engineer:        `Produce an exhaustive, automation-ready JSON test suite covering all happy paths, bad paths, and edge cases derived from the PRD and backlog for: ${goal}`,
    tech_refinement:    `Review the PM backlog and produce a technically enriched version: break down oversized cross-platform stories, add implementation details (affected components, API changes, DB schema changes), enforce dependency ordering, and add missing engineering stories for: ${goal}`,
  };
  const outputLabel = STAGE_LABELS_BRIEF[stage] ?? stage;
  return STAGE_GOAL[stage] ?? `Produce the required ${outputLabel} for: ${goal}`;
}

// Explicit boundaries (what this specialist must NOT decide)
export function stageNotDecide(stage: string): string {
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
    prototype:
      'Do not invent new features or requirements not present in the approved PRD. ' +
      'Do not make architecture decisions — follow the architecture document. ' +
      'Focus on demonstrating existing user journeys, not designing new ones.',
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
    qa_engineer:
      'Do not invent features or requirements not present in the PRD or backlog. ' +
      'Do not test implementation internals — test observable user-facing behaviour only. ' +
      'Do not write performance or load tests unless specific SLAs appear in the NFRs. ' +
      'Do not make product decisions; if a requirement is ambiguous, flag it in metadata.notes.',
    tech_refinement:
      'Do not change story titles, personas, goals, or acceptance criteria from the PM backlog. ' +
      'Do not propose new product features or alter product scope. ' +
      'Do not make unresolved architecture decisions — flag them as risks instead. ' +
      'Do not remove PM stories even if they seem technically trivial.',
  };
  return NOT_DECIDE[stage]
    ?? 'Follow the output format and scope defined above. Do not add scope that was not in the workflow goal.';
}
