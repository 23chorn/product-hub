/**
 * pipeline-routes — write operations supporting the @xcube/pipeline CLI.
 * Mounted at /api/dev/initiatives alongside dev-tickets-routes (read-only).
 */
import { Router, Request, Response } from 'express';
import db from '../data/database';
import Logger from '../utils/logger';
import { getAzureDevOpsClient } from '../integrations/azure-devops';
import {
  findInitiativeBySeqNum, parseStreamFilter, parsePhaseFilter,
  matchesStream, matchesPhase, buildTitleToPhaseMap,
  buildStoryIdToLocalKeyMap, topoSortTickets,
  buildInitiativeContext, loadEpicFeaturesArtifact,
  buildRequirementMaps, resolveRequirements,
} from './dev-tickets-routes';
import { getWorkItemRowsByItem, getDocumentArtifactIds } from '../data/work-item-queries';
import { loadArtifactContentById } from '../agents/artifact-helpers';
import {
  tryParseBacklog, tryParsePRD, getStoryPlatforms,
  parseFeatureLocalKey, parseStoryLocalKey,
  type TicketPlatform, type FunctionalRequirement, type NonFunctionalRequirement,
} from '@pap/shared';

const logger = new Logger('PIPELINE');
const router = Router();

/**
 * PATCH /api/dev/initiatives/:seqNum/tickets/state
 * Bulk-transition ADO tickets to a new state. Used by the @xcube/pipeline CLI
 * to move tickets from New → In Dev when a developer picks them up.
 *
 * Body: { adoIds: number[], state: string }
 * Returns: { updated: number[], failed: Array<{ adoId: number, error: string }> }
 */
router.patch('/:seqNum/tickets/state', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const { adoIds, state } = req.body as { adoIds: unknown; state: unknown };
  if (!Array.isArray(adoIds) || adoIds.length === 0) {
    res.status(400).json({ error: 'body.adoIds must be a non-empty array of integers' });
    return;
  }
  if (typeof state !== 'string' || !state.trim()) {
    res.status(400).json({ error: 'body.state must be a non-empty string matching the ADO state name' });
    return;
  }

  const idList = (adoIds as unknown[]).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (idList.length === 0) {
    res.status(400).json({ error: 'adoIds contained no valid positive integers' });
    return;
  }

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  const workItemRows = getWorkItemRowsByItem([initiative.id]).get(initiative.id) ?? [];
  const allowedIds = new Set(workItemRows.map(r => r.ado_id));
  const unauthorized = idList.filter(id => !allowedIds.has(id));
  if (unauthorized.length > 0) {
    res.status(403).json({ error: `ADO IDs not associated with initiative #${seqNum}: ${unauthorized.join(', ')}` });
    return;
  }

  const ado = getAzureDevOpsClient();
  const updated: number[] = [];
  const failed: Array<{ adoId: number; error: string }> = [];

  await Promise.allSettled(
    idList.map(async adoId => {
      try {
        await ado.updateWorkItem(adoId, { state: state.trim() });
        updated.push(adoId);
      } catch (err: any) {
        failed.push({ adoId, error: err.message ?? 'Unknown error' });
      }
    })
  );

  logger.info(`Initiative #${seqNum}: moved ${updated.length} ticket(s) to "${state}"${failed.length > 0 ? `, ${failed.length} failed` : ''}`);
  res.json({ updated, failed });
});

/**
 * POST /api/dev/initiatives/:seqNum/sync-from-ado
 * Re-sync the local ado_work_item_map from the live ADO hierarchy.
 *
 * Provide the ADO epic URL (or just the numeric epic ID) and the server will:
 *   1. Fetch the epic + its features + each feature's stories from ADO
 *   2. Match each ADO item to a local row by title (case-insensitive)
 *   3. Update ado_id, ado_url, and title for every matched row
 *   4. Delete local rows whose ADO item no longer exists (title unmatched
 *      AND previously-stored ado_id is absent from the ADO hierarchy)
 *   5. Return a summary of what changed
 *
 * Body: { epicUrl: string }  — accepts the full ADO work-item URL or a bare integer ID
 * Returns: {
 *   matched: Array<{ localKey, oldAdoId, newAdoId, title }>,
 *   unmatched: { local: Array<{localKey,title}>, ado: Array<{adoId,title,type}> },
 *   removed: number
 * }
 */
