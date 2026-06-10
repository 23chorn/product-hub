import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Project root: 4 levels up from app/backend/src/data/ */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Database file location */
const DB_PATH = path.join(PROJECT_ROOT, 'db', 'product-ops.db');

/** Data directory for exports, decision-log, etc. */
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');

/** Schema file */
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'db', 'schema.sql');

// ---------------------------------------------------------------------------
// Initialise database
// ---------------------------------------------------------------------------

// Ensure the db directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Ensure the data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables if they don't exist
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');

// Split on semicolons and run each statement individually,
// wrapping each in IF NOT EXISTS where possible.
// better-sqlite3's exec() can handle the full schema if tables don't exist yet,
// but CREATE TABLE without IF NOT EXISTS will throw on subsequent runs.
// We convert CREATE TABLE / CREATE INDEX to IF NOT EXISTS variants.
const safeSchema = schema
  .replace(/CREATE TABLE(?! IF NOT EXISTS)/g, 'CREATE TABLE IF NOT EXISTS')
  .replace(/CREATE UNIQUE INDEX(?! IF NOT EXISTS)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS')
  .replace(/CREATE INDEX(?! IF NOT EXISTS)/g, 'CREATE INDEX IF NOT EXISTS');

db.exec(safeSchema);

// Migrations — add columns that don't exist yet on existing databases
try { db.exec('ALTER TABLE items ADD COLUMN metadata TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE checkpoints ADD COLUMN token_usage TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE artifacts ADD COLUMN skill_version_id INTEGER REFERENCES skill_versions(id)'); } catch { /* already exists */ }
try { db.exec("ALTER TABLE skill_versions ADD COLUMN discipline TEXT NOT NULL DEFAULT 'agent'"); } catch { /* already exists */ }
try {
  db.exec(`CREATE TABLE IF NOT EXISTS context_file_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name  TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_context_file_versions_file ON context_file_versions(file_name, created_at)');
} catch { /* already exists */ }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS pipeline_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id  TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    pr_url       TEXT,
    branch       TEXT,
    pipeline_id  TEXT,
    stage        TEXT    NOT NULL DEFAULT 'triggered',
    status       TEXT    NOT NULL DEFAULT 'running',
    test_results TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workflow ON pipeline_runs(workflow_id, created_at)');
} catch { /* already exists */ }

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
// Default export
// ---------------------------------------------------------------------------

export default db;
