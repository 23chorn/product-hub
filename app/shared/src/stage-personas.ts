// Canonical stage → persona display info. The single source of truth for
// "Role — Persona" labels (e.g. "Analyst — Sage") — frontend stage labels,
// backend event-log labels, and coordinator briefing labels all derive from
// this map instead of each keeping an independent copy that can drift.
export interface StagePersonaInfo {
  /** Role/title shown before the em dash, e.g. "Analyst" in "Analyst — Sage" */
  role: string;
  /** Agent persona name(s) shown after the em dash */
  persona: string;
}

export const STAGE_PERSONAS: Record<string, StagePersonaInfo> = {
  analyst:              { role: 'Analyst',                    persona: 'Sage' },
  pm_prd:                { role: 'Requirements',                persona: 'Rex' },
  epic_feature_planner:  { role: 'Epic & Feature Planning',      persona: 'Apex' },
  solution_architect:    { role: 'Architect',                    persona: 'Atlas' },
  story_decomposition:   { role: 'Shard - Product Owner',        persona: 'Vera, Finn, Remi & Cole' },
  qa_engineer:           { role: 'QA Engineer',                   persona: 'Vera' },
  prototype:             { role: 'Prototype',                     persona: 'Nova' },
  figma_design:          { role: 'Figma Design',                  persona: 'Luma' },
  critic:                { role: 'Critic',                        persona: 'Flint' },
  curator:               { role: 'Curator',                       persona: 'Ivy' },
};

export function stagePersonaLabel(stage: string): string | undefined {
  const info = STAGE_PERSONAS[stage];
  return info ? `${info.role} — ${info.persona}` : undefined;
}
