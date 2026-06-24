#!/usr/bin/env tsx
/**
 * Manually retries the stuck story_decomposition_F5 stage for the "Limit Up & Down"
 * workflow (58c2910a-3c08-4369-b09f-ec81530bd584). F5's backlog synthesis hit the
 * story_decomposition stage's 16k output-token ceiling and the truncated JSON crashed
 * the parse in feature-stage-runner.ts, leaving the workflow paused at an error
 * checkpoint. Both the ceiling (now 24k) and the parse (now repairTruncatedJson-backed)
 * are fixed — this re-runs F5 to regenerate the backlog + QA suite.
 */
import dotenv from 'dotenv';
import path from 'path';
// Mirror app-config.ts's load — this script doesn't import that module, so .env
// would otherwise never get loaded and the Bedrock/AWS env vars would be empty.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import db from '../app/backend/src/data/database';
import { retryCurrentStage } from '../app/backend/src/agents/workflow-mutations';

const WORKFLOW_ID = '58c2910a-3c08-4369-b09f-ec81530bd584';

function workflowState() {
  return db.prepare('SELECT status, current_stage FROM workflows WHERE id = ?')
    .get(WORKFLOW_ID) as { status: string; current_stage: string } | undefined;
}

async function main() {
  const before = workflowState();
  if (!before) throw new Error(`Workflow ${WORKFLOW_ID} not found`);
  console.log(`Before: status=${before.status} current_stage=${before.current_stage}`);

  const { stage } = await retryCurrentStage(WORKFLOW_ID);
  console.log(`Retry kicked off for stage "${stage}" — waiting for the background refinement to finish...`);

  const start = Date.now();
  while (true) {
    await new Promise(r => setTimeout(r, 15_000));
    const row = workflowState();
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] status=${row?.status} current_stage=${row?.current_stage}`);
    if (row?.status !== 'active') break;
    if (elapsed > 600) { console.log('Timed out waiting (10 min) — check server logs.'); break; }
  }
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
