import { STAGE_PERSONAS, stagePersonaLabel, type AppMode, type AgentType } from '@pap/shared';

// ── Stage → specialist session mapping ────────────────────────────────────────

export const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  epic_feature_planner: { mode: 'epic_features',    agentType: 'epic-feature-planner' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  prototype:            { mode: 'prototype',         agentType: 'prototype-builder' },
  figma_design:         { mode: 'figma_design',      agentType: 'figma-designer' },
  api_spec:             { mode: 'architecture',      agentType: 'api-spec-designer' },
  epic_qa:              { mode: 'qa',               agentType: 'qa-engineer' },
};

// Per-stage output token ceiling. Backlog gets more headroom because the JSON
// scales with story count (6 features × 12 stories at max = ~22k tokens).
// QA test suites: ~8 stories × 3 test cases × 500 tokens = ~12k needed.
// All Claude 4.x models support 64k output, so these are safe upper bounds.
export const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:              12_000,
  pm_prd:               12_000,
  epic_feature_planner: 16_000,
  solution_architect:   20_000,  // data model, API surface, infra, repo impact, new dependencies, open questions
  story_decomposition:  24_000,  // single feature backlog — up to the validator's 12-story limit with full prd_ref/technical detail; 16k was observed hitting the ceiling on a dense feature
  qa_engineer:          14_000,  // 10-15 test cases per feature with full test detail
  epic_qa:              28_000,  // cross-epic suite: all features × TC-E-NNN cases; more context than per-feature
  prototype:            64_000,
  figma_design:         16_000,
  api_spec:             12_000,  // 10-20 endpoints with schemas; full OpenAPI 3.0 JSON
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
export const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:              'analyst',
  pm_prd:               'prd',
  epic_feature_planner: 'epic_features',
  solution_architect:   'architecture',
  figma_design:         'figma_design',
  api_spec:             'api_spec',
};

// Human-readable labels for stage names (used for revision diffs and events).
// Also the canonical source for Slack notification labels (see slack-notifier.ts)
// — add new stages here so notifications don't fall back to the raw stage key.
export const STAGE_ARTIFACT_LABEL: Record<string, string> = {
  analyst: 'Research Brief',
  pm_prd: 'PRD',
  epic_feature_planner: 'Epic & Features',
  solution_architect: 'Architecture Document',
  prototype: 'Prototype',
  figma_design: 'Figma Mockups',
  story_decomposition: 'Stories',
  backlog_merge: 'Backlog',
  epic_qa: 'Epic QA Tests',
  qa_engineer: 'QA Tests',
  curator: 'Context Update',
  tech_refinement: 'Tech Refinement',
  critic: 'Critic Review',
  api_spec: 'API Contract',
};

/**
 * Resolve a checkpoint's stage to the artifact label used in approval/rejection/revision
 * event messages (e.g. "Research Brief approved by Chris"). Handles the dynamic per-feature
 * stages (story_decomposition_F3, story_decomposition_F3_qa) that have no static entry above.
 */
export function checkpointArtifactLabel(stage: string): string {
  if (stage.endsWith('_qa')) return 'QA Tests';
  if (/^story_decomposition_F\d+$/.test(stage)) return 'Stories';
  return STAGE_ARTIFACT_LABEL[stage] ?? stage;
}

// Internal labels used for event messages and logging.
// Derived from the canonical STAGE_PERSONAS map (@pap/shared) so this stays in
// sync with the frontend's stage labels instead of keeping its own copy.
export const STAGE_LABELS_INTERNAL: Record<string, string> = Object.fromEntries(
  Object.keys(STAGE_PERSONAS).map(stage => [stage, stagePersonaLabel(stage)!])
);

