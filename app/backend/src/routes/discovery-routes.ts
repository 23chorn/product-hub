import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import db from '../data/database';
import Logger from '../utils/logger';
import { canLaunchWorkflow, isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import type { DiscoverySource, DiscoveryOpportunity, DiscoverySourceType, DiscoveryOpportunityStatus, AirtableItem } from '@pap/shared';
import { runDiscovery } from '../agents/discovery-agent';
import { AirtableClient } from '../integrations/airtable';
import { appConfig } from '../config/app-config';
import { nextItemSeqNum } from '../agents/item-metadata';

const logger = new Logger('DISCOVERY');

export const discoveryRoutes = Router();

const SOURCE_TYPES: DiscoverySourceType[] = ['user_interview', 'app_store_review', 'play_store_review', 'competitor_note', 'other'];
const OPPORTUNITY_STATUSES: DiscoveryOpportunityStatus[] = ['new', 'reviewed', 'promoted', 'dismissed'];

/** view_only is a hard-deny marker role — same convention as canEdit() in behaviour-file-routes.ts. */
function canMutate(user: AuthRequest['user']): boolean {
  return !isViewOnly(user);
}

let airtableClient: AirtableClient;
function getAirtableClient(): AirtableClient {
  if (!airtableClient) airtableClient = new AirtableClient();
  return airtableClient;
}

interface SourceRow {
  id: string;
  source_type: DiscoverySourceType;
  title: string;
  content: string;
  origin: 'manual' | 'api';
  external_id: string | null;
  external_url: string | null;
  fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

function mapSourceRow(row: SourceRow): DiscoverySource {
  return {
    id: row.id,
    sourceType: row.source_type,
    title: row.title,
    content: row.content,
    origin: row.origin,
    externalId: row.external_id ?? undefined,
    externalUrl: row.external_url ?? undefined,
    fetchedAt: row.fetched_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/discovery/sources — list all source documents, newest first.
 */
discoveryRoutes.get('/sources', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT * FROM discovery_sources ORDER BY created_at DESC').all() as SourceRow[];
  res.json({ sources: rows.map(mapSourceRow) });
});

/**
 * POST /api/discovery/sources — add a manually pasted/uploaded source document.
 */
discoveryRoutes.post('/sources', (req: AuthRequest, res: Response) => {
  if (!canMutate(req.user)) {
    res.status(403).json({ error: 'View-only users cannot add discovery sources', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  const { sourceType, title, content } = req.body as { sourceType?: string; title?: string; content?: string };

  if (!sourceType || !SOURCE_TYPES.includes(sourceType as DiscoverySourceType)) {
    res.status(400).json({ error: `sourceType must be one of: ${SOURCE_TYPES.join(', ')}` });
    return;
  }
  if (!title || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (!content || !content.trim()) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO discovery_sources (id, source_type, title, content, origin, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)
  `).run(id, sourceType, title.trim(), content, req.user?.id ?? null, now, now);

  logger.info(`Added discovery source ${id} (${sourceType}): ${title}`);
  const row = db.prepare('SELECT * FROM discovery_sources WHERE id = ?').get(id) as SourceRow;
  res.status(201).json({ source: mapSourceRow(row) });
});

/**
 * DELETE /api/discovery/sources/:id — remove a source document (cascades opportunity-source links).
 */
discoveryRoutes.delete('/sources/:id', (req: AuthRequest, res: Response) => {
  if (!canMutate(req.user)) {
    res.status(403).json({ error: 'View-only users cannot delete discovery sources', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM discovery_sources WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }
  db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(id);
  logger.info(`Deleted discovery source ${id}`);
  res.json({ ok: true });
});

interface OpportunityRow {
  id: number;
  run_id: string;
  title: string;
  description: string;
  rationale: string;
  confidence: number | null;
  evidence: string;
  status: DiscoveryOpportunityStatus;
  promoted_item_id: string | null;
  reviewed_at: number | null;
  created_at: number;
}

function mapOpportunityRow(row: OpportunityRow): DiscoveryOpportunity {
  let evidence: DiscoveryOpportunity['evidence'] = [];
  try { evidence = JSON.parse(row.evidence); } catch { /* malformed evidence, default to empty */ }
  return {
    id: row.id,
    runId: row.run_id,
    title: row.title,
    description: row.description,
    rationale: row.rationale,
    confidence: row.confidence ?? undefined,
    evidence,
    status: row.status,
    promotedItemId: row.promoted_item_id ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * POST /api/discovery/run — run Scout over the given source documents and persist
 * the resulting opportunities as a new discovery_runs + discovery_opportunities batch.
 */
discoveryRoutes.post('/run', async (req: AuthRequest, res: Response) => {
  if (!canLaunchWorkflow(req.user)) {
    res.status(403).json({ error: 'Only Product or Admin users can run discovery', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  const { sourceIds } = req.body as { sourceIds?: string[] };
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    res.status(400).json({ error: 'sourceIds must be a non-empty array' });
    return;
  }

  const runId = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO discovery_runs (id, status, source_ids, triggered_by, created_at)
    VALUES (?, 'running', ?, ?, ?)
  `).run(runId, JSON.stringify(sourceIds), req.user?.id ?? null, now);

  try {
    const drafts = await runDiscovery(sourceIds);
    const validSourceIds = new Set(sourceIds);

    const persist = db.transaction(() => {
      for (const draft of drafts) {
        const result = db.prepare(`
          INSERT INTO discovery_opportunities (run_id, title, description, rationale, confidence, evidence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(runId, draft.title, draft.description, draft.rationale, draft.confidence ?? null, JSON.stringify(draft.evidence), Date.now());
        const opportunityId = result.lastInsertRowid as number;

        for (const evidence of draft.evidence) {
          // The model can hallucinate a sourceId that doesn't match a real row — validate
          // against the sources actually fed into this run rather than trusting its output.
          if (!evidence.sourceId || !validSourceIds.has(evidence.sourceId)) continue;
          db.prepare(`
            INSERT OR IGNORE INTO discovery_opportunity_sources (opportunity_id, source_id) VALUES (?, ?)
          `).run(opportunityId, evidence.sourceId);
        }
      }
      db.prepare(`UPDATE discovery_runs SET status = 'complete', opportunity_count = ?, completed_at = ? WHERE id = ?`)
        .run(drafts.length, Date.now(), runId);
    });
    persist();

    logger.info(`Discovery run ${runId} complete: ${drafts.length} opportunity(ies)`);
    const rows = db.prepare('SELECT * FROM discovery_opportunities WHERE run_id = ? ORDER BY id ASC').all(runId) as OpportunityRow[];
    res.json({ runId, opportunities: rows.map(mapOpportunityRow) });
  } catch (error: any) {
    logger.error(`Discovery run ${runId} failed`, error);
    db.prepare(`UPDATE discovery_runs SET status = 'error', error = ?, completed_at = ? WHERE id = ?`)
      .run(error.message ?? 'Unknown error', Date.now(), runId);
    res.status(500).json({ error: error.message || 'Discovery run failed' });
  }
});

/**
 * GET /api/discovery/opportunities — list opportunities, newest first, optionally filtered by status.
 */
discoveryRoutes.get('/opportunities', (req: AuthRequest, res: Response) => {
  const { status } = req.query as { status?: string };
  let rows: OpportunityRow[];
  if (status) {
    if (!OPPORTUNITY_STATUSES.includes(status as DiscoveryOpportunityStatus)) {
      res.status(400).json({ error: `status must be one of: ${OPPORTUNITY_STATUSES.join(', ')}` });
      return;
    }
    rows = db.prepare('SELECT * FROM discovery_opportunities WHERE status = ? ORDER BY created_at DESC').all(status) as OpportunityRow[];
  } else {
    rows = db.prepare('SELECT * FROM discovery_opportunities ORDER BY created_at DESC').all() as OpportunityRow[];
  }
  res.json({ opportunities: rows.map(mapOpportunityRow) });
});

/**
 * POST /api/discovery/opportunities/:id/dismiss — PM passes on an opportunity.
 */
discoveryRoutes.post('/opportunities/:id/dismiss', (req: AuthRequest, res: Response) => {
  if (!canMutate(req.user)) {
    res.status(403).json({ error: 'View-only users cannot dismiss opportunities', code: 'INSUFFICIENT_ROLE' });
    return;
  }

  const { id } = req.params;
  const opportunity = db.prepare('SELECT id, status FROM discovery_opportunities WHERE id = ?').get(id) as { id: number; status: string } | undefined;
  if (!opportunity) {
    res.status(404).json({ error: 'Opportunity not found' });
    return;
  }
  if (opportunity.status === 'promoted') {
    res.status(400).json({ error: 'Cannot dismiss an opportunity that has already been promoted' });
    return;
  }

  db.prepare(`UPDATE discovery_opportunities SET status = 'dismissed', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(req.user?.id ?? null, Date.now(), id);
  logger.info(`Dismissed discovery opportunity ${id}`);
  res.json({ ok: true });
});

/**
 * POST /api/discovery/opportunities/:id/promote — create a new Airtable record for this
 * opportunity, then a local "shadow item" pointing at it, exactly mirroring the existing
 * Airtable-synced-item shape (source='airtable', id === airtable_id) so the promoted idea
 * flows into the standard LaunchPipelineModal flow unchanged.
 */
discoveryRoutes.post('/opportunities/:id/promote', async (req: AuthRequest, res: Response) => {
  if (!canLaunchWorkflow(req.user)) {
    res.status(403).json({ error: 'Only Product or Admin users can promote an opportunity', code: 'INSUFFICIENT_ROLE' });
    return;
  }
  if (appConfig.integrations.roadmap !== 'airtable') {
    res.status(400).json({ error: 'Airtable roadmap integration is not configured — promotion requires it' });
    return;
  }

  const { id } = req.params;
  const opportunity = db.prepare('SELECT * FROM discovery_opportunities WHERE id = ?').get(id) as OpportunityRow | undefined;
  if (!opportunity) {
    res.status(404).json({ error: 'Opportunity not found' });
    return;
  }
  if (opportunity.status === 'promoted') {
    res.status(400).json({ error: 'Opportunity has already been promoted', itemId: opportunity.promoted_item_id });
    return;
  }

  let airtableItem: AirtableItem;
  try {
    airtableItem = await getAirtableClient().createItem({
      initiative: opportunity.title,
      description: opportunity.description,
      status: 'Discovery',
      confidence: opportunity.confidence ?? 0.5,
      notes: opportunity.rationale,
    });
  } catch (error: any) {
    logger.error(`Failed to create Airtable record for opportunity ${id}`, error);
    res.status(502).json({ error: error.message || 'Failed to create Airtable record' });
    return;
  }

  const now = Date.now();
  try {
    db.prepare(`
      INSERT INTO items (id, type, title, description, status, source, airtable_id, seq_num, created_at, updated_at)
      VALUES (?, 'initiative', ?, ?, 'active', 'airtable', ?, ?, ?, ?)
    `).run(airtableItem.id, opportunity.title, opportunity.description, airtableItem.id, nextItemSeqNum(), now, now);
  } catch (error: any) {
    // Airtable record now exists with no local tracking row — rare, logged loudly for manual reconciliation
    // rather than building saga/compensation logic for what should be an unlikely failure.
    logger.error(`Orphaned Airtable record ${airtableItem.id}: local item insert failed for opportunity ${id}`, error);
    res.status(500).json({ error: 'Airtable record created but local item creation failed', airtableId: airtableItem.id });
    return;
  }

  db.prepare(`UPDATE discovery_opportunities SET status = 'promoted', promoted_item_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(airtableItem.id, req.user?.id ?? null, now, id);

  logger.info(`Promoted discovery opportunity ${id} -> item/Airtable record ${airtableItem.id}`);
  res.json({ itemId: airtableItem.id, airtableId: airtableItem.id });
});