router.post('/:seqNum/sync-from-ado', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const { epicUrl } = req.body as { epicUrl?: unknown };
  if (!epicUrl || typeof epicUrl !== 'string') {
    res.status(400).json({ error: 'body.epicUrl is required — provide the ADO work item URL or bare epic ID' });
    return;
  }

  const epicIdMatch = /(\d+)\s*$/.exec(epicUrl.trim());
  if (!epicIdMatch) {
    res.status(400).json({ error: 'Could not parse an ADO work item ID from epicUrl' });
    return;
  }
  const epicId = parseInt(epicIdMatch[1], 10);

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  // Resolve latest workflow for this initiative
  const latestWorkflow = db.prepare<[string], { id: string }>(
    `SELECT id FROM workflows WHERE item_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(initiative.id);
  if (!latestWorkflow) {
    res.status(404).json({ error: `Initiative #${seqNum} has no workflow — push tickets to ADO first` });
    return;
  }

  const localRows = db.prepare<[string], {
    id: number; ado_id: number; ado_type: string; ado_url: string | null; local_key: string; title: string;
  }>(
    `SELECT id, ado_id, ado_type, ado_url, local_key, title FROM ado_work_item_map WHERE workflow_id = ?`
  ).all(latestWorkflow.id);

  try {
    const ado = getAzureDevOpsClient();
    logger.info(`Syncing initiative #${seqNum} from ADO epic ${epicId}`);

    // Step 1: fetch the full hierarchy from ADO
    const { item: epicItem, childIds: featureIds } = await ado.getWorkItemWithChildren(epicId);

    const featureItems: Array<{ item: ReturnType<typeof Object.assign>; childIds: number[] }> = [];
    for (const fid of featureIds) {
      featureItems.push(await ado.getWorkItemWithChildren(fid));
    }

    const storyIds = featureItems.flatMap(f => f.childIds);
    const storyItems = storyIds.length > 0 ? await ado.getWorkItemsBatch(storyIds) : [];
    const storyById = new Map(storyItems.map(s => [s.id!, s]));

    // Build a flat list of all ADO items: [epic, ...features, ...stories]
    const adoItems: Array<{ adoId: number; title: string; type: string; adoUrl: string }> = [
      {
        adoId: epicItem.id!,
        title: String(epicItem.fields['System.Title'] ?? ''),
        type: 'epic',
        adoUrl: ado.getEpicUrl(epicItem.id!),
      },
      ...featureItems.map(({ item }) => ({
        adoId: item.id!,
        title: String(item.fields['System.Title'] ?? ''),
        type: 'feature',
        adoUrl: ado.getEpicUrl(item.id!),
      })),
      ...storyItems.map(s => ({
        adoId: s.id!,
        title: String(s.fields['System.Title'] ?? ''),
        type: 'story',
        adoUrl: ado.getEpicUrl(s.id!),
      })),
    ];

    const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

    // Step 2: match ADO items to local rows by normalised title + type
    const localByTypeAndTitle = new Map<string, typeof localRows[number]>();
    for (const row of localRows) {
      localByTypeAndTitle.set(`${row.ado_type}|${normalize(row.title)}`, row);
    }

    const matched: Array<{ localKey: string; oldAdoId: number; newAdoId: number; title: string }> = [];
    const unmatchedAdo: Array<{ adoId: number; title: string; type: string }> = [];
    const matchedLocalIds = new Set<number>();

    for (const adoItem of adoItems) {
      const key = `${adoItem.type}|${normalize(adoItem.title)}`;
      const localRow = localByTypeAndTitle.get(key);
      if (localRow) {
        matched.push({ localKey: localRow.local_key, oldAdoId: localRow.ado_id, newAdoId: adoItem.adoId, title: adoItem.title });
        matchedLocalIds.add(localRow.id);
      } else {
        unmatchedAdo.push({ adoId: adoItem.adoId, title: adoItem.title, type: adoItem.type });
      }
    }

    const unmatchedLocal = localRows
      .filter(r => !matchedLocalIds.has(r.id))
      .map(r => ({ localKey: r.local_key, title: r.title }));

    // Step 3: write changes in a transaction
    const adoIdsInHierarchy = new Set(adoItems.map(a => a.adoId));
    const updateRow = db.prepare(
      `UPDATE ado_work_item_map SET ado_id = ?, ado_url = ?, title = ?, state = NULL, state_synced_at = NULL WHERE id = ?`
    );
    const deleteRow = db.prepare(`DELETE FROM ado_work_item_map WHERE id = ?`);

    let removed = 0;
    db.transaction(() => {
      for (const m of matched) {
        const localRow = localRows.find(r => r.local_key === m.localKey)!;
        const adoItem = adoItems.find(a => a.adoId === m.newAdoId)!;
        updateRow.run(m.newAdoId, adoItem.adoUrl, m.title, localRow.id);
      }
      // Remove local rows whose stored ado_id is not anywhere in the current ADO hierarchy
      // AND which were not matched to a current ADO item — i.e. genuinely deleted
      for (const row of localRows) {
        if (!matchedLocalIds.has(row.id) && !adoIdsInHierarchy.has(row.ado_id)) {
          deleteRow.run(row.id);
          removed++;
        }
      }
    })();

    logger.info(`Initiative #${seqNum} ADO sync: ${matched.length} matched, ${unmatchedLocal.length} local unmatched, ${unmatchedAdo.length} ADO unmatched, ${removed} removed`);

    res.json({
      matched,
      unmatched: { local: unmatchedLocal, ado: unmatchedAdo },
      removed,
    });
  } catch (err: any) {
    logger.error(`ADO sync failed for initiative #${seqNum}`, err);
    res.status(500).json({ error: err.message ?? 'ADO sync failed' });
  }
});

