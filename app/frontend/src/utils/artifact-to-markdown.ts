/**
 * Converts structured JSON artifacts (analyst, prd, architecture, gtm, feature_marketing)
 * back to human-readable markdown for display in the UI.
 */

function row(...cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}
function tableHeader(...headers: string[]): string {
  return [row(...headers), row(...headers.map(() => '---'))].join('\n');
}

function analystToMarkdown(d: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`# ${d.title ?? 'Research Brief'}\n`);

  if (d.executive_summary) lines.push(`## Executive Summary\n\n${d.executive_summary}\n`);
  if (d.problem_space) lines.push(`## Problem Space\n\n${d.problem_space}\n`);

  if (d.market_size) {
    lines.push(`## Market Size & Growth\n`);
    lines.push(tableHeader('Metric', 'Value'));
    if (d.market_size.tam) lines.push(row('TAM', d.market_size.tam));
    if (d.market_size.growth_cagr) lines.push(row('Growth (CAGR)', d.market_size.growth_cagr));
    if (d.market_size.key_driver) lines.push(row('Key Driver', d.market_size.key_driver));
    lines.push('');
  }

  if (Array.isArray(d.target_users) && d.target_users.length) {
    lines.push(`## Target Users\n`);
    for (const u of d.target_users) {
      lines.push(`**${u.segment ?? 'Segment'}**`);
      if (u.job_to_be_done) lines.push(`- Job to be done: ${u.job_to_be_done}`);
      if (u.current_workaround) lines.push(`- Current workaround: ${u.current_workaround}`);
      if (u.key_frustration) lines.push(`- Key frustration: ${u.key_frustration}`);
      lines.push('');
    }
  }

  if (Array.isArray(d.competitive_landscape) && d.competitive_landscape.length) {
    lines.push(`## Competitive Landscape\n`);
    lines.push(tableHeader('Player', 'Strength', 'Gap'));
    for (const c of d.competitive_landscape) lines.push(row(c.player ?? '', c.strength ?? '', c.gap ?? ''));
    lines.push('');
  }

  if (Array.isArray(d.constraints_and_risks) && d.constraints_and_risks.length) {
    lines.push(`## Constraints & Risks\n`);
    for (const r of d.constraints_and_risks) lines.push(`- **${r.risk ?? ''}** — ${r.mitigation ?? ''}`);
    lines.push('');
  }

  if (Array.isArray(d.strategic_recommendations) && d.strategic_recommendations.length) {
    lines.push(`## Strategic Recommendations\n`);
    d.strategic_recommendations.forEach((r: string, i: number) => lines.push(`${i + 1}. ${r}`));
    lines.push('');
  }

  if (d.conclusion) lines.push(`## Conclusion\n\n${d.conclusion}\n`);

  if (Array.isArray(d.references) && d.references.length) {
    lines.push(`## References\n`);
    for (const ref of d.references) lines.push(`[${ref.id}] ${ref.title ?? ''} — ${ref.url ?? ''}`);
    lines.push('');
  }

  return lines.join('\n');
}

