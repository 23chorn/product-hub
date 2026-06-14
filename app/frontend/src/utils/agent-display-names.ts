import type { SkillVersion } from '../services/api';

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

export function getAgentDisplayName(skill: Pick<SkillVersion, 'skill_name' | 'agent_type'>): string {
  return AGENT_DISPLAY_NAMES[skill.skill_name]
    ?? AGENT_DISPLAY_NAMES[skill.agent_type]
    ?? humanizeLabel(skill.skill_name);
}
