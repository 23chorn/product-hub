import Database from 'better-sqlite3';

/**
 * Create a fresh in-memory SQLite database with the full application schema
 * plus any additional tables needed for workflow testing.
 *
 * Each call returns an independent instance — safe to use per-test.
 * Never touches the real product-ops.db.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Core schema (mirrors database.ts / db/schema.sql) -----------------------

    CREATE TABLE IF NOT EXISTS items (
      id          TEXT    PRIMARY KEY,
      type        TEXT    NOT NULL CHECK(type IN ('initiative','feature','bug','spike')),
      title       TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','in_progress','shipped','archived')),
      source      TEXT    NOT NULL DEFAULT 'airtable'
                  CHECK(source IN ('airtable','quick_add')),
      airtable_id TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                TEXT    PRIMARY KEY,
      item_id           TEXT    NOT NULL REFERENCES items(id),
      agent_id          TEXT    NOT NULL,
      mode              TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','completed','cancelled','archived')),
      parent_session_id TEXT    REFERENCES sessions(id),
      workflow_context  TEXT,
      intended_output   TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role       TEXT    NOT NULL CHECK(role IN ('user','assistant','system')),
      content    TEXT    NOT NULL,
      sequence   INTEGER NOT NULL,
      timestamp  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type       TEXT    NOT NULL,
      file_path  TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','approved','superseded')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staged_decisions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id        TEXT    NOT NULL,
      summary         TEXT    NOT NULL,
      rationale       TEXT,
      alternatives    TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','logged','dismissed')),
      decision_log_id TEXT,
      created_at      INTEGER NOT NULL
    );

    -- Workflow pipeline tables (Epic 1+) ---------------------------------------

    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT    PRIMARY KEY,
      goal        TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','running','awaiting_checkpoint','complete','failed')),
      stage       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_artifacts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      stage       TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_checkpoints (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      stage       TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','approved','rejected')),
      created_at  INTEGER NOT NULL,
      resolved_at INTEGER
    );
  `);

  return db;
}
