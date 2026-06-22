import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
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
db.pragma('foreign_keys = ON');

// Run all pending migrations from db/migrations/*.sql.
// Applied migrations are tracked in the __drizzle_migrations table so each
// SQL file runs exactly once, on any DB (fresh or existing).
migrate(drizzle(db), { migrationsFolder: MIGRATIONS });

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
