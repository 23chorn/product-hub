-- parent_local_key is added defensively in database.ts (checked against
-- PRAGMA table_info before altering), which landed in the same commit as this
-- migration. On any DB where that defensive ALTER already ran, re-running it
-- here throws "duplicate column name". No-op now — kept in place only so
-- this migration's slot in the journal isn't reused (see 0003_backfill_missing_columns.sql
-- for the same pattern).
SELECT 1;
