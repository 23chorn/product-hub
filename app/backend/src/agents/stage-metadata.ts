import type { AppMode, AgentType } from '@pap/shared';

// ── Stage → specialist session mapping ────────────────────────────────────────

export const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  prototype:            { mode: 'prototype',          agentType: 'analyst' },
  pm_backlog:           { mode: 'backlog',           agentType: 'pm' },
  gtm_strategy:         { mode: 'gtm',               agentType: 'gtm' },
  feature_marketing:    { mode: 'feature_marketing', agentType: 'marketer' },
  critic:               { mode: 'analyst',           agentType: 'analyst' },
  curator:              { mode: 'analyst',           agentType: 'analyst' },
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
  feature_marketing:  12_000,
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
  critic:             'Critic — Flint',
  curator:            'Curator — Ivy',
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
  };
  return NOT_DECIDE[stage]
    ?? 'Follow the output format and scope defined above. Do not add scope that was not in the workflow goal.';
}
