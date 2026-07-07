/**
 * One-off fix for a workflow caught by the epic_qa current_stage bug (fixed in
 * workflow-mutations.ts / workflow-router.ts — see resolveStageSequenceMember):
 * approving the epic_qa checkpoint after a prior revision on it wrote current_stage
 * as the literal string "epic" (not a real stage_sequence member), so advanceStage's
 * sequence.indexOf() returned -1 and the workflow restarted from stage 0.
 *
 * For a workflow where story_decomposition_F*, backlog_merge, and epic_qa were
 * already approved and pushed to ADO BEFORE the loop-back, redoing all of that
 * (plus solution_architect/api_spec/epic_feature_planner) would waste real work and
 * risks pushing duplicate epics/features/stories to ADO. Instead, this script
 * re-enters the workflow at "epic_qa" (already approved) and calls the real
 * advanceStage() — the same function normal checkpoint approval uses — so it runs
 * the actual curator stage and completes the workflow through the normal path,
 * skipping only the stages that don't need to be redone.
 *
 * Usage (dry run — prints what it would do, changes nothing):
 *   npx tsx src/scripts/fix-stuck-workflow-skip-to-curator.ts --workflow <id>
 *
 * Usage (apply):
 *   npx tsx src/scripts/fix-stuck-workflow-skip-to-curator.ts --workflow <id> --confirm
 */

import db from '../data/database';
import { advanceStage } from '../agents/workflow-router';

function parseArgs(): { workflowId?: string; confirm: boolean } {
  const args = process.argv.slice(2);
  const workflowId = args.includes('--workflow') ? args[args.indexOf('--workflow') + 1] : undefined;
  return { workflowId, confirm: args.includes('--confirm') };
}

async function main() {
  const { workflowId, confirm } = parseArgs();
  if (!workflowId) {
    console.error('Usage: npx tsx src/scripts/fix-stuck-workflow-skip-to-curator.ts --workflow <id> [--confirm]');
    process.exit(1);
  }

  const workflow = db.prepare<[string], { id: string; current_stage: string | null; status: string; stage_sequence: string }>(
    'SELECT id, current_stage, status, stage_sequence FROM workflows WHERE id = ?'
  ).get(workflowId);
  if (!workflow) {
    console.error(`Workflow ${workflowId} not found.`);
    process.exit(1);
  }

  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  const epicQaIdx = sequence.indexOf('epic_qa');
  const curatorIdx = sequence.indexOf('curator');

  if (epicQaIdx === -1 || curatorIdx === -1) {
    console.error(`This workflow's stage_sequence doesn't contain both "epic_qa" and "curator" — not safe to apply this script. Sequence: ${sequence.join(' -> ')}`);
    process.exit(1);
  }
  if (curatorIdx !== epicQaIdx + 1) {
    console.error(`"curator" is not the stage immediately after "epic_qa" in this sequence (found other stages in between) — this script assumes the simple case. Sequence: ${sequence.join(' -> ')}`);
    process.exit(1);
  }

  const epicQaCheckpoint = db.prepare<[string], { id: number; status: string }>(
    `SELECT id, status FROM checkpoints WHERE workflow_id = ? AND stage = 'epic_qa' ORDER BY created_at DESC LIMIT 1`
  ).get(workflowId);
  if (!epicQaCheckpoint || epicQaCheckpoint.status !== 'approved') {
    console.error(`epic_qa checkpoint is not approved for this workflow (found: ${epicQaCheckpoint?.status ?? 'none'}) — refusing to skip ahead of un-reviewed work.`);
    process.exit(1);
  }

  const danglingPending = db.prepare<[string], { id: number; stage: string }>(
    `SELECT id, stage FROM checkpoints WHERE workflow_id = ? AND status = 'pending' ORDER BY created_at ASC`
  ).all(workflowId);

  console.log(`Workflow ${workflowId}`);
  console.log(`  current_stage: ${workflow.current_stage}  status: ${workflow.status}`);
  console.log(`  epic_qa checkpoint #${epicQaCheckpoint.id}: approved`);
  console.log(`  will set current_stage -> "epic_qa", status -> "active", then call advanceStage() to run "curator" and complete the workflow.`);
  if (danglingPending.length > 0) {
    console.log(`  will also mark ${danglingPending.length} dangling pending checkpoint(s) as superseded (won't be reviewed, since the workflow is skipping past them): ${danglingPending.map(c => `#${c.id} (${c.stage})`).join(', ')}`);
  }

  if (!confirm) {
    console.log('\nDry run only — pass --confirm to apply.');
    process.exit(0);
  }

  const now = Date.now();
  const markSuperseded = db.prepare(
    `UPDATE checkpoints SET status = 'revised', human_feedback = ?, resolved_at = ? WHERE id = ?`
  );
  for (const cp of danglingPending) {
    markSuperseded.run('Superseded — workflow skipped ahead to curator after the epic_qa loop-back bug (see fix-stuck-workflow-skip-to-curator.ts)', now, cp.id);
  }

  db.prepare(`UPDATE workflows SET current_stage = 'epic_qa', status = 'active', updated_at = ? WHERE id = ?`)
    .run(now, workflowId);

  console.log('Re-entering at epic_qa — calling advanceStage()...');
  try {
    const result = await advanceStage(workflowId);
    console.log(`advanceStage resolved: stage="${result.stage}"`);
  } catch (err: any) {
    if (err.message?.startsWith('WORKFLOW_COMPLETE:')) {
      console.log('Workflow completed successfully.');
    } else {
      console.error('advanceStage threw an unexpected error:', err.message);
      process.exit(1);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
  });
