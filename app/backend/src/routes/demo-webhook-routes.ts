import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import { DATA_DIR } from '../data/database';
import { createWorkflow, advanceStage } from '../agents/workflow-router';
import { runDemoScript, getDemoProjectPath } from '../demo/demo-runner';
import { getArtifactCollection } from '../data/mongo-client';
import { ObjectId } from 'mongodb';
import Logger from '../utils/logger';

const logger = new Logger('DEMO-WEBHOOK');
export const demoWebhookRoutes = Router();

const WEBHOOK_SAMPLES = [
  {
    title: 'In-App Messaging & Trade Chat — TradeEasy',
    description: `Add a real-time in-app messaging feature so users can discuss trades and market ideas within the TradeEasy app.

Who it's for: Active retail traders (ages 22–40) who currently use external chats (Discord, WhatsApp groups) to share trade ideas and miss the opportunity to act immediately.

Core problem: Users switch between TradeEasy and external messaging apps to share trade setups. The context-switching leads to missed execution windows and increases app abandonment. There is no way to share a specific ticker or open position directly into a conversation.

Key outcomes:
- Users can create and join topic-based chat rooms (e.g. "AAPL watchers")
- Share a live ticker card directly from the instrument page into any chat
- Message latency under 500ms at peak load (market open)

Scope: MVP — text messages and ticker-card sharing only. No voice, no DMs. iOS and Android.

Constraints:
- Messages must be retained for 7 years (MiFID II record-keeping requirement)
- Content moderation required before public launch (hate speech, pump-and-dump signals)
- Team: 2 iOS, 2 Android, 2 backend, 1 compliance liaison`,
  },
  {
    title: 'Onboarding Redesign — TradeEasy',
    description: `Redesign the new user onboarding flow to reduce drop-off and improve time-to-first-trade.

Who it's for: New retail investors (ages 22–35) signing up for TradeEasy for the first time. Many are first-time investors unfamiliar with trading terminology.

Core problem: Current 14-step KYC + account setup flow has a 68% drop-off rate. Users abandon most often at document upload (step 7) and risk questionnaire (step 11). Competitors complete onboarding in under 5 minutes.

Key outcomes:
- Reduce onboarding drop-off from 68% to under 40%
- Achieve time-to-first-trade under 8 minutes for 70% of completions
- Increase completion of the risk questionnaire by 50%

Scope: MVP — iOS and Android. Redesign steps 1–12 only. Backend KYC provider unchanged.

Constraints:
- Regulatory KYC requirements cannot be skipped or reordered
- Must support 12 languages at launch
- Team: 1 iOS, 1 Android, 1 backend, 1 UX designer`,
  },
  {
    title: 'Portfolio Analytics Dashboard — TradeEasy',
    description: `Build a portfolio performance analytics view that helps users understand their returns and risk exposure.

Who it's for: Intermediate retail investors (ages 30–50) with portfolios of 5+ holdings who want to track performance beyond simple P&L.

Core problem: The current portfolio view shows only unrealised P&L and position size. Users can't see realised returns, compare against benchmarks, or understand concentration risk — so they export to Excel for analysis.

Key outcomes:
- Show time-weighted return (TWR) vs benchmark (S&P 500 / custom)
- Visualise sector and geography concentration
- Export report as PDF for sharing with advisors

Scope: MVP — web only. Historical data for the past 3 years. Equities and ETFs only.

Constraints:
- TWR calculation must match brokerage statement to 2 decimal places
- Data latency acceptable at T+1 (end of day)
- Team: 2 frontend, 1 backend, 1 data engineer`,
  },
  {
    title: 'Social Trading & Copy Features — TradeEasy',
    description: `Allow users to follow top traders and optionally auto-copy their trades in real time.

Who it's for: Novice investors (ages 20–30) who want market exposure but lack confidence to pick stocks themselves. They follow finance influencers on social media.

Core problem: Users want to invest but don't know where to start. Competitor apps with copy-trading features see 2.5× higher retention among novice cohorts. TradeEasy has no social layer.

Key outcomes:
- Users can browse and follow verified top traders
- Optional auto-copy with configurable allocation cap (e.g. max 10% portfolio per trader)
- Followed traders earn a fee share from copy profits

Scope: MVP — view and manual-copy only. Auto-copy deferred to Phase 2. iOS and Android.

Constraints:
- Regulatory approval required before auto-copy goes live (FCA)
- Trader verification requires 6-month performance history minimum
- Team: 2 iOS, 2 Android, 2 backend, 1 compliance liaison`,
  },
];

