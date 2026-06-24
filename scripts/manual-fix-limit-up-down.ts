#!/usr/bin/env tsx
/**
 * One-off remediation for the "Limit Up & Down" workflow (58c2910a-3c08-4369-b09f-ec81530bd584).
 *
 * It restarted on 2026-06-23 before the ado_work_item_map-clearing fix landed in
 * restartWorkflow(), so 90 stale rows from the 2026-06-19 run were still present when
 * epic_feature_planner was approved — the fresh epic/feature push collided on the
 * ado_work_item_map UNIQUE(workflow_id, local_key) constraint and silently failed
 * (logger.error only, no workflow event). Separately, story_decomposition_F3 errored
 * out on a JSON truncation during synthesis and never reached a checkpoint.
 *
 * Steps: clear the stale local mapping, re-push the (already-approved) epic + features
 * to ADO now that the path is clear, then retry just F3 (F1/F2 are untouched — they
 * already have pending checkpoints awaiting human review).
 */
import dotenv from 'dotenv';
import path from 'path';
// Mirror app-config.ts's load — this script doesn't import that module, so .env
// would otherwise never get loaded and AZURE_DEVOPS_* env vars would be empty.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import db from '../app/backend/src/data/database';
import { insertEvent, stmts } from '../app/backend/src/agents/workflow-db';
import { pushEpicAndFeaturesToADO } from '../app/backend/src/agents/feature-decomposition';
import { runAutonomousStage, getCoordinator, SILENT_STAGES } from '../app/backend/src/agents/workflow-stage-runner';
import { stageProgressWorking } from '../app/backend/src/agents/stage-metadata';
import { sessionManager } from '../app/backend/src/session/session-manager';

const WORKFLOW_ID = '58c2910a-3c08-4369-b09f-ec81530bd584';

async function main() {
  const workflow = stmts.getWorkflow.get(WORKFLOW_ID);
  if (!workflow) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

  // ── Step 1: clear stale ado_work_item_map rows from the pre-restart (2026-06-19) run ──
  const deleted = db.prepare(`DELETE FROM ado_work_item_map WHERE workflow_id = ?`).run(WORKFLOW_ID);
  console.log(`[1/3] Cleared ${deleted.changes} stale ado_work_item_map row(s) for workflow ${WORKFLOW_ID}`);

  // ── Step 2: re-push epic + features now that the stale rows are gone ──
  console.log('[2/3] Pushing epic + features to ADO...');
  const result = await pushEpicAndFeaturesToADO(WORKFLOW_ID);
  const { getAzureDevOpsClient } = await import('../app/backend/src/integrations/azure-devops');
  const client = getAzureDevOpsClient();
  const epicUrl = client.getEpicUrl(result.epicId);

  const cp = db.prepare<[string], { id: number; artifact_id: number | null }>(
    `SELECT id, artifact_id FROM checkpoints WHERE workflow_id = ? AND stage = 'epic_feature_planner' AND status = 'approved' ORDER BY created_at DESC LIMIT 1`
  ).get(WORKFLOW_ID);
  if (cp?.artifact_id) {
    db.prepare('UPDATE artifacts SET external_url = ? WHERE id = ?').run(epicUrl, cp.artifact_id);
  }
  insertEvent(WORKFLOW_ID, 'ado_pushed', 'epic_feature_planner',
    `Epic & ${result.featureIds.length} features pushed to Azure DevOps`,
    { ado_url: epicUrl });
  console.log(`[2/3] Pushed epic #${result.epicId} (${epicUrl}) + ${result.featureIds.length} features`);

  // ── Step 3: retry story_decomposition_F3 only (F1/F2 keep their pending checkpoints) ──
  const stage = 'story_decomposition_F3';
  console.log(`[3/3] Retrying ${stage}...`);
  insertEvent(WORKFLOW_ID, 'stage_retried', stage, 'Stage manually retried by chris (manual remediation script)');
  insertEvent(WORKFLOW_ID, 'stage_progress', stage, stageProgressWorking(stage));

  db.prepare(`
    UPDATE checkpoints SET status = 'revised', resolved_at = ?
    WHERE workflow_id = ? AND (stage = ? OR stage = ?) AND status = 'pending'
  `).run(Date.now(), WORKFLOW_ID, stage, `${stage}_qa`);

  const brief = await getCoordinator().generateStageBrief(WORKFLOW_ID, stage);
  const session = sessionManager.createSpecialistSession(workflow.item_id, 'analyst', 'analyst');
  sessionManager.updateWorkflow(session.id, WORKFLOW_ID, brief);
  const shouldAutoApprove = SILENT_STAGES.has(stage);

  await runAutonomousStage(session.id, WORKFLOW_ID, stage, workflow.item_id, brief, shouldAutoApprove);
  console.log(`[3/3] ${stage} retry finished — check its checkpoint for the result`);
}

main()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });
