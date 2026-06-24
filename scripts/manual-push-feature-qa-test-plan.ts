#!/usr/bin/env tsx
/**
 * Push a single feature's QA test cases to ADO Test Plans when the normal flow
 * already created its stories but the QA test-case push failed or never ran.
 *
 * pushFeatureToADO() in feature-decomposition.ts short-circuits (skips the QA push
 * entirely) once a feature's stories already exist in ado_work_item_map — its
 * duplicate-story guard has no equivalent for "stories exist but test cases never
 * landed", so a re-approval or a retry of the checkpoint won't retry the QA half.
 * Use this to push just that half once whatever blocked it the first time (a
 * transient ADO error, a QA-artifact formatting bug, etc.) is resolved.
 *
 * Usage: npx tsx scripts/manual-push-feature-qa-test-plan.ts <workflowId> <featureNumber>
 *   e.g. npx tsx scripts/manual-push-feature-qa-test-plan.ts 58c2910a-3c08-4369-b09f-ec81530bd584 2
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
import { featureLocalKey } from '@pap/shared';

async function main() {
  const [workflowId, featureNumberRaw] = process.argv.slice(2);
  const featureNumber = Number(featureNumberRaw);
  if (!workflowId || !Number.isInteger(featureNumber) || featureNumber < 1) {
    console.error('Usage: npx tsx scripts/manual-push-feature-qa-test-plan.ts <workflowId> <featureNumber>');
    process.exit(1);
  }

  const featureKey = featureLocalKey(featureNumber - 1); // e.g. "F2"
  const baseStage = `story_decomposition_F${featureNumber}`;
  const qaStage = `${baseStage}_qa`;

  const qaCheckpoint = db.prepare<[string, string], { artifact_id: number | null }>(
    `SELECT artifact_id FROM checkpoints WHERE workflow_id = ? AND stage = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1`
  ).get(workflowId, qaStage);
  if (!qaCheckpoint?.artifact_id) throw new Error(`No approved ${qaStage} checkpoint/artifact found for workflow ${workflowId}`);

  const raw = await loadArtifactContentById(qaCheckpoint.artifact_id);
  if (!raw) throw new Error(`Could not load artifact ${qaCheckpoint.artifact_id}`);
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const qa = JSON.parse(cleaned);
  const testCases = qa.test_cases ?? qa.testCases ?? [];
  console.log(`[1/3] Loaded ${testCases.length} test case(s) from ${featureKey}'s approved qa_tests artifact (#${qaCheckpoint.artifact_id})`);

  // Span the whole workflow, not just this feature — a test case can legitimately
  // reference another feature's story (see azure-devops-test-plans.ts's pushQATestPlan).
  const storyMappings = db.prepare<[string], { local_key: string; ado_id: number; title: string }>(
    `SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story'`
  ).all(workflowId);
  const storyMap = new Map<string, number>();
  for (const m of storyMappings) {
    storyMap.set(m.local_key, m.ado_id);
    if (m.title) storyMap.set(m.title, m.ado_id);
  }
  console.log(`[1/3] Linking against ${storyMappings.length} story mapping(s) across the workflow`);

  const existingPlan = db.prepare<[string], { plan_id: number; root_suite_id: number; plan_url: string; suite_ids: string; test_case_ids: string }>(
    'SELECT plan_id, root_suite_id, plan_url, suite_ids, test_case_ids FROM qa_test_plan_map WHERE workflow_id = ?'
  ).get(workflowId);
  const existing = existingPlan ? {
    planId: existingPlan.plan_id,
    rootSuiteId: existingPlan.root_suite_id,
    suiteIds: JSON.parse(existingPlan.suite_ids ?? '{}'),
    testCaseIds: JSON.parse(existingPlan.test_case_ids ?? '{}'),
  } : undefined;
  console.log(`[2/3] ${existing ? `Merging into existing plan #${existing.planId}` : 'No existing plan for this workflow — creating a new one'}`);

  const workflow = db.prepare<[string], { summary: string | null; goal: string }>(
    'SELECT summary, goal FROM workflows WHERE id = ?'
  ).get(workflowId);
  const planName = (workflow?.summary ?? workflow?.goal.split('\n')[0] ?? 'Test Plan').slice(0, 60);

  const client = getAzureDevOpsClient();
  const result = await client.pushQATestPlan({ planName, testCases, storyMap, existing });

  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO qa_test_plan_map
      (workflow_id, artifact_id, plan_id, root_suite_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(workflowId, qaCheckpoint.artifact_id, result.planId, result.rootSuiteId, result.planUrl,
     JSON.stringify(result.suiteIds), JSON.stringify(result.testCaseIds), testCases.length, now);

  db.prepare('UPDATE artifacts SET external_url = ? WHERE id = ?').run(result.planUrl, qaCheckpoint.artifact_id);

  insertEvent(workflowId, 'ado_pushed', qaStage,
    `Feature ${featureNumber} test cases pushed to Azure DevOps`,
    { test_plan_url: result.planUrl });

  console.log(`[3/3] Done — plan #${result.planId} at ${result.planUrl} (${result.created} created, ${result.updated} updated)`);
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
