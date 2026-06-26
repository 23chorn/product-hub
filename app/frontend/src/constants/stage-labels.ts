import { STAGE_PERSONAS, stagePersonaLabel } from '@pap/shared';

// Derived from the canonical STAGE_PERSONAS map (@pap/shared) so this stays in
// sync with the backend's event-log labels instead of keeping its own copy.
const STAGE_LABELS_BASE: Record<string, string> = {
  ...Object.fromEntries(
    Object.keys(STAGE_PERSONAS).map(stage => [stage, stagePersonaLabel(stage)!])
  ),
  // System stages with no dedicated specialist persona
  backlog_merge: 'Backlog Merge',
};

// Proxy to handle dynamic feature stages (story_decomposition_F1, F2, etc.)
// Each story_decomposition_F* stage runs a multi-agent collaborative refinement with platform-filtered participants
export const STAGE_LABELS: Record<string, string> = new Proxy(STAGE_LABELS_BASE, {
  get(target, prop: string) {
    // Map story_decomposition_F1_qa → "QA Tests — F1"
    if (prop.endsWith('_qa')) {
      const baseStage = prop.slice(0, -3);
      const match = baseStage.match(/story_decomposition_F(\d+)$/);
      if (match) {
        return `QA Tests — F${match[1]}`;
      }
      return 'QA Tests';
    }
    // Map qa_engineer_F1, F2, F3, etc. → "QA Tests — F1", "QA Tests — F2", etc.
    if (prop.startsWith('qa_engineer_F')) {
      const match = prop.match(/qa_engineer_F(\d+)$/);
      if (match) {
        return `QA Tests — F${match[1]}`;
      }
      return target.qa_engineer;
    }
    // Map story_decomposition_F1, F2, F3, etc. → "Refinement - F1", "Refinement - F2", etc.
    if (prop.startsWith('story_decomposition_F')) {
      const match = prop.match(/story_decomposition_F(\d+)$/);
      if (match) {
        return `Refinement — F${match[1]}`;
      }
      return target.story_decomposition;
    }
    return target[prop];
  }
});

// Friendly titles keyed by artifact *type* (the `type` field on an artifact), as
// opposed to STAGE_LABELS which is keyed by stage name. The artifact viewer header
// has only the type, and most types (qa_tests, prd, epic_features, architecture,
// backlog) don't match a stage key — so without this they showed the raw backend
// identifier. Mirrors the backend STAGE_ARTIFACT_LABEL document names.
const ARTIFACT_TYPE_LABELS_BASE: Record<string, string> = {
  analyst:       'Research Brief',
  research:      'Research Brief', // session-mode alias
  prd:           'PRD',
  epic_features: 'Epic & Features',
  architecture:  'Architecture Document',
  backlog:       'Backlog',
  qa_tests:      'QA Tests',
  qa:            'QA Tests',       // session-mode alias
  prototype:     'Prototype',
  figma_design:  'Figma Mockups',
  critic_review: 'Critic Review',
  document:      'Document',
};

// Proxy to handle per-feature backlog artifacts (backlog_F1, backlog_F2, ...).
export const ARTIFACT_TYPE_LABELS: Record<string, string> = new Proxy(ARTIFACT_TYPE_LABELS_BASE, {
  get(target, prop: string) {
    const match = prop.match(/^backlog_F(\d+)$/);
    if (match) return `Backlog — F${match[1]}`;
    return target[prop];
  },
});

// Stages available for user toggle at workflow start (order matters).
// `label` uses the canonical STAGE_PERSONAS text where it fits; two entries below
// (epic_feature_planner, story_decomposition) use deliberately shorter copy for
// the toggle UI and are kept as explicit overrides rather than derived.
export const TOGGLEABLE_STAGES: Array<{ key: string; label: string; short: string }> = [
  { key: 'analyst',              label: stagePersonaLabel('analyst')!,             short: 'Sage · Analyst' },
  { key: 'pm_prd',               label: stagePersonaLabel('pm_prd')!,              short: 'Rex · PM' },
  { key: 'prototype',            label: stagePersonaLabel('prototype')!,           short: 'Nova · Prototype' },
  { key: 'figma_design',         label: stagePersonaLabel('figma_design')!,        short: 'Luma · Figma' },
  { key: 'solution_architect',   label: stagePersonaLabel('solution_architect')!,  short: 'Atlas · Architect' },
  { key: 'epic_feature_planner', label: 'Epic & Features — Apex',       short: 'Apex · Features' },
  { key: 'story_decomposition',  label: 'Shard - Product Owner',              short: 'Multi-Agent · Refinement' },
  { key: 'curator',              label: stagePersonaLabel('curator')!,             short: 'Ivy · Curator' },
];

// Workflow presets — single source of truth for stage sequences
export const WORKFLOW_PRESETS: {
  small: Array<{ key: string; label: string; short: string }>;
  full: Array<{ key: string; label: string; short: string }>;
} = {
  small: [
    { key: 'pm_prd',               label: 'PRD',             short: 'Rex · PM' },
    { key: 'solution_architect',   label: 'Architecture',    short: 'Atlas · Architect' },
    { key: 'epic_feature_planner', label: 'Epic & Features', short: 'Apex · Features' },
    { key: 'story_decomposition',  label: 'Refinement',      short: 'Multi-Agent · Refinement' },
  ],
  full: TOGGLEABLE_STAGES, // Full pipeline uses all toggleable stages
};

// Extract just the keys for API calls
export const SMALL_WORKFLOW_KEYS = WORKFLOW_PRESETS.small.map(s => s.key);
export const FULL_WORKFLOW_KEYS = WORKFLOW_PRESETS.full.map(s => s.key);

const STAGE_SHORT_LABELS_BASE: Record<string, string> = {
  analyst: 'Research',
  pm_prd: 'PRD',
  epic_feature_planner: 'Features',
  solution_architect: 'Arch',
  story_decomposition: 'Stories',
  qa_engineer: 'QA Tests',
  prototype: 'Prototype',
  figma_design: 'Figma',
  // Session mode aliases — artifact.stage = s.mode, not the workflow stage name
  prd: 'PRD',
  architecture: 'Arch',
  qa: 'QA Tests',
};

// Proxy to handle dynamic feature stages and QA feature stages
export const STAGE_SHORT_LABELS: Record<string, string> = new Proxy(STAGE_SHORT_LABELS_BASE, {
  get(target, prop: string) {
    if (prop.startsWith('qa_engineer_F')) {
      const match = prop.match(/qa_engineer_F(\d+)$/);
      if (match) {
        return `QA F${match[1]}`;
      }
      return target.qa_engineer;
    }
    if (prop.startsWith('story_decomposition_F')) {
      const match = prop.match(/story_decomposition_F(\d+)$/);
      if (match) {
        return `F${match[1]}`;
      }
      return target.story_decomposition;
    }
    return target[prop];
  }
});