let sampleIndex = 0;
let demoTriggerLock = Promise.resolve();

async function withDemoTriggerLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = demoTriggerLock;
  demoTriggerLock = new Promise<void>(resolve => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ── Demo run cleanup ──────────────────────────────────────────────────────────

/**
 * Find all items created by previous demo runs (workflows with demo_auto_approve policy).
 * Delete their external resources (wiki pages, ADO work items, ADO test plans),
 * then remove all local DB rows and disk files.
 *
 * Called at the start of each new demo trigger so Azure stays clean.
 * Errors are caught per-resource — one failure doesn't abort the rest.
 */
async function cleanupPreviousDemoRuns(): Promise<void> {
  // Find all items that were created by a demo webhook run
  const demoItems = db.prepare<[], { item_id: string }>(`
    SELECT DISTINCT w.item_id
    FROM workflows w
    WHERE w.policy_overrides LIKE '%demo_mode%' OR w.policy_overrides LIKE '%demo_auto_approve%'
  `).all();

  if (demoItems.length === 0) {
    logger.info('[DEMO CLEANUP] No previous demo runs found');
    return;
  }

  logger.info(`[DEMO CLEANUP] Cleaning up ${demoItems.length} previous demo item(s)...`);

  const { appConfig } = require('../config/app-config');
  const adoEnabled = appConfig.integrations.workItems === 'ado';

  for (const { item_id: itemId } of demoItems) {
    try {
      // ── Collect external resource IDs before deleting DB rows ──────────────

      // Wiki artifact paths (analyst, pm_prd, solution_architect, prototype)
      const wikiPaths = db.prepare<[string], { external_path: string }>(
        `SELECT DISTINCT a.external_path
         FROM artifacts a JOIN sessions s ON a.session_id = s.id
         WHERE s.item_id = ? AND a.external_system = 'azure_wiki' AND a.external_path IS NOT NULL`
      ).all(itemId).map(r => r.external_path);

      // MongoDB artifact IDs — collected before SQLite rows are deleted
      const mongoIds = db.prepare<[string], { external_path: string }>(
        `SELECT DISTINCT a.external_path
         FROM artifacts a JOIN sessions s ON a.session_id = s.id
         WHERE s.item_id = ? AND a.external_system = 'mongodb' AND a.external_path IS NOT NULL`
      ).all(itemId).map(r => r.external_path);

      // ADO work item IDs — delete children before parents (stories → features → epic)
      // so ADO doesn't reject the parent delete due to existing children.
      const adoWorkItemIds = db.prepare<[string], { ado_id: number }>(
        `SELECT ado_id FROM ado_work_item_map
         WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)
         ORDER BY CASE ado_type WHEN 'story' THEN 1 WHEN 'feature' THEN 2 ELSE 3 END`
      ).all(itemId).map(r => r.ado_id);

      // ADO test plan IDs (from qa_test_plan_map)
      const adoTestPlanIds = db.prepare<[string], { plan_id: number }>(
        `SELECT plan_id FROM qa_test_plan_map
         WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`
      ).all(itemId).map(r => r.plan_id);

      // ── Delete external resources ──────────────────────────────────────────

      if (adoEnabled && (wikiPaths.length > 0 || adoWorkItemIds.length > 0 || adoTestPlanIds.length > 0)) {
        try {
          const { AzureDevOpsClient } = require('../integrations/azure-devops');
          const { deleteFromWiki } = require('../integrations/document-store/azure-wiki-store');
          const client = new AzureDevOpsClient();

          // Delete wiki pages (individual pages, then the feature folder placeholder)
          for (const wikiPath of wikiPaths) {
            await deleteFromWiki(wikiPath).catch((e: Error) =>
              logger.warn(`[DEMO CLEANUP] Wiki page delete failed (${wikiPath}): ${e.message}`)
            );
          }
          // Delete the parent feature folder (e.g. /Product Documentation/Features/{title})
          // Best-effort — ADO will refuse if it still has children, which is fine
          if (wikiPaths.length > 0) {
            const parentPath = wikiPaths[0].split('/').slice(0, -1).join('/');
            if (parentPath) {
              await deleteFromWiki(parentPath).catch(() => { /* folder may have children — ignore */ });
            }
          }

          // Delete ADO work items (epic, features, stories)
          if (adoWorkItemIds.length > 0) {
            await client.deleteWorkItems(adoWorkItemIds).catch((e: Error) =>
              logger.warn(`[DEMO CLEANUP] Work item delete failed: ${e.message}`)
            );
          }

          // Delete ADO test plans
          for (const planId of adoTestPlanIds) {
            await client.deleteTestPlan(planId).catch((e: Error) =>
              logger.warn(`[DEMO CLEANUP] Test plan delete failed (#${planId}): ${e.message}`)
            );
          }
        } catch (externalErr: any) {
          logger.warn(`[DEMO CLEANUP] External cleanup error for item ${itemId}: ${externalErr.message}`);
        }
      }

      // ── Delete MongoDB artifact documents ─────────────────────────────────
      if (mongoIds.length > 0) {
        try {
          const col = await getArtifactCollection();
          if (col) {
            await col.deleteMany({ _id: { $in: mongoIds.map(id => new ObjectId(id)) } });
            logger.info(`[DEMO CLEANUP] Deleted ${mongoIds.length} MongoDB artifact(s) for item ${itemId}`);
          }
        } catch (mongoErr: any) {
          logger.warn(`[DEMO CLEANUP] MongoDB cleanup failed for item ${itemId}: ${mongoErr.message}`);
        }
      }

      // ── Delete local disk files ────────────────────────────────────────────
      const sessionDir = path.join(DATA_DIR, 'sessions', itemId);
      if (fs.existsSync(sessionDir)) {
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }

      // ── Delete local DB rows in FK-safe order ─────────────────────────────
      db.transaction(() => {
        db.prepare(`DELETE FROM cr_artifact_versions WHERE change_request_id IN (SELECT id FROM change_requests WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?))`).run(itemId);
        db.prepare(`DELETE FROM qa_test_plan_map WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM change_requests WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM context_diffs WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM checkpoint_audit WHERE checkpoint_id IN (SELECT id FROM checkpoints WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?))`).run(itemId);
        db.prepare(`DELETE FROM checkpoints WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM workflows WHERE item_id = ?`).run(itemId);
        db.prepare(`DELETE FROM context_change_proposals WHERE session_id IN (SELECT id FROM sessions WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM artifacts WHERE session_id IN (SELECT id FROM sessions WHERE item_id = ?)`).run(itemId);
        db.prepare(`DELETE FROM sessions WHERE item_id = ?`).run(itemId);
        db.prepare(`DELETE FROM items WHERE id = ?`).run(itemId);
      })();

      logger.info(`[DEMO CLEANUP] Cleaned item ${itemId} (wiki: ${wikiPaths.length}, ado_items: ${adoWorkItemIds.length}, test_plans: ${adoTestPlanIds.length})`);
    } catch (itemErr: any) {
      logger.error(`[DEMO CLEANUP] Failed to clean item ${itemId}: ${itemErr.message}`);
    }
  }

  logger.info('[DEMO CLEANUP] Complete');
}

// Demo webhook stage sequence. story_decomposition_F1/F2/F3 run multi-agent refinement per feature;
// they are injected at workflow execution time based on the epic_feature_planner output feature count.
const CORE_STAGES = ['analyst', 'pm_prd', 'prototype', 'figma_design', 'solution_architect', 'epic_feature_planner', 'story_decomposition_F1', 'story_decomposition_F2', 'story_decomposition_F3'];

function buildDemoStages(): string[] {
  return [...CORE_STAGES, 'curator'];
}

/**
 * POST /api/demo/webhook/trigger
 *
 * Simulates an Airtable webhook event: creates a new initiative and
 * immediately kicks off the full workflow pipeline without any human
 * confirmation step. Cycles through pre-defined sample initiatives so
 * multiple triggers produce distinct parallel workflows.
 */
demoWebhookRoutes.post('/demo/webhook/trigger', async (req: Request, res: Response) => {
  try {
    return await withDemoTriggerLock(async () => {
      // Clean up all resources from previous demo runs before starting a new one.
      // The lock prevents two trigger requests from creating overlapping demo runs.
      await cleanupPreviousDemoRuns();

      // If forceIndex is provided, use that sample; otherwise cycle through all four
      const forceIndex = req.body?.forceIndex;
      const sample = typeof forceIndex === 'number'
        ? WEBHOOK_SAMPLES[forceIndex % WEBHOOK_SAMPLES.length]
        : WEBHOOK_SAMPLES[sampleIndex % WEBHOOK_SAMPLES.length];
      if (typeof forceIndex !== 'number') sampleIndex++;

      const itemId = `item-${uuidv4()}`;
      const now = Date.now();

      // Create the initiative in the items table
      db.prepare(
        `INSERT INTO items (id, type, title, description, status, source, airtable_id, created_at, updated_at)
         VALUES (?, 'initiative', ?, ?, 'active', 'local', NULL, ?, ?)`
      ).run(itemId, sample.title, sample.description, now, now);

      // Build goal string (same format as manual launch path)
      const goal = `${sample.title}\n\n${sample.description}`;

      // Create workflow and kick off first stage
      // NOTE: demo_mode flag identifies demo workflows for cleanup, but does NOT auto-approve checkpoints
      // Human review stages are enabled — user must manually approve each checkpoint
      const stages = buildDemoStages();
      const workflow = createWorkflow(itemId, goal, stages, { demo_mode: 'true' });

      // When the workflow completes, run Claude Code CLI on the tradeeasy-demo repo
      // to implement the feature on a fresh branch and run Playwright tests.
      // Gated by DEMO_CODE_PIPELINE_ENABLED=true so core-flow testing skips this.
      if (process.env.DEMO_CODE_PIPELINE_ENABLED === 'true' && getDemoProjectPath()) {
        const pollAndRun = () => {
          const wf = db.prepare('SELECT status FROM workflows WHERE id = ?').get(workflow.id) as any;
          if (wf?.status === 'complete') {
            runDemoScript(workflow.id).catch((err: Error) =>
              logger.error(`Demo runner failed for ${workflow.id}: ${err.message}`)
            );
          } else if (wf?.status !== 'failed') {
            setTimeout(pollAndRun, 10_000);
          }
        };
        setTimeout(pollAndRun, 30_000);
      }

      advanceStage(workflow.id).catch((err: Error) =>
        logger.error(`advanceStage failed for demo webhook workflow ${workflow.id}`, err)
      );

      logger.info(`Demo webhook: created initiative "${sample.title}" → workflow ${workflow.id} [stages: ${stages.join(', ')}]`);

      return res.json({
        workflowId: workflow.id,
        itemId,
        initiative: sample.title,
        stages,
      });
    });
  } catch (err: any) {
    logger.error('Demo webhook trigger failed', err);
    return res.status(500).json({ error: err.message });
  }
});
