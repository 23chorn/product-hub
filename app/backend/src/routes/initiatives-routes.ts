import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../data/database';
import Logger from '../utils/logger';
import { parseRoles } from '../agents/workflow-db';
import { isDemoWorkflow } from '../demo/demo-mode';
import { itemSessionDir, nextItemSeqNum } from '../agents/item-metadata';
import type { AirtableItem, LocalInitiative } from '@pap/shared';

const logger = new Logger('INITIATIVES');
const router = Router();

interface InitiativeRow {
  id: string;
  title: string;
  description: string | null;
  source: string;
  metadata: string | null;
  seq_num: number | null;
  created_at: number;
  updated_at: number;
}

function toAirtableItem(row: InitiativeRow): AirtableItem {
  const base: AirtableItem = {
    id: row.id,
    initiative: row.title,
    description: row.description ?? '',
    status: 'Ready',
    businessValue: 5,
    priorityScore: 5,
    estimate: 'M',
    confidence: 0.8,
    createdAt: new Date(row.created_at).toISOString(),
    seqNum: row.seq_num,
  };
  if (row.source === 'airtable' && row.metadata) {
    try {
      const meta = JSON.parse(row.metadata);
      // seqNum is DB-internal — never let synced Airtable metadata shadow it.
      return { ...base, ...meta, seqNum: row.seq_num };
    } catch { /* ignore malformed metadata */ }
  }
  return base;
}

