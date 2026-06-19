import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import db from './src/data/database';
import { advanceStage } from './src/agents/workflow-router';

const WORKFLOW_ID = '58c2910a-3c08-4369-b09f-ec81530bd584';

async function main() {
  // Correct the corrupted current_stage — propagateFeedback used to store the literal
  // checkpoint stage ("story_decomposition_F2_qa") instead of the base stage, which isn't
  // a stage_sequence member, so advanceStage()'s indexOf() returned -1 and bounced the
  // workflow back to sequence[0] ("analyst"). That source bug is now fixed; this just
  // repairs the already-corrupted row. story_decomposition_F3 is the true last member of
  // wave 1 ([F1, F2, F3]), so indexOf + 1 lands on F4 directly.
  const now = Date.now();
  db.prepare(`UPDATE workflows SET current_stage = ?, status = 'active', updated_at = ? WHERE id = ?`)
    .run('story_decomposition_F3', now, WORKFLOW_ID);
  console.log('[fix-advance] current_stage corrected to story_decomposition_F3');

  const startedAt = Date.now();
  const result = await advanceStage(WORKFLOW_ID);
  console.log('[fix-advance] advanced to:', result.stage);

  const targets = ['story_decomposition_F4', 'story_decomposition_F5', 'story_decomposition_F6'];
  const deadline = Date.now() + 20 * 60 * 1000; // 20 min ceiling
  const done = new Set<string>();
  while (done.size < targets.length && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000));
    for (const stage of targets) {
      if (done.has(stage)) continue;
      const ev = db.prepare(
        `SELECT id FROM workflow_events WHERE workflow_id = ? AND stage = ? AND event_type = 'stage_completed' AND created_at >= ? LIMIT 1`
      ).get(WORKFLOW_ID, stage, startedAt);
      if (ev) {
        done.add(stage);
        console.log(`[fix-advance] ${stage} completed at ${new Date().toISOString()}`);
      }
    }
  }

  if (done.size < targets.length) {
    console.log(`[fix-advance] TIMEOUT waiting for: ${targets.filter(s => !done.has(s)).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('[fix-advance] F4, F5, and F6 all completed successfully.');
    process.exitCode = 0;
  }
}

main().catch(err => {
  // No process.exit() — must not tear down the process while the background feature
  // runs fired by advanceStage() above could still be in flight.
  console.error('[fix-advance] main() threw:', err);
  process.exitCode = 1;
});
