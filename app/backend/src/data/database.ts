import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as fs from 'fs';
import { findRepoRoot } from '../utils/find-repo-root';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = findRepoRoot(__dirname);
const DB_PATH       = path.join(PROJECT_ROOT, 'db', 'product-ops.db');
const MIGRATIONS    = path.join(PROJECT_ROOT, 'db', 'migrations');

export const DATA_DIR = path.join(PROJECT_ROOT, 'data');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// WAL already protects against corruption on crash, so the extra fsync FULL does on
// every commit isn't needed — NORMAL still fsyncs at WAL checkpoints, just not every write.
db.pragma('synchronous = NORMAL');
// Many short-lived connections (stage runners, route handlers) hit this DB concurrently.
// Without a busy_timeout, a writer holding the lock makes every other connection fail
// immediately with SQLITE_BUSY instead of waiting; this makes them retry for up to 10s.
db.pragma('busy_timeout = 10000');

// Run all pending migrations from db/migrations/*.sql.
// Applied migrations are tracked in the __drizzle_migrations table so each
// SQL file runs exactly once, on any DB (fresh or existing).
// Foreign keys must be off while migrating: better-sqlite3's bundled SQLite defaults
// foreign_keys to ON regardless of our pragma below, and any PRAGMA foreign_keys toggle
// a migration file itself emits is a no-op once inside the transaction migrate() wraps
// each file in — enforcement state is whatever it was when that transaction began. SQLite's
// column-drop/rebuild dance (CREATE __new_x, copy rows, DROP x, RENAME) and dropping a table
// still referenced by another table's column declaration both need it off to complete.
db.pragma('foreign_keys = OFF');
migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
// Defensive column additions — runs only when the column is absent, safe to repeat.
// Guards against Drizzle silently skipping a migration due to timestamp ordering quirks.
const itemCols = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map(c => c.name);
if (!itemCols.includes('is_paused')) db.exec('ALTER TABLE items ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0');
if (!itemCols.includes('paused_at'))  db.exec('ALTER TABLE items ADD COLUMN paused_at INTEGER');
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
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Helper: getPolicies
// ---------------------------------------------------------------------------

const policiesStmt = db.prepare(
  `SELECT rule_key, rule_value FROM policies WHERE scope = ?`
);

export function getPolicies(scope: string): Array<{ rule_key: string; rule_value: string }> {
  return policiesStmt.all(scope) as Array<{ rule_key: string; rule_value: string }>;
}

// ---------------------------------------------------------------------------
// Default export — raw better-sqlite3 instance used throughout the codebase
// ---------------------------------------------------------------------------

export default db;