function prdToMarkdown(d: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`# ${d.title ?? 'PRD'}\n`);
  if (d.status) lines.push(`**Status:** ${d.status}\n`);

  if (d.problem_statement) lines.push(`## Problem Statement\n\n${d.problem_statement}\n`);

  if (Array.isArray(d.personas) && d.personas.length) {
    lines.push(`## User Personas\n`);
    for (const p of d.personas) {
      lines.push(`**${p.name ?? 'Persona'}** — ${p.description ?? ''}`);
      if (p.goal) lines.push(`- Goal: ${p.goal}`);
      if (p.pain) lines.push(`- Pain: ${p.pain}`);
      lines.push('');
    }
  }

  if (Array.isArray(d.user_journeys) && d.user_journeys.length) {
    lines.push(`## Key User Journeys\n`);
    for (const j of d.user_journeys) {
      lines.push(`### ${j.id ?? ''}: ${j.name ?? ''}`);
      if (Array.isArray(j.steps)) j.steps.forEach((s: string, i: number) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
    }
  }

  if (d.success_metrics) {
    lines.push(`## Success Metrics\n`);
    const sm = d.success_metrics;
    if (sm.primary) {
      lines.push('**Primary metric**\n');
      lines.push(tableHeader('Metric', 'Baseline', 'Target', 'Timeframe', 'Measurement'));
      const p = sm.primary;
      lines.push(row(p.metric ?? '', p.baseline ?? '', p.target ?? '', p.timeframe ?? '', p.measurement ?? ''));
      lines.push('');
    }
    if (Array.isArray(sm.secondary) && sm.secondary.length) {
      lines.push('**Secondary metrics**\n');
      lines.push(tableHeader('Metric', 'Baseline', 'Target', 'Timeframe', 'Measurement'));
      for (const s of sm.secondary) lines.push(row(s.metric ?? '', s.baseline ?? '', s.target ?? '', s.timeframe ?? '', s.measurement ?? ''));
      lines.push('');
    }
    if (Array.isArray(sm.counter) && sm.counter.length) {
      lines.push('**Counter-metrics**\n');
      lines.push(tableHeader('Metric', 'Current value', 'Acceptable floor', 'Measurement'));
      for (const c of sm.counter) lines.push(row(c.metric ?? '', c.current_value ?? '', c.acceptable_floor ?? '', c.measurement ?? ''));
      lines.push('');
    }
  }

  if (Array.isArray(d.non_functional_requirements) && d.non_functional_requirements.length) {
    lines.push(`## Non-Functional Requirements\n`);
    lines.push(tableHeader('#', 'Category', 'Requirement', 'Priority'));
    for (const n of d.non_functional_requirements) lines.push(row(n.id ?? '', n.category ?? '', n.requirement ?? '', n.priority ?? ''));
    lines.push('');
  }

  if (Array.isArray(d.functional_requirements) && d.functional_requirements.length) {
    lines.push(`## Functional Requirements\n`);
    lines.push(tableHeader('#', 'Requirement'));
    for (const f of d.functional_requirements) lines.push(row(f.id ?? '', f.requirement ?? ''));
    lines.push('');
  }

  if (Array.isArray(d.out_of_scope) && d.out_of_scope.length) {
    lines.push(`## Out of Scope\n`);
    for (const o of d.out_of_scope) lines.push(`- ${o}`);
    lines.push('');
  }

  if (Array.isArray(d.open_questions) && d.open_questions.length) {
    lines.push(`## Open Questions & Risks\n`);
    lines.push(tableHeader('#', 'Type', 'Question / Risk', 'Impact', 'Owner', 'Status'));
    for (const q of d.open_questions) lines.push(row(String(q.id ?? ''), q.type ?? '', q.description ?? '', q.impact ?? '', q.owner ?? '', q.status ?? ''));
    lines.push('');
  }

  return lines.join('\n');
}

