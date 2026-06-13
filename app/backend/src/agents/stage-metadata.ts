import type { AppMode, AgentType } from '@pap/shared';

// ── Stage → specialist session mapping ────────────────────────────────────────

export const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  epic_feature_planner: { mode: 'epic_features',    agentType: 'epic-feature-planner' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  story_decomposition:  { mode: 'backlog',           agentType: 'story-decomposition' },
  prototype:            { mode: 'prototype',         agentType: 'prototype-builder' },
  pm_backlog:           { mode: 'backlog',           agentType: 'pm' },  // DEPRECATED: Use epic_feature_planner + story_decomposition instead
  gtm_strategy:         { mode: 'gtm',               agentType: 'gtm' },
  feature_marketing:    { mode: 'feature_marketing', agentType: 'marketer' },
  qa_engineer:          { mode: 'qa',                agentType: 'qa-engineer' },
  tech_refinement:      { mode: 'tech_refinement',   agentType: 'tech-refinement' },
};

// Per-stage output token ceiling. Backlog gets more headroom because the JSON
// scales with story count (6 features × 12 stories at max = ~22k tokens).
// All Claude 4.x models support 64k output, so these are safe upper bounds.
export const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:              12_000,
  pm_prd:               12_000,
  epic_feature_planner: 16_000,
  solution_architect:   16_000,
  story_decomposition:  32_000,  // Same as old pm_backlog
  pm_backlog:           32_000,
  gtm_strategy:         12_000,
  prototype:            64_000,
  feature_marketing:    12_000,
  qa_engineer:          64_000,
  tech_refinement:      32_000,
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
export const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:              'analyst',
  pm_prd:               'prd',
  epic_feature_planner: 'epic_features',
  solution_architect:   'architecture',
  story_decomposition:  'backlog',
  pm_backlog:           'backlog',
  gtm_strategy:         'gtm',
  feature_marketing:    'feature_marketing',
  qa_engineer:          'qa_tests',
  tech_refinement:      'backlog',
};

// Human-readable labels for stage names (used for revision diffs and events)
export const STAGE_ARTIFACT_LABEL: Record<string, string> = {
  analyst: 'Research Brief',
  pm_prd: 'PRD',
  epic_feature_planner: 'Epic & Features',
  solution_architect: 'Architecture Document',
  story_decomposition: 'Backlog',
  pm_backlog: 'Backlog (DEPRECATED)',
  gtm_strategy: 'GTM Strategy',
  feature_marketing: 'Feature Marketing Content Pack',
  qa_engineer: 'QA Test Suite',
  tech_refinement: 'Technical Refinement Backlog',
};

// Internal labels used for event messages and logging
export const STAGE_LABELS_INTERNAL: Record<string, string> = {
  analyst:              'Analyst — Sage',
  pm_prd:               'Requirements — Rex',
  epic_feature_planner: 'Epic & Feature Planning — Apex',
  solution_architect:   'Architect — Atlas',
  story_decomposition:  'Story Decomposition — Shard',
  prototype:            'Prototype — Nova',
  pm_backlog:           'Backlog — Pip (DEPRECATED)',
  gtm_strategy:         'GTM Strategy — Quinn',
  feature_marketing:    'Feature Marketing — Milo',
  qa_engineer:          'QA Engineer — Vera',
  critic:               'Critic — Flint',
  curator:              'Curator — Ivy',
  tech_refinement:      'Tech Refinement — Finn, Remi & Cole',
};

// Brief labels used in coordinator stage briefing
export const STAGE_LABELS_BRIEF: Record<string, string> = {
  analyst:              'Research Brief (Sage)',
  pm_prd:               'PRD (Rex)',
  epic_feature_planner: 'Epic & Features (Apex)',
  solution_architect:   'Architecture Document (Atlas)',
  story_decomposition:  'Backlog (Shard)',
  prototype:            'Prototype (Nova)',
  pm_backlog:           'Backlog (Pip)',
  gtm_strategy:         'GTM Strategy (Quinn)',
  feature_marketing:    'Feature Marketing Content Pack (Milo)',
  qa_engineer:          'QA Test Suite (Vera)',
  tech_refinement:      'Technical Refinement (Finn, Remi & Cole)',
};

// ── Per-stage output format specifications ────────────────────────────────────

/**
 * Defines the expected output format the Coordinator briefs each specialist with.
 * These are injected into generateStageBrief() so specialists know what to produce.
 */
