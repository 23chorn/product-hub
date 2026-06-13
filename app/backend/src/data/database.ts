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
try { db.exec('ALTER TABLE checkpoints ADD COLUMN required_role TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE checkpoints ADD COLUMN resolved_by_user_id INTEGER REFERENCES users(id)'); } catch { /* already exists */ }

// ── Auth / RBAC tables ────────────────────────────────────────────────────────
try {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email        TEXT    UNIQUE COLLATE NOCASE,
    name         TEXT    NOT NULL,
    password_hash TEXT   NOT NULL,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    slack_user_id TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE)');
} catch { /* already exists */ }
// Migration: add username column to existing installs (backfill from email prefix)
try { db.exec("ALTER TABLE users ADD COLUMN username TEXT"); } catch { /* already exists */ }
try {
  db.exec(`UPDATE users SET username = lower(substr(email, 1, instr(email, '@') - 1))
           WHERE username IS NULL AND email IS NOT NULL`);
} catch { /* */ }
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)'); } catch { /* */ }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    description TEXT
  )`);
  // Seed default roles
  db.exec(`INSERT OR IGNORE INTO roles (name, description) VALUES
    ('product',   'Product managers — approve research and PRD stages'),
    ('tech_lead', 'Tech leads — approve architecture, epic planning, and story decomposition'),
    ('design',    'Designers — approve prototype stages')`);
} catch { /* already exists */ }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL,
    PRIMARY KEY (user_id, role_name)
  )`);
} catch { /* already exists */ }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS stage_roles (
    stage     TEXT NOT NULL PRIMARY KEY,
    role_name TEXT NOT NULL
  )`);
  // Seed default stage → role mappings
  db.exec(`INSERT OR IGNORE INTO stage_roles (stage, role_name) VALUES
    ('analyst',                'product'),
    ('pm_prd',                 'product'),
    ('solution_architect',     'tech_lead'),
    ('epic_feature_planner',   'tech_lead'),
    ('story_decomposition_F1', 'tech_lead'),
    ('story_decomposition_F2', 'tech_lead'),
    ('story_decomposition_F3', 'tech_lead'),
    ('prototype',              'design')`);
} catch { /* already exists */ }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS checkpoint_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    checkpoint_id INTEGER NOT NULL REFERENCES checkpoints(id),
    user_id       INTEGER REFERENCES users(id),
    user_name     TEXT    NOT NULL,
    user_email    TEXT    NOT NULL,
    action        TEXT    NOT NULL CHECK(action IN ('approved','rejected','revised')),
    notes         TEXT,
    created_at    INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoint_audit_cp ON checkpoint_audit(checkpoint_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoint_audit_user ON checkpoint_audit(user_id)');
} catch { /* already exists */ }
try { db.exec('ALTER TABLE artifacts ADD COLUMN skill_version_id INTEGER REFERENCES skill_versions(id)'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE artifacts ADD COLUMN external_system TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE artifacts ADD COLUMN external_path TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE artifacts ADD COLUMN external_url TEXT'); } catch { /* already exists */ }
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

try {
  db.exec(`CREATE TABLE IF NOT EXISTS qa_test_plan_map (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id     TEXT    NOT NULL REFERENCES workflows(id),
    artifact_id     INTEGER REFERENCES artifacts(id),
    plan_id         INTEGER NOT NULL,
    root_suite_id   INTEGER,
    plan_url        TEXT    NOT NULL,
    suite_ids       TEXT    NOT NULL DEFAULT '{}',
    test_case_ids   TEXT    NOT NULL DEFAULT '{}',
    test_case_count INTEGER,
    created_at      INTEGER NOT NULL
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_plan_workflow ON qa_test_plan_map(workflow_id)');
} catch { /* already exists */ }
try { db.exec('ALTER TABLE qa_test_plan_map ADD COLUMN root_suite_id INTEGER'); } catch { /* already exists */ }

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
