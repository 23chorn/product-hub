ALTER TABLE qa_test_plan_map ADD COLUMN epic_local_key TEXT NOT NULL DEFAULT 'epic';
--> statement-breakpoint
DROP INDEX idx_qa_plan_workflow;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_qa_plan_workflow ON qa_test_plan_map(workflow_id, epic_local_key);