export const STAGE_OUTPUT_FORMATS: Record<string, { label: string; format: string }> = {
  analyst: {
    label: 'Research Brief (Sage)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the research output template injected into your system prompt. No prose before or after the JSON block. Use web search to find and verify facts before writing each field.

**CITATION FORMAT — MANDATORY:**
- Every factual claim in string fields must have an inline [N] immediately after it: "Market reached $4.2B [1]."
- Only cite URLs that web search actually returned — never fabricate URLs.
- If no source exists for a claim, write "[Unverified]" instead of a number.
- Every inline [N] must appear in the references array; every references entry must be cited inline.

The output template defines the exact JSON schema. Fill every field. Aim for depth the PM can use directly to write a PRD.`,
  },

  epic_feature_planner: {
    label: 'Epic & Features (Apex)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the epic-features output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **Feature count**: 2-8 features based on scope (small: 2-3, medium: 4-6, large: 6-8)
- **Phase labels required**: Every feature must have \`phase: "MVP" | "Phase 2" | "Phase 3"\`
- **Feature-level acceptance criteria**: 3-5 testable conditions per feature
- **PRD traceability**: Each feature must reference which FRs and user journeys it satisfies
- **Out of scope section**: Explicitly list what's NOT being built or is deferred
- **NO user stories**: You are forbidden from writing "As a user, I want..." stories
- **NO technical tasks**: You are forbidden from referencing implementation details (databases, APIs, repos)

The output template defines the exact JSON structure. Follow it precisely.`,
  },

  pm_prd: {
    label: 'Product Requirements Document (Rex)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the PRD output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **success_metrics**: all three sub-objects required — primary (single metric), secondary (2–3 metrics), counter (1–2 metrics that must not regress). Omitting counter is a quality failure.
- **non_functional_requirements**: include only NFR categories relevant to this initiative; each must have a measurable threshold and priority.
- **functional_requirements**: aim for 10–20 FRs; each states WHAT the system does, not HOW.
- **open_questions**: up to 10 entries ranked by impact.`,
  },

  solution_architect: {
    label: 'Architecture Document (Atlas)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the architecture output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **technology_decisions**: name specific products, versions, and pricing tiers. State alternatives and rationale for every decision. Include only platform keys that are in scope.
- **data_model.entities**: full table with PKs, key fields, relationships, and notes. entity_relationship_diagram must be an ASCII string.
- **api_surface**: every endpoint with method, path, request/response shapes, auth, and idempotency notes.
- **system_diagram**: ASCII service diagram showing all components and data flow.
- **data_flows**: 2–3 walkthroughs for primary user journeys.
- **infrastructure**: hosting topology with per-component cost estimates, deployment steps, and failure modes.
- **epic_features_enriched**: take the epic/features from the prior stage and enrich each feature with target_repos, data_contracts, cross_repo_boundaries, technical_notes, and risks. This field is consumed by the story decomposition agent.

If a context/tech-stack.md file was provided, align all choices with the existing stack and explain deviations. If no tech stack was provided, recommend specific technologies with tradeoffs.`,
  },

  prototype: {
    label: 'Prototype (Nova)',
    format: `Generate an interactive React prototype demonstrating the key user journeys from the PRD and architecture document. The output is a JSON file-map rendered in-browser via Sandpack. The prototype should cover the primary screens and user flows described in the PRD — not implement full backend logic, but show realistic UI interactions and navigation. Focus on fidelity to the approved product design, not on inventing new features.`,
  },

  story_decomposition: {
    label: 'Backlog JSON (Shard)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the backlog output template injected into your system prompt. No prose before or after the JSON block.

You will receive:
- The PRD (for functional requirements and user journeys)
- The tech-enriched epic/features JSON from the Solution Architect (with repo boundaries, data contracts, and technical notes)

Your task: Decompose each feature into 6-8 actionable stories or tasks.

Key requirements:
- **6-8 stories per feature** — this is mandatory, not a guideline
- **User stories** for user-facing changes: "As a [user], I want [action], so that [benefit]"
- **Technical tasks** for infrastructure/enablers with no direct user benefit: imperative title like "Set up Redis pub/sub"
- **Story points** (Fibonacci: 1, 2, 3, 5, 8) — most should be 2-3 points
- **PRD traceability** — every story must reference at least one FR via \`prdRef.functionalRequirements\`
- **Acceptance criteria** in Given/When/Then format
- **Dependency order** — backend/infra before frontend within each feature
- **Preserve epic/feature metadata** — do not modify titles, descriptions, or phase labels from the architect's JSON

The output includes the full epic/features/stories structure. You are enriching features with stories, not creating features.`,
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
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the GTM output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **positioning_statement**: Geoffrey Moore template exactly — "For [segment] who [need], [product] is [category] that [benefit]. Unlike [alternative], [product] [differentiator]."
- **target_segments**: ranked by priority; every entry must have channels and rationale.
- **launch_timeline**: must include Pre-launch, Launch Week, and Post-Launch entries, each with a success_signal.
- **competitive_positioning**: 3–5 we_win_when entries, 3–5 we_lose_when entries, and a response_playbook paragraph.
- **success_metrics**: both leading_indicators (weekly, first 30 days) and lagging_indicators (30/60/90 day checkpoints), each with target and measurement.

Do not propose budget figures. Do not redefine personas or success metrics from the PRD. Do not propose new features.`,
  },

  feature_marketing: {
    label: 'Feature Marketing Content Pack (Milo)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the feature marketing output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **feature_name**: recommended option plus two named alternatives, each with rationale.
- **value_proposition**: ≤20 words, benefit-first — this is the north star all channel copy must trace back to.
- **channel_copy**: all channels required — app_store (≤170 chars plain text), website_hero, email (subject + 3 paragraphs), linkedin (≤150 words ending with a question), twitter (≤280 chars + hashtag), short_form_social (strategy for instagram and tiktok).
- **internal_faq**: exactly 5 Q&A entries. Real sales/support questions with 2–3 sentence answers. No implementation detail.

Do not reference features not in the approved PRD or GTM strategy. Do not suggest product changes.`,
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
- **Trace every story AC**: every backlog story acceptance criterion (Given/When/Then) must map to at least one test case via \`story_ref\`. Use the exact format \`F1.S1\`, \`F2.S3\`, etc. matching the backlog structure (Feature number dot Story number).
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
    analyst:              `Produce a comprehensive, sourced research brief that gives the PM everything they need to write a PRD for: ${goal}`,
    pm_prd:               `Produce a complete PRD that translates research findings into clear product requirements and success criteria for: ${goal}`,
    epic_feature_planner: `Decompose the PRD requirements into a clear epic and feature structure (2-8 features) with feature-level acceptance criteria and phase labels for: ${goal}`,
    solution_architect:   `Produce a cross-platform architecture document covering technology decisions, data model, API surface, repository impact across all repos, and cross-platform contracts — to serve as the technical reference for epic planning and story decomposition for: ${goal}`,
    story_decomposition:  `Decompose each feature from the tech-enriched epic/features JSON into 6-8 actionable stories or technical tasks, with story points, acceptance criteria, and PRD traceability for: ${goal}`,
    prototype:            `Produce an interactive React prototype that demonstrates the key user journeys from the PRD and architecture document for: ${goal}`,
    pm_backlog:           `Produce a prioritised backlog of epics, features, and stories covering the full MVP scope defined in the PRD for: ${goal}`,
    gtm_strategy:         `Produce a complete Go-to-Market strategy covering positioning, target segments, messaging, launch timeline, competitive positioning, and success metrics for: ${goal}`,
    feature_marketing:    `Produce a ready-to-use feature marketing content pack with channel copy and internal FAQ based on the approved PRD and GTM strategy for: ${goal}`,
    qa_engineer:          `Produce an exhaustive, automation-ready JSON test suite covering all happy paths, bad paths, and edge cases derived from the PRD and backlog for: ${goal}`,
    tech_refinement:      `Review the PM backlog and produce a technically enriched version: break down oversized cross-platform stories, add implementation details (affected components, API changes, DB schema changes), enforce dependency ordering, and add missing engineering stories for: ${goal}`,
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
    epic_feature_planner:
      'Do not write user stories (As a user, I want...). Do not write technical tasks or implementation details. ' +
      'Do not choose technologies or architecture patterns — those belong to the architect. ' +
      'Your job ends at feature-level boundaries and acceptance criteria. Story decomposition happens in the next stage.',
    solution_architect:
      'Do not redefine personas, success metrics, or product scope — those are fixed in the approved PRD. ' +
      'Do not create new requirements; if something is missing from the PRD, flag it as a gap rather than adding scope silently. ' +
      'Do not write user stories or create epics — the epic planner reads this document next. ' +
      'Do not output JSON structures or attempt to enrich epics that do not exist yet.',
    story_decomposition:
      'Do not modify epic or feature titles, descriptions, or phase labels from the architect\'s JSON — those are fixed. ' +
      'Do not invent requirements not present in the PRD. ' +
      'Do not make unresolved architecture decisions — if a technical choice is unclear, reference the architect\'s notes or flag as a risk. ' +
      'Do not use effort scores outside the Fibonacci scale (1, 2, 3, 5, 8). ' +
      'Do not output fewer than 6 or more than 8 stories per feature.',
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