/**
 * GET /api/dev/initiatives/:seqNum/ado-workflows
 * Lists every workflow for this initiative that has ADO work-item rows, grouped
 * so you can see which pipeline run produced which epics. Useful for identifying
 * stale rows from old runs when an initiative has been pushed to ADO more than once.
 *
 * Returns: Array<{
 *   workflowId, createdAt, status,
 *   epicCount, featureCount, storyCount,
 *   epics: Array<{ adoId, title, adoUrl }>
 * }>
 */
router.get('/:seqNum/ado-workflows', (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  const workflowRows = db.prepare<[string], {
    workflow_id: string; created_at: number; status: string;
    epic_count: number; feature_count: number; story_count: number;
  }>(`
    SELECT w.id as workflow_id, w.created_at, w.status,
           SUM(CASE WHEN m.ado_type = 'epic'    THEN 1 ELSE 0 END) as epic_count,
           SUM(CASE WHEN m.ado_type = 'feature' THEN 1 ELSE 0 END) as feature_count,
           SUM(CASE WHEN m.ado_type = 'story'   THEN 1 ELSE 0 END) as story_count
    FROM workflows w
    JOIN ado_work_item_map m ON m.workflow_id = w.id
    WHERE w.item_id = ?
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `).all(initiative.id);

  const result = workflowRows.map(wf => {
    const epics = db.prepare<[string], { ado_id: number; title: string; ado_url: string | null }>(
      `SELECT ado_id, title, ado_url FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'epic'`
    ).all(wf.workflow_id);
    return {
      workflowId: wf.workflow_id,
      createdAt: new Date(wf.created_at).toISOString(),
      status: wf.status,
      epicCount: wf.epic_count,
      featureCount: wf.feature_count,
      storyCount: wf.story_count,
      epics,
    };
  });

  res.json(result);
});

/**
 * DELETE /api/dev/initiatives/:seqNum/ado-workflows/:workflowId
 * Removes all ado_work_item_map rows for a specific workflow run, cleaning up
 * stale/duplicate entries from old pipeline runs on the progress tracker.
 * Only works for workflows belonging to the specified initiative.
 *
 * Returns: { deleted: number }
 */
