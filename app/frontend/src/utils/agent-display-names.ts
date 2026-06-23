const AGENT_DISPLAY_NAMES: Record<string, string> = {
  analyst: 'Sage - Analyst',
  pm: 'Rex - Product Manager',
  pm_prd: 'Rex - Product Manager',
  architect: 'Atlas - Architect',
  solution_architect: 'Atlas - Architect',
  story_decomposition: 'Shard - Product Owner',
  'story-decomposition': 'Shard - Product Owner',
  curator: 'Ivy - Context Curator',
  coordinator: 'Coordinator - Chief of Staff',
  critic: 'Flint - Adversarial Reviewer',
  'critic-core': 'Flint - Adversarial Reviewer',
  'prototype-builder': 'Nova - Prototype',
  prototype: 'Nova - Prototype',
  'ios-engineer': 'Cole - iOS Engineer',
  ios_engineer: 'Cole - iOS Engineer',
  'android-engineer': 'Dex - Android Engineer',
  android_engineer: 'Dex - Android Engineer',
  'backend-engineer': 'Finn - Backend Engineer',
  backend_engineer: 'Finn - Backend Engineer',
  'web-engineer': 'Remi - Web Engineer',
  web_engineer: 'Remi - Web Engineer',
  'qa-engineer': 'Vera - QA Engineer',
  qa_engineer: 'Vera - QA Engineer',
  'epic-feature-planner': 'Apex - Epic & Feature Planning Specialist',
};

export function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

/** key is an agent file's stem, e.g. "analyst" for analyst.md, "research.template" for research.template.md. */
export function getAgentDisplayName(key: string): string {
  return AGENT_DISPLAY_NAMES[key] ?? humanizeLabel(key);
}
