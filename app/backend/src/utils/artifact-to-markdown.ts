/**
 * Converts structured JSON artifacts to markdown for external publishing (e.g. wiki).
 * Mirrors the logic in app/frontend/src/utils/artifact-to-markdown.ts.
 */

import Logger from './logger';
const logger = new Logger('ARTIFACT-TO-MARKDOWN');

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

  if (d.web_search_enabled === false) {
    lines.push(`---\n`);
    lines.push(`*No web search was completed for this document. The information above is based on available training data only and has not been independently verified.*\n`);
  } else if (Array.isArray(d.references) && d.references.length) {
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

  if (Array.isArray(d.new_dependencies)) {
    if (d.new_dependencies.length === 0) {
      lines.push(`## New Dependencies\n\n> No new dependencies introduced. All technology choices reuse the existing stack.\n`);
    } else {
      lines.push(`## New Dependencies (${d.new_dependencies.length})\n\n> The following technologies are not in the existing tech stack and require approval before implementation.\n`);
      lines.push(tableHeader('Name', 'Type', 'Why existing stack cannot solve this', 'Alternatives evaluated', 'Cost / Risk'));
      for (const dep of d.new_dependencies as any[]) {
        lines.push(row(dep.name ?? '', dep.type ?? '', dep.not_solvable_with_existing_stack_because ?? '', dep.existing_alternatives_evaluated ?? '', dep.cost_or_risk ?? ''));
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

function figmaDesignToMarkdown(d: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`# ${d.title ?? 'Figma Mockup Plan'}\n`);

  const statusBadge = d.figma_write_status === 'created' ? '✅ Written to Figma'
    : d.figma_write_status === 'annotated' ? '📝 Design brief posted — awaiting designer edits'
    : d.figma_write_status === 'reviewed' ? '✅ Designer review complete'
    : d.figma_write_status === 'partial' ? '⚠️ Partially written'
    : '🕐 Planned (write deferred)';
  lines.push(`**Status:** ${statusBadge}\n`);
  if (d.figma_file_url) lines.push(`**Mockup file:** ${d.figma_file_url}\n`);
  if (d.source_design_system) lines.push(`**Design system:** \`${d.source_design_system}\`\n`);

  const dt = d.design_tokens_extracted;
  if (dt) {
    if (Array.isArray(dt.design_gaps) && dt.design_gaps.length) {
      lines.push(`## ⚠ Design Gaps (${dt.design_gaps.length})\n`);
      lines.push(`> The following components or tokens are missing from the design system and must be created before production handoff.\n`);
      for (const gap of dt.design_gaps) lines.push(`- ${gap}`);
      lines.push('');
    }

    if (Array.isArray(dt.colors) && dt.colors.length) {
      lines.push(`## Design Tokens — Colors\n`);
      lines.push(tableHeader('Token', 'Value', 'Usage'));
      for (const c of dt.colors) lines.push(row(c.name ?? '', c.value ?? '', c.usage ?? ''));
      lines.push('');
    }

    if (Array.isArray(dt.typography) && dt.typography.length) {
      lines.push(`## Design Tokens — Typography\n`);
      lines.push(tableHeader('Style', 'Family', 'Size', 'Weight', 'Usage'));
      for (const t of dt.typography) lines.push(row(t.name ?? '', t.font_family ?? '', t.size ?? '', t.weight ?? '', t.usage ?? ''));
      lines.push('');
    }

    if (Array.isArray(dt.components) && dt.components.length) {
      lines.push(`## Components Used\n`);
      lines.push(tableHeader('Component', 'Node ID', 'Variants'));
      for (const c of dt.components) lines.push(row(c.name ?? '', c.node_id ?? '', Array.isArray(c.variants) ? c.variants.join(', ') : ''));
      lines.push('');
    }
  }

  if (Array.isArray(d.screens_created) && d.screens_created.length) {
    lines.push(`## Screens (${d.screens_created.length})\n`);
    for (const s of d.screens_created) {
      lines.push(`### ${s.name ?? 'Screen'}`);
      if (s.frame_url) lines.push(`[Open in Figma](${s.frame_url})\n`);
      if (s.description) lines.push(`${s.description}\n`);
      if (Array.isArray(s.prd_journeys) && s.prd_journeys.length) {
        lines.push(`**Covers journeys:** ${s.prd_journeys.join(', ')}\n`);
      }
      if (s.layout_notes) lines.push(`**Layout:** ${s.layout_notes}\n`);
      if (Array.isArray(s.interactions) && s.interactions.length) {
        lines.push(`**Interactions:**`);
        for (const i of s.interactions) {
          const note = i.notes ? ` — ${i.notes}` : '';
          lines.push(`- ${i.trigger ?? ''} → ${i.target_screen ?? ''}${note}`);
        }
        lines.push('');
      }
    }
  }

  if (d.navigation_flow) lines.push(`## Navigation Flow\n\n\`\`\`\n${d.navigation_flow}\n\`\`\`\n`);
  if (d.notes) lines.push(`## Notes\n\n${d.notes}\n`);

  return lines.join('\n');
}

const CONVERTERS: Record<string, (d: Record<string, any>) => string> = {
  analyst:      analystToMarkdown,
  research:     analystToMarkdown,
  prd:          prdToMarkdown,
  architecture: architectureToMarkdown,
  figma_design: figmaDesignToMarkdown,
};

/**
 * Convert a JSON artifact string to markdown.
 * Returns the original content unchanged if no converter exists for the type
 * (e.g. content that is already markdown, or a specialised view type).
 */
export function convertArtifactToMarkdown(artifactType: string, content: string): string {
  const converter = CONVERTERS[artifactType];
  if (!converter) {
    logger.warn(`No converter registered for type "${artifactType}" — returning content as-is`);
    return content;
  }
  // If the content is already markdown (doesn't start with a JSON object), return as-is
  if (!content.trimStart().startsWith('{')) {
    logger.info(`${artifactType} artifact is already markdown — skipping conversion`);
    return content;
  }
  try {
    logger.info(`Converting ${artifactType} artifact (${content.length} chars) to markdown`);

    // Try parsing the full content first
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (firstErr: any) {
      // If parse fails due to extra content after JSON, extract just the first JSON object
      if (firstErr.message.includes('after JSON')) {
        logger.warn(`Extra content after JSON detected, extracting first complete object`);
        // Find the position of the first '{' and match closing '}'
        const start = content.indexOf('{');
        if (start === -1) throw firstErr;

        let braceCount = 0;
        let end = start;
        for (let i = start; i < content.length; i++) {
          if (content[i] === '{') braceCount++;
          else if (content[i] === '}') braceCount--;
          if (braceCount === 0) {
            end = i + 1;
            break;
          }
        }

        const jsonOnly = content.slice(start, end);
        logger.info(`Extracted JSON substring (${jsonOnly.length} chars)`);
        parsed = JSON.parse(jsonOnly);
      } else {
        throw firstErr;
      }
    }

    const markdown = converter(parsed);
    logger.info(`Conversion complete — output ${markdown.length} chars`);
    return markdown;
  } catch (err: any) {
    logger.error(`Failed to parse JSON for type "${artifactType}": ${err.message}`);
    logger.error(`Content preview: ${content.slice(0, 200)}...`);
    return content;
  }
}
