import type Database from 'better-sqlite3';

/**
 * Defensive schema patches applied after drizzle's migrate() runs, guarded by existence
 * checks so they're safe to run on every boot. Exists for columns/tables where a prior
 * drizzle migration was later found to already be applied out-of-band on the live DB (so the
 * migration itself became a no-op — see db/migrations/0023_daily_jack_power.sql) and for
 * catching cases where Drizzle silently skips a migration due to timestamp ordering quirks.
 *
 * Shared between the real database bootstrap (data/database.ts) and the test DB helper
 * (tests/helpers/test-db.ts) so a fresh test database always ends up with the exact same
 * schema as production — the bug this fixes is a test DB missing a column that only ever
 * got added defensively, never via a migration that actually runs on a fresh install.
 */
export function applyDefensiveSchemaPatches(db: Database.Database): void {
  const itemCols = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map(c => c.name);
  if (!itemCols.includes('is_paused')) db.exec('ALTER TABLE items ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0');
  if (!itemCols.includes('paused_at')) db.exec('ALTER TABLE items ADD COLUMN paused_at INTEGER');

  const adoMapCols = (db.prepare('PRAGMA table_info(ado_work_item_map)').all() as { name: string }[]).map(c => c.name);
  if (!adoMapCols.includes('parent_local_key')) db.exec('ALTER TABLE ado_work_item_map ADD COLUMN parent_local_key TEXT');

  db.exec(`CREATE TABLE IF NOT EXISTS initiative_comments (
    id          TEXT    PRIMARY KEY,
    item_id     TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id     TEXT,
    author_name TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    type        TEXT    NOT NULL DEFAULT 'note'
                CHECK(type IN ('note','decision','pause','resume')),
    title       TEXT,
    created_at  INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_initiative_comments_item_id ON initiative_comments(item_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS item_assignments (
    item_id     TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (item_id, user_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_item_assignments_item_id ON item_assignments(item_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS quick_feature_pushes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT    NOT NULL,
    description      TEXT    NOT NULL DEFAULT '',
    result_json      TEXT    NOT NULL,
    ado_feature_id   INTEGER,
    ado_feature_url  TEXT,
    ado_stories_json TEXT,
    pushed_at        INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
}