function architectureToMarkdown(d: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`# ${d.title ?? 'Solution Architecture'}\n`);
  if (d.overview) lines.push(`## System Overview\n\n${d.overview}\n`);

  // New dependencies — shown prominently before Technology Decisions so the PM reviewer can't miss them
  if (Array.isArray(d.new_dependencies)) {
    if (d.new_dependencies.length === 0) {
      lines.push(`## ✓ New Dependencies\n\n> **No new dependencies introduced.** All technology choices reuse the existing stack.\n`);
    } else {
      lines.push(`## ⚠ New Dependencies (${d.new_dependencies.length})\n\n> **Review required.** The following technologies are not in the existing tech stack. Each must be approved before implementation begins.\n`);
      lines.push(tableHeader('Name', 'Type', 'Why existing stack cannot solve this', 'Alternatives evaluated', 'Cost / Risk'));
      for (const dep of d.new_dependencies as any[]) {
        lines.push(row(
          dep.name ?? '',
          dep.type ?? '',
          dep.not_solvable_with_existing_stack_because ?? '',
          dep.existing_alternatives_evaluated ?? '',
          dep.cost_or_risk ?? ''
        ));
      }
      lines.push('');
    }
  }

  if (d.technology_decisions) {
    lines.push(`## Technology Decisions\n`);
    for (const [platform, decisions] of Object.entries(d.technology_decisions)) {
      if (!Array.isArray(decisions) || decisions.length === 0) continue;
      lines.push(`### ${platform.charAt(0).toUpperCase() + platform.slice(1)}\n`);
      lines.push(tableHeader('Decision', 'Choice', 'Alternatives', 'Rationale'));
      for (const dec of decisions as any[]) lines.push(row(dec.decision ?? '', dec.choice ?? '', dec.alternatives ?? '', dec.rationale ?? ''));
      lines.push('');
    }
  }

  if (d.data_model) {
    lines.push(`## Data Model\n`);
    if (Array.isArray(d.data_model.entities) && d.data_model.entities.length) {
      lines.push(tableHeader('Entity', 'Primary Key', 'Key Fields', 'Relationships', 'Notes'));
      for (const e of d.data_model.entities) lines.push(row(e.name ?? '', e.primary_key ?? '', e.key_fields ?? '', e.relationships ?? '', e.notes ?? ''));
      lines.push('');
    }
    if (d.data_model.entity_relationship_diagram) {
      lines.push(`### Entity Relationship Diagram\n\n\`\`\`\n${d.data_model.entity_relationship_diagram}\n\`\`\`\n`);
    }
  }

  if (Array.isArray(d.api_surface) && d.api_surface.length) {
    lines.push(`## API Surface\n`);
    for (const svc of d.api_surface) {
      lines.push(`### ${svc.service ?? 'Service'}\n`);
      if (Array.isArray(svc.endpoints) && svc.endpoints.length) {
        lines.push(tableHeader('Method', 'Endpoint', 'Purpose', 'Request', 'Response', 'Notes'));
        for (const ep of svc.endpoints) lines.push(row(ep.method ?? '', ep.path ?? '', ep.purpose ?? '', ep.request ?? '', ep.response ?? '', ep.notes ?? ''));
        lines.push('');
      }
    }
  }

  if (Array.isArray(d.repository_impact) && d.repository_impact.length) {
    lines.push(`## Repository Impact\n`);
    lines.push(tableHeader('Repo', 'Changes Required', 'Notes'));
    for (const r of d.repository_impact) lines.push(row(r.repo ?? '', r.changes_required ?? '', r.notes ?? ''));
    lines.push('');
  }

  if (d.system_diagram) lines.push(`## System Architecture\n\n\`\`\`\n${d.system_diagram}\n\`\`\`\n`);

  if (Array.isArray(d.data_flows) && d.data_flows.length) {
    lines.push(`## Data Flows\n`);
    for (const flow of d.data_flows) {
      lines.push(`### ${flow.name ?? 'Flow'}\n`);
      if (Array.isArray(flow.steps)) flow.steps.forEach((s: string, i: number) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
    }
  }

  if (d.infrastructure) {
    lines.push(`## Infrastructure\n`);
    const inf = d.infrastructure;
    if (inf.hosting) lines.push(`**Hosting:** ${inf.hosting}\n`);
    if (inf.cost_estimate) lines.push(`**Cost estimate:** ${inf.cost_estimate}\n`);
    if (Array.isArray(inf.deployment_pipeline) && inf.deployment_pipeline.length) {
      lines.push('**Deployment pipeline:**');
      inf.deployment_pipeline.forEach((s: string, i: number) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
    }
    if (Array.isArray(inf.failure_modes) && inf.failure_modes.length) {
      lines.push('**Failure modes:**\n');
      lines.push(tableHeader('Mode', 'Mitigation'));
      for (const f of inf.failure_modes) lines.push(row(f.mode ?? '', f.mitigation ?? ''));
      lines.push('');
    }
  }

  if (Array.isArray(d.security_considerations) && d.security_considerations.length) {
    lines.push(`## Security Considerations\n`);
    for (const s of d.security_considerations) lines.push(`- ${s}`);
    lines.push('');
  }

  if (Array.isArray(d.open_questions) && d.open_questions.length) {
    lines.push(`## Open Questions & Risks\n`);
    lines.push(tableHeader('Decision', 'Recommendation', 'Risk'));
    for (const q of d.open_questions) lines.push(row(q.decision ?? '', q.recommendation ?? '', q.risk ?? ''));
    lines.push('');
  }

  return lines.join('\n');
}

function gtmToMarkdown(d: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`# ${d.title ?? 'GTM Strategy'}\n`);

  if (d.positioning_statement) lines.push(`## Positioning Statement\n\n${d.positioning_statement}\n`);

  if (Array.isArray(d.target_segments) && d.target_segments.length) {
    lines.push(`## Target Segments & Channels\n`);
    lines.push(tableHeader('Segment', 'Description', 'Priority', 'Channels', 'Rationale', 'Cost-to-Reach'));
    for (const s of d.target_segments) {
      const channels = Array.isArray(s.channels) ? s.channels.join(', ') : (s.channels ?? '');
      lines.push(row(s.segment ?? '', s.description ?? '', s.priority ?? '', channels, s.rationale ?? '', s.cost_to_reach ?? ''));
    }
    lines.push('');
  }

  if (d.messaging_framework) {
    lines.push(`## Messaging Framework\n`);
    const mf = d.messaging_framework;
    if (mf.headline) lines.push(`**Headline:** ${mf.headline}\n`);
    if (mf.sub_headline) lines.push(`**Sub-headline:** ${mf.sub_headline}\n`);
    if (Array.isArray(mf.supporting_bullets) && mf.supporting_bullets.length) {
      lines.push('**Supporting Bullets:**');
      for (const b of mf.supporting_bullets) lines.push(`- ${b}`);
      lines.push('');
    }
  }

  if (Array.isArray(d.launch_timeline) && d.launch_timeline.length) {
    lines.push(`## Launch Timeline\n`);
    lines.push(tableHeader('Phase', 'Duration', 'Key Activities', 'Success Signal'));
    for (const phase of d.launch_timeline) {
      const activities = Array.isArray(phase.key_activities) ? phase.key_activities.join('; ') : (phase.key_activities ?? '');
      lines.push(row(phase.phase ?? '', phase.duration ?? '', activities, phase.success_signal ?? ''));
    }
    lines.push('');
  }

  if (d.competitive_positioning) {
    const cp = d.competitive_positioning;
    lines.push(`## Competitive Positioning\n`);
    if (cp.top_threat) lines.push(`**Top Competitive Threat:** ${cp.top_threat}\n`);
    if (cp.response_playbook) lines.push(`**Response Playbook:** ${cp.response_playbook}\n`);
    if (Array.isArray(cp.we_win_when) && cp.we_win_when.length) {
      lines.push('**Where We Win:**\n');
      lines.push(tableHeader('Scenario', 'Why We Win'));
      for (const w of cp.we_win_when) lines.push(row(w.scenario ?? '', w.why_we_win ?? ''));
      lines.push('');
    }
    if (Array.isArray(cp.we_lose_when) && cp.we_lose_when.length) {
      lines.push('**Where We Lose:**\n');
      lines.push(tableHeader('Scenario', 'Why We Lose', 'Mitigation'));
      for (const w of cp.we_lose_when) lines.push(row(w.scenario ?? '', w.why_we_lose ?? '', w.mitigation ?? ''));
      lines.push('');
    }
  }

  if (d.success_metrics) {
    lines.push(`## GTM Success Metrics\n`);
    const sm = d.success_metrics;
    if (Array.isArray(sm.leading_indicators) && sm.leading_indicators.length) {
      lines.push('### Leading Indicators (weekly, first 30 days)\n');
      lines.push(tableHeader('Metric', 'Target', 'Measurement Method'));
      for (const m of sm.leading_indicators) lines.push(row(m.metric ?? '', m.target ?? '', m.measurement ?? ''));
      lines.push('');
    }
    if (Array.isArray(sm.lagging_indicators) && sm.lagging_indicators.length) {
      lines.push('### Lagging Indicators (30 / 60 / 90 day checkpoints)\n');
      lines.push(tableHeader('Metric', '30-day Target', '60-day Target', '90-day Target', 'Measurement'));
      for (const m of sm.lagging_indicators) lines.push(row(m.metric ?? '', m.target_30d ?? '', m.target_60d ?? '', m.target_90d ?? '', m.measurement ?? ''));
      lines.push('');
    }
  }

  return lines.join('\n');
}