function toLocalInitiative(row: InitiativeRow): LocalInitiative {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const stmts = {
  list: db.prepare(
    `SELECT id, title, description, source, metadata, seq_num, created_at, updated_at FROM items
     WHERE source IN ('local', 'airtable') AND status != 'archived' ORDER BY created_at DESC`
  ),
  get: db.prepare(
    `SELECT id, title, description, source, metadata, seq_num, created_at, updated_at FROM items
     WHERE id = ? AND source = 'local'`
  ),
  insert: db.prepare(
    `INSERT INTO items (id, type, title, description, status, source, airtable_id, seq_num, created_at, updated_at)
     VALUES (?, 'initiative', ?, ?, 'active', 'local', NULL, ?, ?, ?)`
  ),
  update: db.prepare(
    `UPDATE items SET title = ?, description = ?, updated_at = ?
     WHERE id = ? AND source = 'local'`
  ),
  delete: db.prepare(
    `DELETE FROM items WHERE id = ? AND source = 'local'`
  ),
  getSessions: db.prepare(
    `SELECT id FROM sessions WHERE item_id = ?`
  ),
};

/**
 * GET /api/initiatives
 * List all local initiatives enriched with latest workflow status.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = stmts.list.all() as InitiativeRow[];

    // Batch-fetch latest workflow per item
    const workflowMap = new Map<string, { id: string; status: string; current_stage: string | null; summary: string | null; policy_overrides: string; updated_at: number }>();
    const wfRows: { item_id: string; id: string; status: string; current_stage: string | null; summary: string | null; policy_overrides: string; updated_at: number }[] = rows.length > 0
      ? db.prepare(`
          SELECT w.item_id, w.id, w.status, w.current_stage, w.summary, w.policy_overrides, w.updated_at
          FROM workflows w
          INNER JOIN (
            SELECT item_id, MAX(created_at) as max_created
            FROM workflows GROUP BY item_id
          ) latest ON w.item_id = latest.item_id AND w.created_at = latest.max_created
          WHERE w.item_id IN (${rows.map(() => '?').join(',')})
        `).all(...rows.map(r => r.id)) as typeof wfRows
      : [];
    for (const wf of wfRows) workflowMap.set(wf.item_id, wf);

    const pendingStageMap = new Map<string, string>();
    const pendingApprovalsMap = new Map<string, Array<{ stage: string; roles: string[] }>>();
    if (wfRows.length > 0) {
      const pendingRows = db.prepare(`
        SELECT workflow_id, stage, required_role
        FROM checkpoints
        WHERE status = 'pending' AND workflow_id IN (${wfRows.map(() => '?').join(',')})
        ORDER BY created_at ASC
      `).all(...wfRows.map(w => w.id)) as { workflow_id: string; stage: string; required_role: string | null }[];
      for (const cp of pendingRows) {
        // Most recently created pending checkpoint wins for the single-stage label
        pendingStageMap.set(cp.workflow_id, cp.stage);
        const approvals = pendingApprovalsMap.get(cp.workflow_id) ?? [];
        // A stage can have multiple pending checkpoints (one per feature) — collapse
        // them to a single badge per stage since required roles are stage-derived.
        if (!approvals.some(a => a.stage === cp.stage)) {
          approvals.push({ stage: cp.stage, roles: parseRoles(cp.required_role) });
        }
        pendingApprovalsMap.set(cp.workflow_id, approvals);
      }
    }

    // Batch-fetch latest pipeline run status per workflow
    const workflowIds = wfRows.map(w => w.id);
    const pipelineMap = new Map<string, string>();
    const cancelledSet = new Set<string>();
    if (workflowIds.length > 0) {
      const prRows = db.prepare(`
        SELECT pr.workflow_id, pr.status
        FROM pipeline_runs pr
        INNER JOIN (
          SELECT workflow_id, MAX(created_at) as max_created
          FROM pipeline_runs GROUP BY workflow_id
        ) latest ON pr.workflow_id = latest.workflow_id AND pr.created_at = latest.max_created
        WHERE pr.workflow_id IN (${workflowIds.map(() => '?').join(',')})
      `).all(...workflowIds) as { workflow_id: string; status: string }[];
      for (const pr of prRows) pipelineMap.set(pr.workflow_id, pr.status);

      // Detect cancelled workflows: complete status + a workflow_cancelled event
      const cancelledRows = db.prepare(`
        SELECT DISTINCT workflow_id FROM workflow_events
        WHERE workflow_id IN (${workflowIds.map(() => '?').join(',')})
          AND event_type = 'workflow_cancelled'
      `).all(...workflowIds) as { workflow_id: string }[];
      for (const r of cancelledRows) cancelledSet.add(r.workflow_id);
    }

    const items = rows.map(r => {
      const wf = workflowMap.get(r.id);
      const pipelineStatus = wf ? pipelineMap.get(wf.id) : undefined;
      const isCancelled = wf ? cancelledSet.has(wf.id) : false;
      const pendingStage = wf ? pendingStageMap.get(wf.id) ?? null : null;
      const pendingApprovals = wf ? pendingApprovalsMap.get(wf.id) ?? [] : [];
      const isDemo = isDemoWorkflow(wf?.policy_overrides);
      return {
        ...toAirtableItem(r),
        source: r.source,
        workflow: wf ? { id: wf.id, status: wf.status, currentStage: wf.current_stage, summary: wf.summary, pipelineStatus, isCancelled, isDemo, pendingStage, pendingApprovals, updatedAt: wf.updated_at } : undefined,
      };
    });

    res.json(items);
  } catch (error: any) {
    logger.error('Failed to list initiatives', error);
    res.status(500).json({ error: error.message || 'Failed to list initiatives' });
  }
});

/**
 * GET /api/initiatives/:id
 * Get a single local initiative.
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const row = stmts.get.get(req.params.id) as InitiativeRow | undefined;
    if (!row) return res.status(404).json({ error: 'Initiative not found' });
    res.json(toLocalInitiative(row));
  } catch (error: any) {
    logger.error('Failed to get initiative', error);
    res.status(500).json({ error: error.message || 'Failed to get initiative' });
  }
});

/**
 * POST /api/initiatives
 * Create a new local initiative.
 * Body: { title: string, description?: string }
 */
router.post('/', (req: Request, res: Response) => {
  const { title, description } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const id = uuidv4();
    const now = Date.now();
    stmts.insert.run(id, title.trim(), description?.trim() || null, nextItemSeqNum(), now, now);
    const row = stmts.get.get(id) as InitiativeRow;
    logger.info(`Created local initiative: ${id} ("${title.trim()}")`);
    res.status(201).json(toLocalInitiative(row));
  } catch (error: any) {
    logger.error('Failed to create initiative', error);
    res.status(500).json({ error: error.message || 'Failed to create initiative' });
  }
});