// Brief labels used in coordinator stage briefing — artifact noun + persona first name.
const BRIEF_STAGES = ['analyst', 'pm_prd', 'epic_feature_planner', 'solution_architect', 'prototype', 'figma_design', 'api_spec'] as const;
export const STAGE_LABELS_BRIEF: Record<string, string> = Object.fromEntries(
  BRIEF_STAGES.map(stage => [stage, `${STAGE_ARTIFACT_LABEL[stage]} (${STAGE_PERSONAS[stage].persona})`])
);

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
- **Phases structure**: Output \`phases[]\` — one entry per deliverable phase (MVP, Phase 2, Phase 3, Phase 4). Features are nested under each phase, not in a top-level features array.
- **Max 5 features per phase**: If a phase needs more, create a new phase instead.
- **Max 4 phases**: MVP + up to 3 post-MVP phases. Anything beyond is out of scope.
- **Feature scope discipline**: Every feature must be decomposable into ≤8 user stories. Wide features must be split before output.
- **Phase labels**: Exactly \`"MVP"\`, \`"Phase 2"\`, \`"Phase 3"\`, \`"Phase 4"\` — no variations (MVP is the first phase, so numbering continues from 2).
- **Feature-level acceptance criteria**: 3-5 testable conditions per feature (outcome-focused, not story-level)
- **PRD traceability**: Each feature must reference which FRs and user journeys it satisfies
- **Dependency tagging**: Every feature must include a \`dependsOn\` array — exact titles of features it cannot start before (empty array if independent). Default to independent; only tag a dependency when truly blocking. No circular dependencies.
- **NO user stories**: You are forbidden from writing "As a user, I want..." stories
- **NO technical tasks**: You are forbidden from referencing implementation details (databases, APIs, repos)

The output template defines the exact JSON structure. Follow it precisely.`,
  },

  pm_prd: {
    label: 'Product Requirements Document (Rex)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the PRD output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **success_metrics**: primary (single metric) and secondary (2–3 metrics). No counter metrics.
- **non_functional_requirements**: 3 max — only the highest-priority thresholds engineering must design to (latency SLA, retention requirement, scalability target).
- **functional_requirements**: aim for 10–20 FRs; each states WHAT the system does, not HOW.
- **open_questions**: up to 10 entries ranked by impact.`,
  },

  solution_architect: {
    label: 'Architecture Document (Atlas)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the architecture output template injected into your system prompt. No prose before or after the JSON block.

This stage is intentionally scoped down for reliability right now — fewer sections, written concisely. More sections (diagrams, data-flow walkthroughs, deployment/failure-mode detail) will be reintroduced once this smaller scope is solid. Do not add sections beyond the template.

Key requirements:
- **technology_decisions**: name specific products for each decision area; include only platform keys that are in scope. No rationale prose — decision and choice only.
- **data_model.entities**: table with PKs, key fields, relationships, and notes. entity_relationship_diagram must be an ASCII string.
- **api_surface**: every endpoint with method, path, request/response shapes, auth, and idempotency notes — keep each note to one line.
- **new_dependencies**: name, type, and not_solvable_with_existing_stack_because only. No alternatives evaluated, no cost breakdown.

Hosting infrastructure, deployment pipelines, cost estimates, and failure-mode tables are out of scope for this document.

If a context/tech-stack.md file was provided, align all choices with the existing stack and explain deviations. If no tech stack was provided, recommend specific technologies with tradeoffs.`,
  },

  prototype: {
    label: 'Prototype (Nova)',
    format: `Generate a low-fidelity wireframe prototype of ONLY the screen(s) directly affected by this change — typically the main screen plus a before/after pair if the change involves a transition or state change. Do not build out the full app or unrelated user journeys. The output is a JSON file-map rendered in-browser via Sandpack, built from a small set of generic, reusable components (not the brand design system) so reviewers focus on layout and flow rather than visual polish. Keep icons and visuals deliberately plain — this stage is about layout and user flow, not detail.`,
  },

  figma_design: {
    label: 'Figma Mockups (Bora)',
    format: `Produce a concise JSON design brief a human designer can act on directly — not a full design spec.

Key requirements:
- **screens_created**: 3–8 screens covering the primary PRD user journeys. Each screen must reference the PRD journey it satisfies, give the designer the few layout notes that matter, and describe interactions that link to other screens.
- **design_gaps**: Flag any component or pattern these screens need that doesn't exist in the design system yet. Empty array if none.
- **figma_write_status**: Always "planned" — later steps stamp this automatically once the brief is posted or a designer marks it reviewed.
- **navigation_flow**: ASCII diagram showing screen-to-screen navigation.
- **notes**: One or two sentences on anything the designer needs to resolve themselves.

Follow the output template injected into your system prompt for the exact JSON schema.`,
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

  api_spec: {
    label: 'API Contract (Kira)',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block following the api-spec output template injected into your system prompt. No prose before or after the JSON block.

Key requirements:
- **FR traceability**: Only define endpoints that satisfy a named PRD functional requirement. State the FR-ID in every endpoint's description field (e.g. "Satisfies FR-05: User can filter task list by status.").
- **Schema derivation**: All component schemas must be derived from the data model entities in the architecture brief. Use exact entity names from the architecture as schema names. Do not invent entity shapes.
- **Response shapes from Figma**: Response schemas must include only the fields visible in the Figma screens for that flow — no speculative or "might be useful" fields.
- **Existing API conventions**: If live swagger docs are provided, match their auth scheme, server base path, error response format, and pagination convention exactly. Replace the template defaults with the real patterns from the existing API.
- **Shared error components**: All endpoints must reference error responses via $ref (e.g. $ref: '#/components/responses/Unauthorized'). Never repeat error schemas inline. Minimum: 401 on every authenticated endpoint; 404 on all resource lookups; 400 on all write operations.
- **No speculative endpoints**: If an endpoint cannot be traced to a PRD functional requirement, it does not belong in this spec.
- **JSON validity**: All string values must be valid JSON strings with no literal newline characters.`,
  },
};

// Per-stage goal sentence templates (used in coordinator briefing)
export function stageGoal(stage: string, goal: string): string {
  const STAGE_GOAL: Record<string, string> = {
    analyst:              `Produce a comprehensive, sourced research brief that gives the PM everything they need to write a PRD for: ${goal}`,
    pm_prd:               `Produce a complete PRD that translates research findings into clear product requirements and success criteria for: ${goal}`,
    epic_feature_planner: `Decompose the PRD requirements into a clear epic and feature structure (2-8 features) with feature-level acceptance criteria and phase labels for: ${goal}`,
    solution_architect:   `Produce a cross-platform architecture document covering technology decisions, data model, API surface, repository impact across all repos, and cross-platform contracts — to serve as the technical reference for epic planning and story decomposition for: ${goal}`,
    prototype:            `Produce a focused, low-fidelity wireframe of the screen(s) where this change occurs (plus before/after states if there's a transition), built from generic reusable components rather than branded visuals, for: ${goal}`,
    figma_design:         `Produce a concise screen-by-screen design brief a human designer can use to build the mockups in Figma for: ${goal}`,
    api_spec:             `Produce a valid OpenAPI 3.0 contract derived from the approved architecture data model and PRD functional requirements, aligned with existing API conventions, for: ${goal}`,
  };
  const outputLabel = STAGE_LABELS_BRIEF[stage] ?? stage;
  return STAGE_GOAL[stage] ?? `Produce the required ${outputLabel} for: ${goal}`;
}

export function stageProgressTarget(stage: string): string {
  const target: Record<string, string> = {
    analyst: 'the Research Brief',
    pm_prd: 'the PRD',
    epic_feature_planner: 'the epic and feature breakdown',
    solution_architect: 'the Architecture Document',
    prototype: 'the prototype wireframe and file map',
    figma_design: 'the Figma mockup plan',
    api_spec: 'the API Contract',
  };
  return target[stage] ?? `the ${STAGE_ARTIFACT_LABEL[stage] ?? stage}`;
}

export function stageProgressWorking(stage: string): string {
  const subject = stageProgressTarget(stage);
  const actor: Record<string, string> = {
    analyst: 'Sage',
    pm_prd: 'Rex',
    epic_feature_planner: 'Apex',
    solution_architect: 'Atlas',
    prototype: 'Nova',
    figma_design: 'Bora',
    api_spec: 'Kira',
  };
  const name = actor[stage];
  if (stage === 'prototype' || stage === 'figma_design') return `${name} is generating ${subject}.`;
  return `${name ?? 'The coordinator'} is writing ${subject}.`;
}

// "Stage started" narration shown the moment a specialist session is kicked off — richer
// than stageProgressWorking() (which only fires during demo playback / manual retry).
// One source of truth so a fresh stage launch and a workflow restart announce themselves
// identically — see kickoffMemberStage() in workflow-router.ts and restartWorkflow() in
// workflow-mutations.ts.
const STAGE_STARTED_NARRATION: Record<string, string> = {
  analyst:              'Sage is writing the Research Brief from market evidence and source notes.',
  pm_prd:               'Rex is writing the PRD sections, success metrics, and open questions.',
  epic_feature_planner: 'Apex is writing the epic and feature breakdown from the PRD.',
  solution_architect:   'Atlas is writing the architecture sections, API surface, and data model.',
  prototype:            'Nova is generating the prototype wireframe and file map from the workflow artifacts.',
  figma_design:         'Bora is generating the Figma mockup plan from the workflow artifacts.',
  api_spec:             'Kira is writing the API Contract from the approved architecture data model and PRD functional requirements.',
  epic_qa:              'Vera is synthesising the epic-level QA test suite across all approved features.',
};

export function stageStartedNarration(stage: string): string {
  const featureStageMatch = stage.match(/^story_decomposition_F(\d+)$/);
  return STAGE_STARTED_NARRATION[stage]
    ?? (featureStageMatch ? `Starting refinement for Feature ${featureStageMatch[1]}...` : `Starting ${stage}...`);
}

export function stageProgressSection(stage: string, section: string, index?: number): string {
  const target = stageProgressTarget(stage);
  if (stage === 'prototype') {
    return `Writing ${section} for ${target}...`;
  }
  if (index !== undefined) {
    return `Writing section ${index}: ${section} in ${target}...`;
  }
  return `Writing ${section} in ${target}...`;
}

/**
 * Build a periodic "still working" progress line from an elapsed time + character count.
 * Shared by every long-running streaming loop (single-specialist and multi-agent) so a
 * stage proves it's alive between structural progress events (section/phase changes).
 *
 * Below ~200 chars the model has likely produced no visible text yet (tool calls,
 * web search, extended thinking) — reporting "0k chars drafted" there reads as stuck
 * even though real work is happening, so say so honestly instead of printing a zero.
 */
export function progressHeartbeatLine(label: string, elapsedSec: number, writtenChars: number): string {
  if (writtenChars < 200) {
    return `${label} — ${elapsedSec}s elapsed, preparing before drafting begins...`;
  }
  const kChars = Math.max(1, Math.round(writtenChars / 1000));
  return `${label} — ${elapsedSec}s elapsed, ${kChars}k chars drafted`;
}

/**
 * Drain a single LLM text stream into one string, firing `onHeartbeat` at most once
 * per `intervalMs` while it's still streaming. Consolidates the identical
 * accumulate-and-throttle loop used by the single-stream synthesis and revision paths
 * (multi-agent-refinement.ts, feature-stage-runner.ts). The caller decides what a
 * heartbeat does (insertEvent, touchWorkflow, etc.) — this only owns the timing.
 *
 * Not used by the multiplexed parallel-phase loop (runPhaseInParallel), whose heartbeat
 * is shared across several concurrent streams, nor by runAutonomousStage's loop, which
 * interleaves section-detection progress with the heartbeat.
 */
export async function collectStreamWithHeartbeat(
  stream: AsyncIterable<string>,
  onHeartbeat: (elapsedSec: number, writtenChars: number) => void,
  intervalMs = 12_000
): Promise<string> {
  let full = '';
  const start = Date.now();
  let lastHeartbeat = start;
  for await (const chunk of stream) {
    full += chunk;
    const now = Date.now();
    if (now - lastHeartbeat > intervalMs) {
      lastHeartbeat = now;
      onHeartbeat(Math.round((now - start) / 1000), full.length);
    }
  }
  return full;
}

export function stageProgressHeartbeat(stage: string, elapsedSec: number, writtenChars: number): string {
  const target = stageProgressTarget(stage);
  const verb = stage === 'prototype' ? 'Still generating' : 'Still writing';
  return progressHeartbeatLine(`${verb} ${target}`, elapsedSec, writtenChars);
}

export function stageProgressBriefing(stage: string): string {
  return `Coordinator is briefing the team on ${stageProgressTarget(stage)}...`;
}

export function stageProgressBriefReceived(stage: string): string {
  return `Brief received. Work is underway on ${stageProgressTarget(stage)}...`;
}

export function stageProgressReview(stage: string): string {
  return `Running quality review on ${stageProgressTarget(stage)}...`;
}

export function stageProgressReviewComplete(stage: string): string {
  return `Quality review complete for ${stageProgressTarget(stage)}. Processing results...`;
}

export function stageProgressRevision(stage: string): string {
  return `Auto-revising ${stageProgressTarget(stage)} based on quality review feedback...`;
}

// ── Tool definitions per stage ─────────────────────────────────────────────────

interface StageToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Tools advertised to the LLM for each stage — the schemas tool-registry.ts's handlers implement. */
export const STAGE_TOOL_DEFINITIONS: Record<string, StageToolDefinition[]> = {
  analyst: [
    {
      name: 'validate_analyst_json',
      description: 'Validate your research brief JSON before returning it. Checks all required top-level fields, market_size sub-fields, target_users/competitive_landscape/constraints_and_risks arrays, inline [N] citations against the references list, and flags placeholder URLs. Call after completing the full JSON object.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete research brief JSON string (may be wrapped in a ```json code block)' } }, required: ['json'] },
    },
  ],

  pm_prd: [
    {
      name: 'validate_prd_json',
      description: 'Validate your PRD JSON before returning it. Checks personas, user journeys, success_metrics (primary/secondary), non_functional_requirements (max 3), functional requirement count (10–20), out_of_scope, and open_questions. Call after completing the full JSON object.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete PRD JSON string (may be wrapped in a ```json code block)' } }, required: ['json'] },
    },
  ],

  epic_feature_planner: [
    {
      name: 'validate_epic_features_json',
      description: 'Validate your epic and feature plan JSON before returning it. Checks: epic header fields (title ≤6 words, description, prdLink); phases[] structure (required — features must be nested under phases, not at root level); phase labels (exactly "MVP", "Phase 2", "Phase 3", "Phase 4"); max 5 features per phase; max 4 phases; per-feature checks: acceptance criteria (3–5, no user-story format), prdRef.functionalRequirements (FR-XX format), stories must be empty []; TBD flags. Call after completing the full JSON object.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete epic & features JSON string (may be wrapped in a ```json code block)' } }, required: ['json'] },
    },
  ],

  solution_architect: [
    {
      name: 'validate_architecture_json',
      description: 'Validate your architecture JSON before returning it. Checks technology_decisions (decision and choice fields only), new_dependencies structure, data_model entities and ERD, api_surface endpoints, repository_impact, and open_questions. Also scans for unresolved TBD decisions. Call after completing the full JSON object.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete architecture JSON string (may be wrapped in a ```json code block)' } }, required: ['json'] },
    },
  ],

  qa_engineer: [
    {
      name: 'validate_qa_tests_json',
      description: 'Validate your QA test suite JSON before returning it. Checks test case IDs (TC-F?-??? format), uniqueness, type (happy_path/negative/edge/boundary/security/performance), priority, Given/When/Then scenario completeness, tag validity (@smoke/@regression/@negative/@edge/@security/@performance), vague Then clauses, that at least one critical test is @smoke tagged, and that ≥20% of tests are negative paths. Call after completing the full JSON.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete QA test suite JSON string (may be wrapped in a ```json code block)' } }, required: ['json'] },
    },
  ],

  story_decomposition: [
    {
      name: 'validate_backlog_json',
      description: 'Validate your backlog JSON structure before returning it. Checks story_id format (F?.S?), as_a/i_want/so_that fields, Given/When/Then acceptance criteria (2–5 per story), technical_acceptance_criteria, platform tag (single stream per story: backend | web | ios | android), PRD traceability, and dependency references. Call after drafting.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete backlog JSON string to validate' } }, required: ['json'] },
    },
  ],
};