function featureMarketingToMarkdown(d: Record<string, any>): string {
  const lines: string[] = [];
  const name = d.feature_name?.recommended?.name ?? 'Feature Marketing';
  lines.push(`# Feature Marketing: ${name}\n`);

  if (d.feature_name) {
    lines.push(`## Feature Name & Tagline\n`);
    const fn = d.feature_name;
    if (fn.recommended) {
      lines.push(`**Recommended:** ${fn.recommended.name} — "${fn.recommended.tagline}"`);
      if (fn.recommended.rationale) lines.push(`  _${fn.recommended.rationale}_`);
      lines.push('');
    }
    for (const key of ['alternative_a', 'alternative_b'] as const) {
      const alt = fn[key];
      if (alt) {
        lines.push(`**${key === 'alternative_a' ? 'Alternative A' : 'Alternative B'}:** ${alt.name ?? ''} — "${alt.tagline ?? ''}"`);
        if (alt.rationale) lines.push(`  _${alt.rationale}_`);
        lines.push('');
      }
    }
  }

  if (d.value_proposition) lines.push(`## Value Proposition\n\n${d.value_proposition}\n`);

  if (d.messaging_hierarchy) {
    lines.push(`## Messaging Hierarchy\n`);
    const mh = d.messaging_hierarchy;
    if (mh.headline) lines.push(`**Headline:** ${mh.headline}\n`);
    if (mh.sub_headline) lines.push(`**Sub-headline:** ${mh.sub_headline}\n`);
    if (Array.isArray(mh.supporting_bullets) && mh.supporting_bullets.length) {
      lines.push('**Supporting Bullets:**');
      for (const b of mh.supporting_bullets) lines.push(`- ${b}`);
      lines.push('');
    }
  }

  if (d.channel_copy) {
    lines.push(`## Channel Copy Pack\n`);
    const cc = d.channel_copy;
    if (cc.app_store) lines.push(`### App Store / Play Store\n\n${cc.app_store}\n`);
    if (cc.website_hero) {
      lines.push(`### Website Hero\n\n**Headline:** ${cc.website_hero.headline ?? ''}\n\n${cc.website_hero.body ?? ''}\n`);
    }
    if (cc.email) {
      lines.push(`### Email Announcement\n\n**Subject:** ${cc.email.subject_line ?? ''}\n`);
      if (cc.email.body_paragraph_1) lines.push(`${cc.email.body_paragraph_1}\n`);
      if (cc.email.body_paragraph_2) lines.push(`${cc.email.body_paragraph_2}\n`);
      if (cc.email.body_paragraph_3) lines.push(`${cc.email.body_paragraph_3}\n`);
    }
    if (cc.linkedin) lines.push(`### LinkedIn\n\n${cc.linkedin}\n`);
    if (cc.twitter) lines.push(`### X / Twitter\n\n${cc.twitter}\n`);
    if (cc.short_form_social) {
      lines.push(`### Short-Form Social Strategy\n`);
      const sfs = cc.short_form_social;
      for (const [platform, data] of Object.entries(sfs)) {
        if (!data || typeof data !== 'object') continue;
        lines.push(`**${platform.charAt(0).toUpperCase() + platform.slice(1)}:**`);
        for (const [k, v] of Object.entries(data as Record<string, string>)) lines.push(`- ${k.replace(/_/g, ' ')}: ${v}`);
        lines.push('');
      }
    }
  }

  if (Array.isArray(d.internal_faq) && d.internal_faq.length) {
    lines.push(`## Internal FAQ\n`);
    d.internal_faq.forEach((qa: { question: string; answer: string }, i: number) => {
      lines.push(`**Q${i + 1}: ${qa.question ?? ''}**\n${qa.answer ?? ''}\n`);
    });
  }

  return lines.join('\n');
}

const CONVERTERS: Record<string, (d: Record<string, any>) => string> = {
  analyst: analystToMarkdown,
  research: analystToMarkdown,
  prd: prdToMarkdown,
  architecture: architectureToMarkdown,
  gtm: gtmToMarkdown,
  feature_marketing: featureMarketingToMarkdown,
};

/**
 * Convert a JSON artifact string to markdown for display.
 * Returns null if the artifactType has no converter (i.e. it was always markdown or a specialized view).
 */
export function convertArtifactToMarkdown(artifactType: string, content: string): string | null {
  const converter = CONVERTERS[artifactType];
  if (!converter) return null;
  try {
    const parsed = JSON.parse(content);
    return converter(parsed);
  } catch {
    return content;
  }
}

export type DocumentArtifactType = keyof typeof CONVERTERS;

export function isDocumentArtifact(artifactType: string): boolean {
  return artifactType in CONVERTERS;
}
