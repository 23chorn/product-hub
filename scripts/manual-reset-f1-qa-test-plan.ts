#!/usr/bin/env tsx
/**
 * One-off remediation for the "Limit Up & Down" workflow (58c2910a-3c08-4369-b09f-ec81530bd584).
 *
 * qa_test_plan_map is never cleared by restartWorkflow() (only ado_work_item_map is —
 * see scripts/manual-fix-limit-up-down.ts for that same gap's effect on the board push),
 * so test plan #12387 had silently accumulated test cases across several restarts and
 * feature-decomposition reshuffles (F1 through F10 at various points). When F1's QA
 * checkpoint was approved just now, its 15 fresh test cases were pushed into that same
 * stale plan instead of a clean one. The plan + all 138 leftover test cases were already
 * deleted via `node scripts/cleanup-ado-work-items.js --test-plan 12387`.
 *
 * Steps: drop the now-dangling qa_test_plan_map row, then push F1's already-approved
 * qa_tests artifact (#1016) into a brand-new plan.
 */
import dotenv from 'dotenv';
import path from 'path';
// Mirror app-config.ts's load — this script doesn't import that module, so .env
// would otherwise never get loaded and AZURE_DEVOPS_* env vars would be empty.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import db from '../app/backend/src/data/database';
import { insertEvent } from '../app/backend/src/agents/workflow-db';
import { loadArtifactContentById } from '../app/backend/src/agents/artifact-helpers';
import { getAzureDevOpsClient } from '../app/backend/src/integrations/azure-devops';

const WORKFLOW_ID = '58c2910a-3c08-4369-b09f-ec81530bd584';
const F1_QA_ARTIFACT_ID = 1016;
const STALE_PLAN_ID = 12387;

async function main() {
  // ── Step 1: drop the dangling qa_test_plan_map row pointing at the now-deleted plan ──
  const deleted = db.prepare(`DELETE FROM qa_test_plan_map WHERE workflow_id = ? AND plan_id = ?`)
    .run(WORKFLOW_ID, STALE_PLAN_ID);
  console.log(`[1/2] Cleared ${deleted.changes} stale qa_test_plan_map row(s) for workflow ${WORKFLOW_ID}`);

  // ── Step 2: push F1's already-approved test cases into a brand-new plan ──
  const raw = await loadArtifactContentById(F1_QA_ARTIFACT_ID);
  if (!raw) throw new Error(`Could not load artifact ${F1_QA_ARTIFACT_ID}`);
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const qa = JSON.parse(cleaned);
  const testCases = qa.test_cases ?? qa.testCases ?? [];
  console.log(`[2/2] Loaded ${testCases.length} test case(s) from F1's approved qa_tests artifact`);

  const storyMappings = db.prepare<[string, string], { local_key: string; ado_id: number; title: string }>(
    `SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story' AND local_key LIKE ?`
  ).all(WORKFLOW_ID, 'F1.%');
  const storyMap = new Map<string, number>();
  for (const m of storyMappings) {
    storyMap.set(m.local_key, m.ado_id);
    if (m.title) storyMap.set(m.title, m.ado_id);
  }
  console.log(`[2/2] Linking against ${storyMappings.length} F1 story mapping(s)`);

  const workflow = db.prepare<[string], { summary: string | null; goal: string }>(
    'SELECT summary, goal FROM workflows WHERE id = ?'
  ).get(WORKFLOW_ID);
  const planName = (workflow?.summary ?? workflow?.goal.split('\n')[0] ?? 'Test Plan').slice(0, 60);

  const client = getAzureDevOpsClient();
  const result = await client.pushQATestPlan({ planName, testCases, storyMap, existing: undefined });

  const now = Date.now();
  db.prepare(`
    INSERT INTO qa_test_plan_map
      (workflow_id, artifact_id, plan_id, root_suite_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(WORKFLOW_ID, F1_QA_ARTIFACT_ID, result.planId, result.rootSuiteId, result.planUrl,
     JSON.stringify(result.suiteIds), JSON.stringify(result.testCaseIds), testCases.length, now);

  insertEvent(WORKFLOW_ID, 'ado_pushed', 'story_decomposition_F1_qa',
    `Test plan rebuilt fresh for Feature 1 (stale plan #${STALE_PLAN_ID} deleted) — ${testCases.length} test case(s) pushed to ${result.planUrl}`,
    { test_plan_url: result.planUrl });

  console.log(`[2/2] Done — fresh plan #${result.planId} at ${result.planUrl} (${result.created} created, ${result.updated} updated)`);
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
