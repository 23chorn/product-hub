import * as fs from 'fs';
import * as path from 'path';
import type { ManifestResponse, ManifestTicket, PayloadTicket } from './types';

export function writeContextFiles(
  manifest: ManifestResponse,
  payloadByKey: Map<string, PayloadTicket>,
  workspace: string,
  stream: string,
  phase: string
): { contextPath: string; planPath: string } {
  const contextPath = path.join(workspace, 'PIPELINE_CONTEXT.md');
  const planPath = path.join(workspace, 'PIPELINE_PLAN.md');

  fs.writeFileSync(contextPath, buildContext(manifest, payloadByKey, stream, phase), 'utf8');
  fs.writeFileSync(planPath, buildPlan(manifest, payloadByKey, stream, phase), 'utf8');

  return { contextPath, planPath };
}

/** Group manifest tickets by their parent feature local key. */
function groupTicketsByFeature(tickets: ManifestTicket[]): Map<string, ManifestTicket[]> {
  const map = new Map<string, ManifestTicket[]>();
  for (const t of tickets) {
    const fk = t.featureLocalKey ?? 'unknown';
    if (!map.has(fk)) map.set(fk, []);
    map.get(fk)!.push(t);
  }
  return map;
}

function buildContext(
  manifest: ManifestResponse,
  payloadByKey: Map<string, PayloadTicket>,
  stream: string,
  phase: string
): string {
  const { initiative, epic, features, tickets, implementationOrder, blockedTickets } = manifest;
  const ctx = initiative.context;
  const date = new Date().toISOString().split('T')[0];
  const blockedSet = new Set(blockedTickets ?? []);
  const ticketsByFeature = groupTicketsByFeature(tickets);

  const lines: string[] = [
    `# Pipeline Context — Initiative #${initiative.seqNum}: ${initiative.title}`,
    `**Stream:** ${stream} | **Phase:** ${phase} | **Generated:** ${date}`,
    '',
  ];

  if (ctx) {
    if (ctx.overview) lines.push('## Overview', ctx.overview, '');
    if (ctx.problemStatement) lines.push('## Problem Statement', ctx.problemStatement, '');
    if (ctx.targetUsers?.length) {
      lines.push('## Target Users', ...ctx.targetUsers.map(u => `- ${u}`), '');
    }
    if (ctx.successMetrics) {
      lines.push('## Success Metrics');
      lines.push(`**Primary:** ${ctx.successMetrics.primary}`);
      if (ctx.successMetrics.secondary?.length) {
        lines.push(...ctx.successMetrics.secondary.map(m => `- ${m}`));
      }
      lines.push('');
    }
    if (ctx.strategicAlignment) lines.push('## Strategic Alignment', ctx.strategicAlignment, '');
    if (ctx.constraints?.length) lines.push('## Constraints', ...ctx.constraints.map(c => `- ${c}`), '');
    if (ctx.outOfScope?.length) lines.push('## Out of Scope', ...ctx.outOfScope.map(o => `- ${o}`), '');
  }

  if (epic) {
    lines.push('## Epic');
    lines.push(`**${epic.title}** (ADO #${epic.adoId})`);
    if (epic.description) lines.push('', epic.description);
    if (epic.businessValue) lines.push('', `**Business Value:** ${epic.businessValue}`);
    if (epic.adoUrl) lines.push('', `[Open in Azure DevOps](${epic.adoUrl})`);
    lines.push('');
  }

  lines.push('---', '', `## Implementation Queue (${implementationOrder.length} tickets)`, '');

  let ticketNum = 0;
  for (const feature of features) {
    const featureTickets = ticketsByFeature.get(feature.localKey) ?? [];
    const orderedKeys = implementationOrder.filter(k => featureTickets.some(t => t.localKey === k));
    const blockedForFeature = featureTickets.filter(t => blockedSet.has(t.localKey));

    lines.push(`### Feature ${feature.localKey}: ${feature.title} (${feature.totalPoints ?? 0} pts)`);
    if (feature.description) lines.push('', feature.description);
    lines.push('');

    if (orderedKeys.length === 0 && blockedForFeature.length === 0) {
      lines.push(`*No ${stream} tickets in this feature.*`, '');
      continue;
    }

    for (const localKey of orderedKeys) {
      ticketNum++;
      const t = payloadByKey.get(localKey);
      const m = featureTickets.find(mt => mt.localKey === localKey);
      if (!t && !m) continue;

      const title = t?.title ?? m?.title ?? localKey;
      const adoId = t?.adoId ?? m?.adoId;
      const adoUrl = t?.adoUrl ?? m?.adoUrl;
      const pts = t?.estimatedPoints ?? m?.estimatedPoints;
      const ptsStr = pts != null ? ` (${pts} pts)` : '';

      lines.push(`#### ${ticketNum}. ${localKey} — ${title}${ptsStr}${adoId ? ` [ADO #${adoId}]` : ''}`);

      if (t) {
        if (t.persona && t.goal) {
          lines.push('', `**Story:** As ${t.persona}, I want ${t.goal}${t.benefit ? ` so that ${t.benefit}` : ''}.`);
        }
        if (t.functionalRequirements.length > 0) {
          lines.push('', '**Functional Requirements:**');
          for (const fr of t.functionalRequirements) lines.push(`- **${fr.id}:** ${fr.requirement}`);
        }
        if (t.acceptanceCriteria.length > 0) {
          lines.push('', '**Acceptance Criteria:**');
          for (const ac of t.acceptanceCriteria) lines.push(`- [ ] ${ac}`);
        }
        if (t.technicalAcceptanceCriteria.length > 0) {
          lines.push('', '**Technical Acceptance Criteria:**');
          for (const tac of t.technicalAcceptanceCriteria) lines.push(`- [ ] ${tac}`);
        }
        if (t.agentContext) lines.push('', '**Implementation Notes:**', t.agentContext);
        if (t.technicalNotes) {
          lines.push('', '**Technical Notes:**');
          if (typeof t.technicalNotes === 'string') {
            lines.push(t.technicalNotes);
          } else {
            for (const [platform, note] of Object.entries(t.technicalNotes).filter(([, v]) => v)) {
              lines.push(`- **${platform}:** ${note}`);
            }
          }
        }
        if (t.nonFunctionalRequirements.length > 0) {
          lines.push('', '**Non-Functional Requirements:**');
          for (const nfr of t.nonFunctionalRequirements) {
            lines.push(`- **${nfr.id}** [${nfr.category}, ${nfr.priority}]: ${nfr.requirement}`);
          }
        }
        if (t.dependsOn.length > 0) lines.push('', `**Depends on:** ${t.dependsOn.join(', ')}`);
        if (t.platform.length > 0) lines.push(`**Platform:** ${t.platform.join(', ')}`);
      }

      if (adoUrl) lines.push(`**ADO:** ${adoUrl}`);
      lines.push('', '---', '');
    }

    for (const ticket of blockedForFeature) {
      const pts = ticket.estimatedPoints;
      const ptsStr = pts != null ? ` (${pts} pts)` : '';
      lines.push(`#### ~~${ticket.localKey} — ${ticket.title}${ptsStr}~~ *(blocked — cross-stream dependency)*`);
      if (ticket.adoUrl) lines.push(`**ADO:** ${ticket.adoUrl}`);
      lines.push('', '---', '');
    }
  }

  if (ctx?.references?.length) {
    lines.push('## References');
    for (const ref of ctx.references) lines.push(`- [${ref.title}](${ref.url})`);
    lines.push('');
  }

  return lines.join('\n');
}

function buildPlan(
  manifest: ManifestResponse,
  payloadByKey: Map<string, PayloadTicket>,
  stream: string,
  phase: string
): string {
  const { initiative, features, tickets, implementationOrder, blockedTickets } = manifest;
  const date = new Date().toISOString().split('T')[0];
  const total = implementationOrder.length;
  const blockedSet = new Set(blockedTickets ?? []);
  const orderedSet = new Set(implementationOrder);
  const ticketsByFeature = groupTicketsByFeature(tickets);

  const lines: string[] = [
    `# Implementation Plan — Initiative #${initiative.seqNum}: ${initiative.title}`,
    `**Stream:** ${stream} | **Phase:** ${phase} | **Generated:** ${date}`,
    '',
    `## Status: 0 / ${total} complete`,
    '',
  ];

  for (const feature of features) {
    const featureTickets = ticketsByFeature.get(feature.localKey) ?? [];
    const ordered = implementationOrder.filter(k => featureTickets.some(t => t.localKey === k));
    const blocked = featureTickets.filter(t => blockedSet.has(t.localKey));
    const otherStream = featureTickets.filter(t => !orderedSet.has(t.localKey) && !blockedSet.has(t.localKey));

    lines.push(`### Feature ${feature.localKey}: ${feature.title} (${feature.totalPoints ?? 0} pts)`);

    if (ordered.length === 0 && blocked.length === 0) {
      lines.push(`- *(no ${stream} tickets in this feature)*`);
    }

    for (const localKey of ordered) {
      const t = payloadByKey.get(localKey);
      const m = featureTickets.find(mt => mt.localKey === localKey);
      const title = t?.title ?? m?.title ?? localKey;
      const adoId = t?.adoId ?? m?.adoId;
      const pts = t?.estimatedPoints ?? m?.estimatedPoints;
      const ptsStr = pts != null ? ` [${pts}pt]` : '';
      const adoStr = adoId ? ` — ADO #${adoId}` : '';
      lines.push(`- [ ] ${localKey} — ${title}${ptsStr}${adoStr}`);
    }

    for (const ticket of blocked) {
      const pts = ticket.estimatedPoints;
      const ptsStr = pts != null ? ` [${pts}pt]` : '';
      const adoStr = ticket.adoId ? ` — ADO #${ticket.adoId}` : '';
      lines.push(`- ~~${ticket.localKey} — ${ticket.title}${ptsStr}${adoStr}~~ *(blocked)*`);
    }

    if (otherStream.length > 0) {
      lines.push(`- *(${otherStream.length} ticket(s) in other streams)*`);
    }

    lines.push('');
  }

  lines.push('## Implementation Order');
  lines.push('(Topologically sorted — complete in this sequence to respect dependencies)', '');
  implementationOrder.forEach((key, i) => {
    const m = tickets.find(t => t.localKey === key);
    lines.push(`${i + 1}. ${key} — ${m?.title ?? key}`);
  });

  if (blockedTickets?.length) {
    lines.push('', '## Blocked (cross-stream dependencies)');
    for (const key of blockedTickets) {
      const m = tickets.find(t => t.localKey === key);
      lines.push(`- ${key}${m ? ` — ${m.title}` : ''}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
