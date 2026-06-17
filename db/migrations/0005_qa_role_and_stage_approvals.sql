INSERT OR IGNORE INTO roles (name, description) VALUES
  ('qa', 'QA Engineers — approve test plans and quality assurance stages');
--> statement-breakpoint
INSERT OR IGNORE INTO stage_roles (stage, role_name) VALUES
  ('qa_engineer', 'qa');
--> statement-breakpoint
INSERT OR IGNORE INTO stage_roles (stage, role_name) VALUES
  ('qa_engineer_F1', 'qa'),
  ('qa_engineer_F2', 'qa'),
  ('qa_engineer_F3', 'qa');
