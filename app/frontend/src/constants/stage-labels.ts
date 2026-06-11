const STAGE_LABELS_BASE: Record<string, string> = {
  analyst:              'Analyst — Sage',
  pm_prd:               'Product Requirements — Rex',
  epic_feature_planner: 'Epic & Feature Planning — Apex',
  solution_architect:   'Architect — Atlas',
  story_decomposition:  'Collaborative Refinement — Shard, Vera, Finn, Remi & Cole',
  prototype:            'Prototype — Nova',
  pm_backlog:           'Backlog — Pip',
  gtm_strategy:         'GTM Strategy — Quinn',
  feature_marketing:    'Feature Marketing — Milo',
  qa_engineer:          'QA Engineer — Vera',
  critic:               'Critic — Flint',
  curator:              'Curator — Ivy',
  tech_refinement:      'Tech Refinement — Finn, Remi & Cole',
};

// Proxy to handle dynamic feature stages (story_decomposition_F1, F2, etc.)
// Each story_decomposition_F* stage runs a 7-agent collaborative refinement (Product + QA + 4 Engineers)
export const STAGE_LABELS: Record<string, string> = new Proxy(STAGE_LABELS_BASE, {
  get(target, prop: string) {
    // Map story_decomposition_F1, F2, F3, etc. → "Collaborative Refinement — 7 Agents"
    if (prop.startsWith('story_decomposition_F')) {
      return target.story_decomposition;
    }
    return target[prop];
  }
});

// Stages available for user toggle at workflow start (order matters)
// gtm_strategy and feature_marketing are hidden — not yet ready for general use
// pm_backlog hidden — replaced by epic_feature_planner + story_decomposition
export const TOGGLEABLE_STAGES: Array<{ key: string; label: string; short: string }> = [
  { key: 'analyst',              label: 'Analyst — Sage',               short: 'Sage · Analyst' },
  { key: 'pm_prd',               label: 'Requirements — Rex',           short: 'Rex · PM' },
  { key: 'prototype',            label: 'Prototype — Nova',             short: 'Nova · Prototype' },
  { key: 'solution_architect',   label: 'Architect — Atlas',            short: 'Atlas · Architect' },
  { key: 'epic_feature_planner', label: 'Epic & Features — Apex',       short: 'Apex · Features' },
  { key: 'story_decomposition',  label: 'Collaborative Refinement — 7 Agents',  short: '7 Agents · Refinement' },
  { key: 'qa_engineer',          label: 'QA Engineer — Vera',           short: 'Vera · QA' },
  { key: 'curator',              label: 'Curator — Ivy',                short: 'Ivy · Curator' },
];

const STAGE_SHORT_LABELS_BASE: Record<string, string> = {
  analyst: 'Research',
  pm_prd: 'PRD',
  epic_feature_planner: 'Features',
  solution_architect: 'Arch',
  story_decomposition: 'Stories',
  prototype: 'Prototype',
  pm_backlog: 'Backlog',
  gtm_strategy: 'GTM',
  feature_marketing: 'Marketing',
  qa_engineer: 'QA Tests',
  tech_refinement: 'Tech Review',
};

// Proxy to handle dynamic feature stages and QA feature stages
export const STAGE_SHORT_LABELS: Record<string, string> = new Proxy(STAGE_SHORT_LABELS_BASE, {
  get(target, prop: string) {
    if (prop.startsWith('story_decomposition_F')) {
      return target.story_decomposition;
    }
    if (prop.startsWith('qa_engineer_F')) {
      return target.qa_engineer;
    }
    return target[prop];
  }
});