// ── Airtable roadmap status sync ──────────────────────────────────────────────

// Maps a completed stage to the corresponding Airtable "Status" select value.
// Pushed back to the originating Airtable record when that stage's checkpoint
// is approved. Stages not listed here (critic, prototype, figma_design) don't
// have a corresponding pipeline status and are left unchanged.
const STAGE_AIRTABLE_STATUS: Record<string, string> = {
  analyst:              'Researching',
  pm_prd:               'Scoping',
  epic_feature_planner: 'Refining',
  solution_architect:   'Architecting',
  story_decomposition:  'Refining',
};

export function airtableStatusForStage(stage: string): string | null {
  if (stage.startsWith('story_decomposition_F')) return STAGE_AIRTABLE_STATUS.story_decomposition;
  return STAGE_AIRTABLE_STATUS[stage] ?? null;
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
    prototype:
      'Do not invent new features or requirements not present in the approved PRD. ' +
      'Do not make architecture decisions — follow the architecture document. ' +
      'Focus on demonstrating existing user journeys, not designing new ones.',
    figma_design:
      'Do not invent new features, screens, or user journeys not present in the approved PRD. ' +
      'Do not modify the design system file — only read from it. ' +
      'Do not choose technology or architecture — those are fixed in prior stages. ' +
      'Do not write new design tokens; flag missing ones as design_gaps instead.',
  };
  return NOT_DECIDE[stage]
    ?? 'Follow the output format and scope defined above. Do not add scope that was not in the workflow goal.';
}
