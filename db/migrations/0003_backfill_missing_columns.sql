-- resolved_by_user_id is already declared on checkpoints in 0001_initial.sql (that
-- snapshot was taken from a database that already had the column from a pre-Drizzle
-- ALTER). Adding it again here breaks every fresh database, which gets the column
-- from 0001 and then hits "duplicate column name" here. No-op now — kept in place
-- only so this migration's slot in the journal isn't reused.
SELECT 1;
