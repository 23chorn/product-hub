export const STAGE_LABELS: Record<string, string> = {
  analyst:            'Analyst — Sage',
  pm_prd:             'Product Requirements — Rex',
  solution_architect: 'Architect — Atlas',
  prototype:          'Prototype — Nova',
  pm_backlog:         'Backlog — Pip',
  gtm_strategy:       'GTM Strategy — Quinn',
  feature_marketing:  'Feature Marketing — Milo',
  critic:             'Critic — Flint',
  curator:            'Curator — Ivy',
};

// Stages available for user toggle at workflow start (order matters)
export const TOGGLEABLE_STAGES: Array<{ key: string; label: string; short: string }> = [
  { key: 'analyst',            label: 'Analyst — Sage',          short: 'Sage · Analyst' },
  { key: 'pm_prd',             label: 'Requirements — Rex',      short: 'Rex · PM' },
  { key: 'solution_architect', label: 'Architect — Atlas',       short: 'Atlas · Architect' },
  { key: 'prototype',          label: 'Prototype — Nova',        short: 'Nova · Prototype' },
  { key: 'pm_backlog',         label: 'Backlog — Pip',           short: 'Pip · Backlog' },
  { key: 'gtm_strategy',       label: 'GTM Strategy — Quinn',    short: 'Quinn · GTM' },
  { key: 'feature_marketing',  label: 'Feature Marketing — Milo', short: 'Milo · Marketing' },
  { key: 'curator',            label: 'Curator — Ivy',           short: 'Ivy · Curator' },
];

export const STAGE_SHORT_LABELS: Record<string, string> = {
  analyst: 'Research',
  pm_prd: 'PRD',
  solution_architect: 'Arch',
  prototype: 'Prototype',
  pm_backlog: 'Backlog',
  gtm_strategy: 'GTM',
  feature_marketing: 'Marketing',
};
