/**
 * scripts/verify-schema.ts
 *
 * Verifies that the SQLite database at db/product-ops.db contains all expected
 * tables and key columns. Exits 0 on success, 1 on any failure.
 *
 * Run: npm run verify-schema (from project root or app/backend)
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ── Locate DB ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'db', 'product-ops.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[verify-schema] ERROR: Database not found at ${DB_PATH}`);
  console.error(`  Start the server once to initialise the schema, then re-run this script.`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// ── Expected schema ───────────────────────────────────────────────────────────

interface ColumnSpec {
  name: string;
  type?: string;  // partial match, case-insensitive
}

const EXPECTED_TABLES: Record<string, ColumnSpec[]> = {
  // ── Original tables ─────────────────────────────────────────────────────────
  items: [
    { name: 'id',          type: 'TEXT' },
    { name: 'type',        type: 'TEXT' },
    { name: 'title',       type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'status',      type: 'TEXT' },
    { name: 'source',      type: 'TEXT' },
    { name: 'created_at',  type: 'INTEGER' },
    { name: 'updated_at',  type: 'INTEGER' },
  ],
  sessions: [
    { name: 'id' },
    { name: 'item_id' },
    { name: 'agent_id' },
    { name: 'mode' },
    { name: 'status' },
    { name: 'created_at' },
    { name: 'updated_at' },
  ],
  messages: [
    { name: 'id' },
    { name: 'session_id' },
    { name: 'role' },
    { name: 'content' },
    { name: 'sequence' },
    { name: 'timestamp' },
  ],
  artifacts: [
    { name: 'id' },
    { name: 'session_id' },
    { name: 'type' },
    { name: 'file_path' },
    { name: 'status' },
    { name: 'created_at' },
  ],
  context_loads: [
    { name: 'id' },
    { name: 'session_id' },
    { name: 'tier' },
    { name: 'file_path' },
    { name: 'loaded_at' },
  ],
  item_status_snapshots: [
    { name: 'airtable_id' },
    { name: 'title' },
    { name: 'status' },
    { name: 'last_checked' },
  ],
  context_change_proposals: [
    { name: 'id' },
    { name: 'session_id' },
    { name: 'file_name' },
    { name: 'proposed_text' },
    { name: 'rationale' },
    { name: 'status' },
    { name: 'created_at' },
  ],
  // ── Workflow engine tables (Epic 1+) ─────────────────────────────────────────
  workflows: [
    { name: 'id',               type: 'TEXT' },
    { name: 'item_id',          type: 'TEXT' },
    { name: 'goal',             type: 'TEXT' },
    { name: 'status',           type: 'TEXT' },
    { name: 'current_stage',    type: 'TEXT' },
    { name: 'stage_sequence',   type: 'TEXT' },
    { name: 'policy_overrides', type: 'TEXT' },
    { name: 'created_at',       type: 'INTEGER' },
    { name: 'updated_at',       type: 'INTEGER' },
  ],
  checkpoints: [
    { name: 'id',                 type: 'INTEGER' },
    { name: 'workflow_id',        type: 'TEXT' },
    { name: 'stage',              type: 'TEXT' },
    { name: 'artifact_id' },
    { name: 'status',             type: 'TEXT' },
    { name: 'human_feedback' },
    { name: 'coordinator_action' },
    { name: 'created_at',         type: 'INTEGER' },
    { name: 'resolved_at' },
  ],
  context_diffs: [
    { name: 'id',           type: 'INTEGER' },
    { name: 'workflow_id' },
    { name: 'file_name',    type: 'TEXT' },
    { name: 'diff_content', type: 'TEXT' },
    { name: 'rationale',    type: 'TEXT' },
    { name: 'status',       type: 'TEXT' },
    { name: 'approved_by' },
    { name: 'created_at',   type: 'INTEGER' },
  ],
  policies: [
    { name: 'id',          type: 'INTEGER' },
    { name: 'scope',       type: 'TEXT' },
    { name: 'scope_value' },
    { name: 'rule_key',    type: 'TEXT' },
    { name: 'rule_value',  type: 'TEXT' },
    { name: 'created_at',  type: 'INTEGER' },
  ],
};

// ── Verification logic ────────────────────────────────────────────────────────

interface PragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

let passed = 0;
let failed = 0;

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg: string) {
  console.error(`  ✕ ${msg}`);
  failed++;
}

// Check tables exist
const existingTables = new Set(
  (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
    .map((r) => r.name)
);

console.log('\n[verify-schema] Checking tables and columns...\n');

for (const [tableName, expectedCols] of Object.entries(EXPECTED_TABLES)) {
  console.log(`  Table: ${tableName}`);

  if (!existingTables.has(tableName)) {
    fail(`Table "${tableName}" does not exist`);
    continue;
  }
  ok(`Table "${tableName}" exists`);

  const actualCols = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as PragmaColumn[];
  const colMap = new Map(actualCols.map((c) => [c.name.toLowerCase(), c]));

  for (const spec of expectedCols) {
    const actual = colMap.get(spec.name.toLowerCase());
    if (!actual) {
      fail(`  Column "${tableName}.${spec.name}" is missing`);
      continue;
    }
    if (spec.type && !actual.type.toUpperCase().includes(spec.type.toUpperCase())) {
      fail(`  Column "${tableName}.${spec.name}" has type "${actual.type}", expected "${spec.type}"`);
      continue;
    }
    ok(`  Column "${tableName}.${spec.name}" OK`);
  }
}

// Summary
const total = passed + failed;
console.log(`\n[verify-schema] ${total} check(s): ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error(
    `[verify-schema] FAILED — ${failed} issue(s) found.\n` +
    `  If this is a fresh deployment, start the server once to initialise the schema.\n` +
    `  If columns are missing from an existing DB, a migration in database.ts may be needed.`
  );
  process.exit(1);
}

console.log('[verify-schema] Schema OK — all tables and columns verified.');
process.exit(0);
