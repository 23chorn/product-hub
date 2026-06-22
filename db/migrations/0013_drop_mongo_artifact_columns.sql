-- Removes the MongoDB content store. Artifact content now always lives on disk
-- under data/sessions/... — drop the mongo-only pointer columns. external_url is
-- kept (used to stamp the pushed ADO work item URL onto an artifact row, unrelated
-- to mongo).
ALTER TABLE artifacts DROP COLUMN external_system;
--> statement-breakpoint
ALTER TABLE artifacts DROP COLUMN external_path;
