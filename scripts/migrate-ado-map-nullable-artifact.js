/**
 * Migration: Make ado_work_item_map.artifact_id nullable
 *
 * Epic and feature rows don't have specific artifacts — only stories do.
 * This migration changes the NOT NULL constraint to allow NULL.
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../db/product-ops.db');
console.log(`Migrating database: ${dbPath}`);

const db = new Database(dbPath);

try {
  // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
  db.exec(`
    BEGIN TRANSACTION;

    -- Create new table with nullable artifact_id
    CREATE TABLE ado_work_item_map_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT    NOT NULL REFERENCES workflows(id),
      artifact_id INTEGER REFERENCES artifacts(id),  -- now nullable
      ado_id      INTEGER NOT NULL,
      ado_type    TEXT    NOT NULL CHECK(ado_type IN ('epic','feature','story')),
      ado_url     TEXT,
      local_key   TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      created_at  INTEGER NOT NULL
    );

    -- Copy existing data
    INSERT INTO ado_work_item_map_new
      (id, workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
    SELECT id, workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at
    FROM ado_work_item_map;

    -- Drop old table
    DROP TABLE ado_work_item_map;

    -- Rename new table
    ALTER TABLE ado_work_item_map_new RENAME TO ado_work_item_map;

    -- Recreate index
    CREATE UNIQUE INDEX idx_ado_map_key ON ado_work_item_map(workflow_id, local_key);

    COMMIT;
  `);

  console.log('✓ Migration complete: ado_work_item_map.artifact_id is now nullable');
} catch (err) {
  console.error('✗ Migration failed:', err.message);
  process.exit(1);
} finally {
  db.close();
}
