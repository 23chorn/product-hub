const STAGE_LABELS_BASE: Record<string, string> = {
  analyst:              'Analyst — Sage',
  pm_prd:               'Product Requirements — Rex',
  epic_feature_planner: 'Epic & Feature Planning — Apex',
  solution_architect:   'Architect — Atlas',
  story_decomposition:  'Shard - Product Owner — Vera, Finn, Remi & Cole',
  prototype:            'Prototype — Nova',
  figma_design:         'Figma Design — Luma',
  critic:               'Critic — Flint',
  curator:              'Curator — Ivy',
};

// Proxy to handle dynamic feature stages (story_decomposition_F1, F2, etc.)
// Each story_decomposition_F* stage runs a multi-agent collaborative refinement with platform-filtered participants
export const STAGE_LABELS: Record<string, string> = new Proxy(STAGE_LABELS_BASE, {
  get(target, prop: string) {
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

// Stages available for user toggle at workflow start (order matters)
export const TOGGLEABLE_STAGES: Array<{ key: string; label: string; short: string }> = [
  { key: 'analyst',              label: 'Analyst — Sage',               short: 'Sage · Analyst' },
  { key: 'pm_prd',               label: 'Requirements — Rex',           short: 'Rex · PM' },
  { key: 'prototype',            label: 'Prototype — Nova',             short: 'Nova · Prototype' },
  { key: 'figma_design',         label: 'Figma Design — Luma',          short: 'Luma · Figma' },
  { key: 'solution_architect',   label: 'Architect — Atlas',            short: 'Atlas · Architect' },
  { key: 'epic_feature_planner', label: 'Epic & Features — Apex',       short: 'Apex · Features' },
  { key: 'story_decomposition',  label: 'Shard - Product Owner',              short: 'Multi-Agent · Refinement' },
  { key: 'curator',              label: 'Curator — Ivy',                short: 'Ivy · Curator' },
];

const STAGE_SHORT_LABELS_BASE: Record<string, string> = {
  analyst: 'Research',
  pm_prd: 'PRD',
  epic_feature_planner: 'Features',
  solution_architect: 'Arch',
  story_decomposition: 'Stories',
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
