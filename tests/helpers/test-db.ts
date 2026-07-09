import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { applyDefensiveSchemaPatches } from '../../app/backend/src/data/defensive-schema-patches';

/**
 * Create a fresh in-memory SQLite database carrying the real application schema.
 *
 * The schema is built by running the same drizzle migrations the production DB uses
 * (db/migrations), then the same defensive schema patches data/database.ts applies after
 * migrating — some columns (e.g. ado_work_item_map.parent_local_key) only ever get added
 * that way, not via a migration that actually runs on a fresh install (see
 * defensive-schema-patches.ts's doc comment), so skipping this step here would leave the
 * test DB missing them even though the real DB always has them. Each call returns an
 * independent instance and never touches the real product-ops.db.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const migrationsFolder = path.resolve(__dirname, '..', '..', 'db', 'migrations');
  migrate(drizzle(db), { migrationsFolder });
  applyDefensiveSchemaPatches(db);

  return db;
}
