import { STAGE_PERSONAS, stagePersonaLabel, type AppMode, type AgentType } from '@pap/shared';

// ── Stage → specialist session mapping ────────────────────────────────────────

export const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  epic_feature_planner: { mode: 'epic_features',    agentType: 'epic-feature-planner' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  prototype:            { mode: 'prototype',         agentType: 'prototype-builder' },
  figma_design:         { mode: 'figma_design',      agentType: 'figma-designer' },
};

// Per-stage output token ceiling. Backlog gets more headroom because the JSON
// scales with story count (6 features × 12 stories at max = ~22k tokens).
// QA test suites: ~8 stories × 3 test cases × 500 tokens = ~12k needed.
// All Claude 4.x models support 64k output, so these are safe upper bounds.
export const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:              12_000,
  pm_prd:               12_000,
  epic_feature_planner: 16_000,
  solution_architect:   32_000,  // heaviest stage: full data model/API surface/infra plus epic_features_enriched for every feature
  story_decomposition:  16_000,  // single feature backlog (epic + ~8 stories with prd_ref/technical detail)
  qa_engineer:          14_000,  // 10-15 test cases per feature with full test detail
  prototype:            64_000,
  figma_design:         16_000,
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
export const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:              'analyst',
  pm_prd:               'prd',
  epic_feature_planner: 'epic_features',
  solution_architect:   'architecture',
  figma_design:         'figma_design',
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
  qa_engineer: 'QA Tests',
  curator: 'Context Update',
  tech_refinement: 'Tech Refinement',
  critic: 'Critic Review',
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
const BRIEF_STAGES = ['analyst', 'pm_prd', 'epic_feature_planner', 'solution_architect', 'prototype', 'figma_design'] as const;
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
- **Phases structure**: Output \`phases[]\` — one entry per deliverable phase (MVP, Phase 1, Phase 2, Phase 3). Features are nested under each phase, not in a top-level features array.
- **Max 5 features per phase**: If a phase needs more, create a new phase instead.
- **Max 4 phases**: MVP + up to 3 post-MVP phases. Defer anything beyond to outOfScope.
- **Feature scope discipline**: Every feature must be decomposable into ≤8 user stories. Wide features must be split before output.
- **Phase deliverable**: Each phase must have a \`deliverable\` field — one sentence on what ships independently in that phase.
- **Phase labels**: Exactly \`"MVP"\`, \`"Phase 1"\`, \`"Phase 2"\`, \`"Phase 3"\` — no variations.
- **Feature-level acceptance criteria**: 3-5 testable conditions per feature (outcome-focused, not story-level)
- **PRD traceability**: Each feature must reference which FRs and user journeys it satisfies
- **Out of scope section**: Explicitly list what's NOT being built or is deferred
- **Dependency tagging**: Every feature must include a \`dependsOn\` array — exact titles of features it cannot start before (empty array if independent). Default to independent; only tag a dependency when truly blocking. No circular dependencies.
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

This stage is intentionally scoped down for reliability right now — fewer sections, written concisely. More sections (diagrams, data-flow walkthroughs, deployment/failure-mode detail) will be reintroduced once this smaller scope is solid. Do not add sections beyond the template.

Key requirements:
- **technology_decisions**: name specific products, versions, and pricing tiers. State alternatives and rationale for every decision, briefly. Include only platform keys that are in scope.
- **data_model.entities**: table with PKs, key fields, relationships, and notes. entity_relationship_diagram must be an ASCII string.
- **api_surface**: every endpoint with method, path, request/response shapes, auth, and idempotency notes — keep each note to one line.
- **infrastructure**: hosting topology and per-component cost estimates only — no deployment pipeline or failure-mode table for now.
- **epic_features_enriched**: take the epic/phases/features from the prior stage and enrich each feature with target_repos and a short technical_notes line. Preserve the \`phases[]\` structure exactly — do not flatten. This field is consumed by the story decomposition agent.

If a context/tech-stack.md file was provided, align all choices with the existing stack and explain deviations. If no tech stack was provided, recommend specific technologies with tradeoffs.`,
  },

  prototype: {
    label: 'Prototype (Nova)',
    format: `Generate a low-fidelity wireframe prototype of ONLY the screen(s) directly affected by this change — typically the main screen plus a before/after pair if the change involves a transition or state change. Do not build out the full app or unrelated user journeys. The output is a JSON file-map rendered in-browser via Sandpack, built from a small set of generic, reusable components (not the brand design system) so reviewers focus on layout and flow rather than visual polish. Keep icons and visuals deliberately plain — this stage is about layout and user flow, not detail.`,
  },

  figma_design: {
    label: 'Figma Mockups (Luma)',
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
    figma_design: 'Luma',
  };
  const name = actor[stage];
  if (stage === 'prototype' || stage === 'figma_design') return `${name} is generating ${subject}.`;
  return `${name ?? 'The coordinator'} is writing ${subject}.`;
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