/**
 * PATCH /api/initiatives/:id
 * Update title and/or description.
 * Body: { title?: string, description?: string }
 */
router.patch('/:id', (req: Request, res: Response) => {
  const row = stmts.get.get(req.params.id) as InitiativeRow | undefined;
  if (!row) return res.status(404).json({ error: 'Initiative not found' });

  const title = req.body.title !== undefined ? req.body.title.trim() : row.title;
  const description = req.body.description !== undefined
    ? (req.body.description.trim() || null)
    : row.description;

  if (!title) return res.status(400).json({ error: 'title cannot be empty' });

  try {
    const now = Date.now();
    stmts.update.run(title, description, now, req.params.id);
    const updated = stmts.get.get(req.params.id) as InitiativeRow;
    res.json(toLocalInitiative(updated));
  } catch (error: any) {
    logger.error('Failed to update initiative', error);
    res.status(500).json({ error: error.message || 'Failed to update initiative' });
  }
});

/**
 * DELETE /api/initiatives/:id
 * Delete a local initiative and all associated sessions/workflows/files.
 * If the item was created by a demo workflow, clean up external ADO resources first.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const row = stmts.get.get(id) as InitiativeRow | undefined;
  if (!row) return res.status(404).json({ error: 'Initiative not found' });

  try {
    const sessions = stmts.getSessions.all(id) as { id: string }[];

    // ── Check if this is a demo item ───────────────────────────────────────
    const isDemo = db.prepare<[string], { count: number }>(
      `SELECT COUNT(*) as count FROM workflows
       WHERE item_id = ? AND (policy_overrides LIKE '%demo_mode%' OR policy_overrides LIKE '%demo_auto_approve%')`
    ).get(id);

    // ── Clean up external resources if demo item ───────────────────────────
    if (isDemo && isDemo.count > 0) {
      logger.info(`[INITIATIVE DELETE] Item ${id} is a demo — cleaning external resources`);

      const { appConfig } = require('../config/app-config');
      const adoEnabled = appConfig.integrations.workItems === 'ado';

      if (adoEnabled) {
        try {
          // Collect external resource IDs before deleting DB rows
          const fs = await import('fs');
          const path = await import('path');

          // Wiki artifact paths (analyst, pm_prd, solution_architect, prototype)
          const wikiPaths = db.prepare<[string], { wiki_path: string }>(
            `SELECT DISTINCT a.wiki_path
             FROM artifacts a JOIN sessions s ON a.session_id = s.id
             WHERE s.item_id = ? AND a.wiki_path IS NOT NULL`
          ).all(id).map(r => r.wiki_path);

          // ADO work item IDs — delete children before parents (stories → features → epic)
          const adoWorkItemIds = db.prepare<[string], { ado_id: number }>(
            `SELECT ado_id FROM ado_work_item_map
             WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)
             ORDER BY CASE ado_type WHEN 'story' THEN 1 WHEN 'feature' THEN 2 ELSE 3 END`
          ).all(id).map(r => r.ado_id);

          // ADO test plan IDs (from qa_test_plan_map)
          const adoTestPlanIds = db.prepare<[string], { plan_id: number }>(
            `SELECT plan_id FROM qa_test_plan_map
             WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`
          ).all(id).map(r => r.plan_id);

          // Delete external resources
          if (wikiPaths.length > 0 || adoWorkItemIds.length > 0 || adoTestPlanIds.length > 0) {
            const { getAzureDevOpsClient } = require('../integrations/azure-devops');
            const { deleteFromWiki } = require('../integrations/document-store/azure-wiki-store');
            const client = getAzureDevOpsClient();

            // Delete wiki pages (individual pages, then the feature folder placeholder)
            for (const wikiPath of wikiPaths) {
              await deleteFromWiki(wikiPath).catch((e: Error) =>
                logger.warn(`[INITIATIVE DELETE] Wiki page delete failed (${wikiPath}): ${e.message}`)
              );
            }
            // Delete the parent feature folder (best-effort)
            if (wikiPaths.length > 0) {
              const parentPath = wikiPaths[0].split('/').slice(0, -1).join('/');
              if (parentPath) {
                await deleteFromWiki(parentPath).catch(() => { /* folder may have children — ignore */ });
              }
            }

            // Delete ADO work items (epic, features, stories)
            if (adoWorkItemIds.length > 0) {
              await client.deleteWorkItems(adoWorkItemIds).catch((e: Error) =>
                logger.warn(`[INITIATIVE DELETE] Work item delete failed: ${e.message}`)
              );
            }

            // Delete ADO test plans
            for (const planId of adoTestPlanIds) {
              await client.deleteTestPlan(planId).catch((e: Error) =>
                logger.warn(`[INITIATIVE DELETE] Test plan delete failed (#${planId}): ${e.message}`)
              );
            }

            logger.info(`[INITIATIVE DELETE] Cleaned external resources (wiki: ${wikiPaths.length}, ado_items: ${adoWorkItemIds.length}, test_plans: ${adoTestPlanIds.length})`);
          }
        } catch (externalErr: any) {
          logger.warn(`[INITIATIVE DELETE] External cleanup error for item ${id}: ${externalErr.message}`);
        }
      }
    }

    // ── Delete session directory from disk ─────────────────────────────────
    const fs = await import('fs');
    const sessionDir = itemSessionDir(id);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    // ── Delete local DB rows in FK-safe order ──────────────────────────────
    // Tables that CASCADE from workflows (workflow_events, coordinator_sessions,
    // workflow_skill_assignments, pipeline_runs) are deleted automatically.
    // checkpoint_audit points at checkpoints and must be removed before them.
    // Tables that CASCADE from sessions (messages, artifacts) are also deleted automatically.
    // Everything else must be deleted explicitly in dependency order.
    db.transaction(() => {
      // cr_artifact_versions → change_requests + artifacts
      db.prepare(`DELETE FROM cr_artifact_versions WHERE change_request_id IN (SELECT id FROM change_requests WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?))`).run(id);
      // qa_test_plan_map + ado_work_item_map → workflows + artifacts
      db.prepare(`DELETE FROM qa_test_plan_map WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      // change_requests → workflows
      db.prepare(`DELETE FROM change_requests WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      // context_diffs → workflows
      db.prepare(`DELETE FROM context_diffs WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      // checkpoint_audit → checkpoints
      db.prepare(`DELETE FROM checkpoint_audit WHERE checkpoint_id IN (SELECT id FROM checkpoints WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?))`).run(id);
      // checkpoints → workflows + artifacts
      db.prepare(`DELETE FROM checkpoints WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(id);
      // workflows (CASCADE: workflow_events, coordinator_sessions, workflow_skill_assignments, pipeline_runs)
      db.prepare(`DELETE FROM workflows WHERE item_id = ?`).run(id);
      // context_change_proposals → sessions (no cascade)
      db.prepare(`DELETE FROM context_change_proposals WHERE session_id IN (SELECT id FROM sessions WHERE item_id = ?)`).run(id);
      // sessions (CASCADE: messages, artifacts)
      db.prepare(`DELETE FROM sessions WHERE item_id = ?`).run(id);
      stmts.delete.run(id);
    })();

    logger.info(`Deleted local initiative ${id} with ${sessions.length} session(s)`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete initiative', error);
    res.status(500).json({ error: error.message || 'Failed to delete initiative' });
  }
});

export default router;
