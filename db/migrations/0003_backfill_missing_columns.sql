-- Add resolved_by_user_id to checkpoints (auth feature added after initial schema).
-- All other schema.ts columns already exist in the pre-Drizzle database.
ALTER TABLE checkpoints ADD COLUMN resolved_by_user_id INTEGER REFERENCES users(id);