router.delete('/:seqNum/ado-workflows/:workflowId', (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  const initiative = findInitiativeBySeqNum(seqNum);
  if (!initiative) {
    res.status(404).json({ error: `Initiative #${seqNum} not found` });
    return;
  }

  const workflowId = req.params.workflowId;
  const wf = db.prepare<[string, string], { id: string }>(
    `SELECT id FROM workflows WHERE id = ? AND item_id = ?`
  ).get(workflowId, initiative.id);
  if (!wf) {
    res.status(404).json({ error: `Workflow ${workflowId} not found for initiative #${seqNum}` });
    return;
  }

  const result = db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ?`).run(workflowId);
  logger.info(`Removed ${result.changes} ADO work item rows from workflow ${workflowId} (initiative #${seqNum})`);
  res.json({ deleted: result.changes });
});

// ── Pipeline export (context + plan markdown) ────────────────────────────────

interface ExportPayloadTicket {
  localKey: string;
  adoId: number;
  adoUrl: string | null;
  title: string;
  featureLocalKey: string | null;
  persona: string | null;
  goal: string | null;
  benefit: string | null;
  acceptanceCriteria: string[];
  technicalAcceptanceCriteria: string[];
  agentContext: string | null;
  estimatedPoints: number | null;
  platform: string[];
  dependsOn: string[];
  technicalNotes: Record<string, string> | string | null;
  functionalRequirements: FunctionalRequirement[];
  nonFunctionalRequirements: NonFunctionalRequirement[];
}

function buildContextMarkdown(
  initiative: { seqNum: number; title: string; context: Record<string, any> | null },
  epic: { title: string; adoId: number; adoUrl: string | null; description: string | null; businessValue: string | null } | null,
  features: Array<{ localKey: string; title: string; description: string | null; totalPoints: number }>,
  tickets: Array<{ localKey: string; featureLocalKey: string | null }>,
  implementationOrder: string[],
  blockedTickets: string[],
  payloadByKey: Map<string, ExportPayloadTicket>,
  stream: string,
  phase: string,
): string {
  const ctx = initiative.context;
  const date = new Date().toISOString().split('T')[0];
  const blockedSet = new Set(blockedTickets);
  const ticketsByFeature = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const fk = t.featureLocalKey ?? 'unknown';
    if (!ticketsByFeature.has(fk)) ticketsByFeature.set(fk, []);
    ticketsByFeature.get(fk)!.push(t);
  }

  const lines: string[] = [
    `# Pipeline Context — Initiative #${initiative.seqNum}: ${initiative.title}`,
    `**Stream:** ${stream} | **Phase:** ${phase} | **Generated:** ${date}`,
    '',
  ];

  if (ctx) {
    if (ctx.overview) lines.push('## Overview', ctx.overview, '');
    if (ctx.problemStatement) lines.push('## Problem Statement', ctx.problemStatement, '');
    if (ctx.targetUsers?.length) lines.push('## Target Users', ...ctx.targetUsers.map((u: string) => `- ${u}`), '');
    if (ctx.successMetrics) {
      lines.push('## Success Metrics');
      lines.push(`**Primary:** ${ctx.successMetrics.primary}`);
      if (ctx.successMetrics.secondary?.length) lines.push(...ctx.successMetrics.secondary.map((m: string) => `- ${m}`));
      lines.push('');
    }
    if (ctx.strategicAlignment) lines.push('## Strategic Alignment', ctx.strategicAlignment, '');
    if (ctx.constraints?.length) lines.push('## Constraints', ...ctx.constraints.map((c: string) => `- ${c}`), '');
    if (ctx.outOfScope?.length) lines.push('## Out of Scope', ...ctx.outOfScope.map((o: string) => `- ${o}`), '');
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
      const adoId = t?.adoId ?? (m as any)?.adoId;
      const adoUrl = t?.adoUrl ?? (m as any)?.adoUrl;
      const pts = t?.estimatedPoints;
      const ptsStr = pts != null ? ` (${pts} pts)` : '';
      lines.push(`#### ${ticketNum}. ${localKey} — ${t?.title ?? localKey}${ptsStr}${adoId ? ` [ADO #${adoId}]` : ''}`);

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
      const pts = (ticket as any).estimatedPoints;
      const ptsStr = pts != null ? ` (${pts} pts)` : '';
      lines.push(`#### ~~${ticket.localKey} — ${(ticket as any).title ?? ticket.localKey}${ptsStr}~~ *(blocked — cross-stream dependency)*`);
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

function buildPlanMarkdown(
  initiative: { seqNum: number; title: string },
  features: Array<{ localKey: string; title: string; totalPoints: number }>,
  tickets: Array<{ localKey: string; featureLocalKey: string | null }>,
  implementationOrder: string[],
  blockedTickets: string[],
  payloadByKey: Map<string, ExportPayloadTicket>,
  stream: string,
  phase: string,
): string {
  const date = new Date().toISOString().split('T')[0];
  const total = implementationOrder.length;
  const blockedSet = new Set(blockedTickets);
  const orderedSet = new Set(implementationOrder);
  const ticketsByFeature = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const fk = t.featureLocalKey ?? 'unknown';
    if (!ticketsByFeature.has(fk)) ticketsByFeature.set(fk, []);
    ticketsByFeature.get(fk)!.push(t);
  }

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
      const title = t?.title ?? (m as any)?.title ?? localKey;
      const adoId = t?.adoId ?? (m as any)?.adoId;
      const pts = t?.estimatedPoints;
      const ptsStr = pts != null ? ` [${pts}pt]` : '';
      const adoStr = adoId ? ` — ADO #${adoId}` : '';
      lines.push(`- [ ] ${localKey} — ${title}${ptsStr}${adoStr}`);
    }

    for (const ticket of blocked) {
      const pts = (ticket as any).estimatedPoints;
      const ptsStr = pts != null ? ` [${pts}pt]` : '';
      const adoId = (ticket as any).adoId;
      const adoStr = adoId ? ` — ADO #${adoId}` : '';
      lines.push(`- ~~${ticket.localKey} — ${(ticket as any).title ?? ticket.localKey}${ptsStr}${adoStr}~~ *(blocked)*`);
    }

    if (otherStream.length > 0) {
      lines.push(`- *(${otherStream.length} ticket(s) in other streams)*`);
    }

    lines.push('');
  }

  lines.push('## Implementation Order');
  lines.push('(Topologically sorted — complete in this sequence to respect dependencies)', '');
  implementationOrder.forEach((key, i) => {
    const t = payloadByKey.get(key);
    lines.push(`${i + 1}. ${key} — ${t?.title ?? key}`);
  });

  if (blockedTickets.length > 0) {
    lines.push('', '## Blocked (cross-stream dependencies)');
    for (const key of blockedTickets) {
      const t = payloadByKey.get(key);
      lines.push(`- ${key}${t ? ` — ${t.title}` : ''}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * GET /api/dev/initiatives/:seqNum/pipeline-export?stream=backend&phase=mvp
 * Builds PIPELINE_CONTEXT.md and PIPELINE_PLAN.md content in memory and returns
 * them as JSON so the Progress Tracker UI can trigger a browser download without
 * needing the CLI or file system access.
 *
 * Returns: { context: string, plan: string, seqNum: number, title: string }
 */
router.get('/:seqNum/pipeline-export', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer' });
    return;
  }

  let streamFilter: Set<TicketPlatform> | null;
  try { streamFilter = parseStreamFilter(req.query.stream); } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }
  let phaseFilter: Set<string> | null;
  try { phaseFilter = parsePhaseFilter(req.query.phase); } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }

  try {
    const initiative = findInitiativeBySeqNum(seqNum);
    if (!initiative) { res.status(404).json({ error: `Initiative #${seqNum} not found` }); return; }

    const workItemRows = getWorkItemRowsByItem([initiative.id]).get(initiative.id) ?? [];
    if (workItemRows.length === 0) {
      res.status(404).json({ error: `Initiative #${seqNum} has no tickets pushed to Azure DevOps yet` }); return;
    }

    const initiativeContext = await buildInitiativeContext(initiative.id);
    const { epicFeaturesArtifactId, ticketArtifactId, prdArtifactId } = getDocumentArtifactIds(initiative.id);
    const backlogContent = ticketArtifactId != null ? await loadArtifactContentById(ticketArtifactId) : null;
    const backlog = backlogContent ? tryParseBacklog(backlogContent) : null;
    const { epicMeta: epicFeaturesEpic, content: epicFeaturesContent } = await loadEpicFeaturesArtifact(epicFeaturesArtifactId);
    const titleToPhase = buildTitleToPhaseMap(epicFeaturesContent);

    const epicRow = workItemRows.find(r => r.ado_type === 'epic');
    const epicContent = backlog?.epic;
    const epic = epicRow ? {
      localKey: epicRow.local_key, adoId: epicRow.ado_id, adoUrl: epicRow.ado_url, title: epicRow.title,
      description: (epicContent as any)?.description ?? epicFeaturesEpic?.description ?? null,
      businessValue: (epicContent as any)?.businessValue ?? epicFeaturesEpic?.businessValue ?? null,
    } : null;

    const featureRows = workItemRows.filter(r => r.ado_type === 'feature')
      .sort((a, b) => (parseFeatureLocalKey(a.local_key) ?? 0) - (parseFeatureLocalKey(b.local_key) ?? 0));
    const storyRows = workItemRows.filter(r => r.ado_type === 'story').sort((a, b) => {
      const pa = parseStoryLocalKey(a.local_key);
      const pb = parseStoryLocalKey(b.local_key);
      if (!pa || !pb) return 0;
      return pa.featureIndex !== pb.featureIndex ? pa.featureIndex - pb.featureIndex : pa.storyIndex - pb.storyIndex;
    });
    const storyIdToLocalKey = buildStoryIdToLocalKeyMap(backlog);

    // Build feature metadata
    const features = featureRows.map(featureRow => {
      const featureIndex = parseFeatureLocalKey(featureRow.local_key);
      const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
      const phase = (featureContent?.title && titleToPhase.get(featureContent.title.toLowerCase())) ?? featureContent?.phase ?? null;
      const totalPoints = storyRows.filter(r => parseStoryLocalKey(r.local_key)?.featureIndex === featureIndex)
        .reduce((sum, r) => {
          const p = parseStoryLocalKey(r.local_key);
          const sc = p != null ? featureContent?.stories?.[p.storyIndex] : undefined;
          return sum + ((sc as any)?.estimated_points ?? (sc as any)?.effort ?? 0);
        }, 0);
      return { localKey: featureRow.local_key, title: featureRow.title, description: featureContent?.description ?? null, phase, totalPoints };
    }).filter(f => matchesPhase(f.phase, phaseFilter));
    const allowedFeatureKeys = new Set(features.map(f => f.localKey));

    // Build ticket summary list
    const allTickets = storyRows.map(storyRow => {
      const parsed = parseStoryLocalKey(storyRow.local_key);
      const featureIndex = parsed?.featureIndex;
      const featureRow = featureIndex != null ? featureRows.find(r => parseFeatureLocalKey(r.local_key) === featureIndex) : undefined;
      const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
      const storyContent = parsed != null ? featureContent?.stories?.[parsed.storyIndex] : undefined;
      const platforms = storyContent ? getStoryPlatforms(storyContent) : [];
      const dependsOn = ((storyContent as any)?.depends_on ?? []).map((ref: string) => storyIdToLocalKey.get(ref) ?? ref);
      return { localKey: storyRow.local_key, adoId: storyRow.ado_id, adoUrl: storyRow.ado_url, title: storyRow.title,
        featureLocalKey: featureRow?.local_key ?? null, platform: platforms, dependsOn,
        estimatedPoints: (storyContent as any)?.estimated_points ?? (storyContent as any)?.effort ?? null };
    })
    .filter(t => !phaseFilter || !t.featureLocalKey || allowedFeatureKeys.has(t.featureLocalKey))
    .filter(t => matchesStream(t.platform, streamFilter));

    // Build implementation order
    const streamTicketKeys = new Set(allTickets.map(t => t.localKey));
    const blocked: string[] = [];
    const orderableTickets = allTickets.map(t => {
      const crossStream = t.dependsOn.filter((dep: string) => !streamTicketKeys.has(dep));
      if (crossStream.length > 0) { blocked.push(t.localKey); return null; }
      return { localKey: t.localKey, dependsOn: t.dependsOn.filter((dep: string) => streamTicketKeys.has(dep)) };
    }).filter((t): t is { localKey: string; dependsOn: string[] } => t !== null);
    const implementationOrder = topoSortTickets(orderableTickets);

    // Build full ticket payload for ordered tickets
    const prdContent = prdArtifactId != null ? await loadArtifactContentById(prdArtifactId) : null;
    const prd = prdContent ? tryParsePRD(prdContent) : null;
    const { frs, nfrs } = buildRequirementMaps(prd);

    const payloadByKey = new Map<string, ExportPayloadTicket>();
    const implementationSet = new Set(implementationOrder);
    for (const storyRow of storyRows.filter(r => implementationSet.has(r.local_key))) {
      const parsed = parseStoryLocalKey(storyRow.local_key);
      const featureIndex = parsed?.featureIndex;
      const featureRow = featureIndex != null ? featureRows.find(r => parseFeatureLocalKey(r.local_key) === featureIndex) : undefined;
      const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
      const storyContent = parsed != null ? featureContent?.stories?.[parsed.storyIndex] : undefined;
      const dependsOn = ((storyContent as any)?.depends_on ?? []).map((ref: string) => storyIdToLocalKey.get(ref) ?? ref);
      const { functionalRequirements, nonFunctionalRequirements } = resolveRequirements(featureContent, frs, nfrs);
      payloadByKey.set(storyRow.local_key, {
        localKey: storyRow.local_key, adoId: storyRow.ado_id, adoUrl: storyRow.ado_url, title: storyRow.title,
        featureLocalKey: featureRow?.local_key ?? null,
        persona: (storyContent as any)?.as_a ?? (storyContent as any)?.persona ?? null,
        goal: (storyContent as any)?.i_want ?? (storyContent as any)?.goal ?? null,
        benefit: (storyContent as any)?.so_that ?? (storyContent as any)?.benefit ?? null,
        acceptanceCriteria: (storyContent as any)?.acceptance_criteria ?? (storyContent as any)?.acceptanceCriteria ?? [],
        technicalAcceptanceCriteria: (storyContent as any)?.technical_acceptance_criteria ?? [],
        agentContext: (storyContent as any)?.agentContext ?? null,
        estimatedPoints: (storyContent as any)?.estimated_points ?? (storyContent as any)?.effort ?? null,
        platform: storyContent ? getStoryPlatforms(storyContent) : [],
        dependsOn, technicalNotes: (storyContent as any)?.technical_notes ?? null,
        functionalRequirements, nonFunctionalRequirements,
      });
    }

    const streamLabel = streamFilter ? Array.from(streamFilter).join('+') : 'all';
    const phaseLabel = phaseFilter ? Array.from(phaseFilter).join('+') : 'all';

    const context = buildContextMarkdown(
      { seqNum: initiative.seq_num, title: initiative.title, context: initiativeContext as any },
      epic, features, allTickets, implementationOrder, blocked, payloadByKey, streamLabel, phaseLabel,
    );
    const plan = buildPlanMarkdown(
      { seqNum: initiative.seq_num, title: initiative.title },
      features, allTickets, implementationOrder, blocked, payloadByKey, streamLabel, phaseLabel,
    );

    res.json({ context, plan, seqNum: initiative.seq_num, title: initiative.title });
  } catch (err: any) {
    logger.error(`Failed to generate pipeline export for initiative #${seqNum}`, err);
    res.status(500).json({ error: err.message || 'Export generation failed' });
  }
});

export default router;
