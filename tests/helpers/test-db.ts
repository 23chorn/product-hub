import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';

/**
 * Create a fresh in-memory SQLite database carrying the real application schema.
 *
 * The schema is built by running the same drizzle migrations the production DB
 * uses (db/migrations) rather than a hand-maintained mirror — so it can never
 * drift out of sync with the code under test. Each call returns an independent
 * instance and never touches the real product-ops.db.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const migrationsFolder = path.resolve(__dirname, '..', '..', 'db', 'migrations');
  migrate(drizzle(db), { migrationsFolder });

  return db;
}
