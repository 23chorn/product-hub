import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers/test-db';

describe('createTestDb (migration-built schema)', () => {
  it('builds the real workflow tables', () => {
    const db = createTestDb();
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all().map((r: any) => r.name);
    expect(tables).toContain('workflows');
    expect(tables).toContain('checkpoints');
    expect(tables).toContain('items');
    expect(tables).toContain('artifacts');
    db.close();
  });
});
