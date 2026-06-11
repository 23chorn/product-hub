#!/usr/bin/env tsx
/**
 * Migration: Add decomposition_metadata column to workflows table
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const dbPath = path.resolve(__dirname, '../db/product-ops.db');
const db = new Database(dbPath);

console.log(`[MIGRATION] Opening database: ${dbPath}`);

try {
  // Check if column already exists
  const tableInfo = db.prepare('PRAGMA table_info(workflows)').all() as Array<{ name: string }>;
  const hasColumn = tableInfo.some(col => col.name === 'decomposition_metadata');

  if (hasColumn) {
    console.log('[MIGRATION] Column decomposition_metadata already exists. Skipping.');
  } else {
    console.log('[MIGRATION] Adding decomposition_metadata column...');
    db.prepare('ALTER TABLE workflows ADD COLUMN decomposition_metadata TEXT').run();
    console.log('[MIGRATION] ✓ Column added successfully');
  }
} catch (err: any) {
  console.error(`[MIGRATION ERROR] ${err.message}`);
  process.exit(1);
} finally {
  db.close();
}

console.log('[MIGRATION] Complete');
