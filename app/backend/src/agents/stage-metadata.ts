import type { AppMode, AgentType } from '@pap/shared';

// ── Stage → specialist session mapping ────────────────────────────────────────

export const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  epic_feature_planner: { mode: 'epic_features',    agentType: 'epic-feature-planner' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  prototype:            { mode: 'prototype',         agentType: 'prototype-builder' },
};

// Per-stage output token ceiling. Backlog gets more headroom because the JSON
// scales with story count (6 features × 12 stories at max = ~22k tokens).
// All Claude 4.x models support 64k output, so these are safe upper bounds.
export const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:              12_000,
  pm_prd:               12_000,
  epic_feature_planner: 16_000,
  solution_architect:   16_000,
  prototype:            64_000,
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
export const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:              'analyst',
  pm_prd:               'prd',
  epic_feature_planner: 'epic_features',
  solution_architect:   'architecture',
};

// Human-readable labels for stage names (used for revision diffs and events)
export const STAGE_ARTIFACT_LABEL: Record<string, string> = {
  analyst: 'Research Brief',
  pm_prd: 'PRD',
  epic_feature_planner: 'Epic & Features',
  solution_architect: 'Architecture Document',
};

// Internal labels used for event messages and logging
export const STAGE_LABELS_INTERNAL: Record<string, string> = {
  analyst:              'Analyst — Sage',
  pm_prd:               'Requirements — Rex',
  epic_feature_planner: 'Epic & Feature Planning — Apex',
  solution_architect:   'Architect — Atlas',
  prototype:            'Prototype — Nova',
  critic:               'Critic — Flint',
  curator:              'Curator — Ivy',
};

// Brief labels used in coordinator stage briefing
export const STAGE_LABELS_BRIEF: Record<string, string> = {
  analyst:              'Research Brief (Sage)',
  pm_prd:               'PRD (Rex)',
  epic_feature_planner: 'Epic & Features (Apex)',
  solution_architect:   'Architecture Document (Atlas)',
  prototype:            'Prototype (Nova)',
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
    prototype:            `Produce an interactive React prototype that demonstrates the key user journeys from the PRD and architecture document for: ${goal}`,
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
    prototype: 'the prototype screens and file map',
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
  };
  const name = actor[stage];
  if (stage === 'prototype') return `${name} is generating ${subject}.`;
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

export function stageProgressHeartbeat(stage: string, elapsedSec: number, writtenChars: number): string {
  const target = stageProgressTarget(stage);
  if (stage === 'prototype') {
    const fileCount = Math.max(1, Math.round(writtenChars / 1000));
    return `Still generating ${target} — ${elapsedSec}s elapsed, ${fileCount}k chars drafted`;
  }
  return `Still writing ${target} — ${elapsedSec}s elapsed, ${Math.round(writtenChars / 1000)}k chars drafted`;
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
  };
  return NOT_DECIDE[stage]
    ?? 'Follow the output format and scope defined above. Do not add scope that was not in the workflow goal.';
}
