-- The per-feature story decomposition and QA checkpoints (story_decomposition_F1, F2, F3...,
-- and their _qa siblings) were keyed in stage_roles by literal per-feature stage names, which
-- only ever covered initiatives with exactly 1-3 features. Role lookup is now normalized to
-- strip the _F<n> feature index before querying stage_roles (see workflow-db.ts), so a single
-- generic row covers any feature count. qa_engineer_F1/F2/F3 never matched any real checkpoint
-- name in the first place (the actual QA checkpoint is "<stage>_qa", not "qa_engineer_F<n>").
DELETE FROM stage_roles WHERE stage IN (
  'story_decomposition_F1', 'story_decomposition_F2', 'story_decomposition_F3',
  'qa_engineer_F1', 'qa_engineer_F2', 'qa_engineer_F3'
);
--> statement-breakpoint
INSERT OR IGNORE INTO stage_roles (stage, role_name) VALUES
  ('story_decomposition',    'pm'),
  ('story_decomposition_qa', 'qa');
