import db from '../src/data/database';

const workflowId = process.argv[2];
if (!workflowId) {
  console.error('Usage: tsx scripts/inspect-workflow.ts <workflowId>');
  process.exit(1);
}

const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
console.log('=== workflow ===');
console.log(workflow);

if (workflow) {
  console.log('\n=== stage_sequence ===');
  console.log(JSON.parse(workflow.stage_sequence));
  console.log('\n=== decomposition_metadata ===');
  console.log(workflow.decomposition_metadata ? JSON.parse(workflow.decomposition_metadata) : null);
}

console.log('\n=== checkpoints ===');
const checkpoints = db.prepare('SELECT * FROM checkpoints WHERE workflow_id = ? ORDER BY created_at ASC').all(workflowId) as any[];
for (const c of checkpoints) {
  console.log({
    id: c.id, stage: c.stage, status: c.status, artifact_id: c.artifact_id,
    created_at: new Date(c.created_at).toISOString(), resolved_at: c.resolved_at ? new Date(c.resolved_at).toISOString() : null,
    coordinator_action: c.coordinator_action,
  });
}

console.log('\n=== recent events (last 40) ===');
const events = db.prepare('SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY id DESC LIMIT 40').all(workflowId) as any[];
for (const e of events.reverse()) {
  console.log(new Date(e.created_at).toISOString(), e.event_type, e.stage, '-', e.summary);
}
