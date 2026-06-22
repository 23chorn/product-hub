import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return {
    default: db,
    getPolicies: (scope: string) =>
      db.prepare('SELECT rule_key, rule_value FROM policies WHERE scope = ?').all(scope),
    DATA_DIR: '/tmp/product-hub-test-data',
  };
});

import db from '../../app/backend/src/data/database';
import { resolveProductAreaScope } from '../../app/backend/src/agents/multi-agent-refinement';

let counter = 0;
/** Seed an item carrying the given productArea metadata, return its id. */
function seedItemWithArea(productArea: string | null): string {
  const id = `item-${++counter}`;
  const now = Date.now();
  const metadata = productArea === null ? null : JSON.stringify({ productArea });
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, metadata, created_at, updated_at)
     VALUES (?, 'initiative', 'Item', 'active', 'quick_add', ?, ?, ?)`
  ).run(id, metadata, now, now);
  return id;
}

afterEach(() => { db.prepare('DELETE FROM items').run(); });

describe('resolveProductAreaScope', () => {
  it('treats an item with no productArea as unscoped (all platforms)', () => {
    const scope = resolveProductAreaScope(seedItemWithArea(null));
    expect(scope).toEqual({ area: null, hasWeb: true, hasIOS: true, hasAndroid: true });
  });

  it('scopes "Web App" to web only', () => {
    const scope = resolveProductAreaScope(seedItemWithArea('Web App'));
    expect(scope).toMatchObject({ hasWeb: true, hasIOS: false, hasAndroid: false });
    expect(scope.area).toBe('Web App');
  });

  it('scopes "Mobile App" to both iOS and Android', () => {
    const scope = resolveProductAreaScope(seedItemWithArea('Mobile App'));
    expect(scope).toMatchObject({ hasWeb: false, hasIOS: true, hasAndroid: true });
  });

  it('scopes "iOS" to iOS only', () => {
    expect(resolveProductAreaScope(seedItemWithArea('iOS'))).toMatchObject({
      hasWeb: false, hasIOS: true, hasAndroid: false,
    });
  });

  it('recognises multiple platforms in one tag', () => {
    expect(resolveProductAreaScope(seedItemWithArea('Web, Android'))).toMatchObject({
      hasWeb: true, hasIOS: false, hasAndroid: true,
    });
  });

  it('falls back to unscoped when the tag names no recognised platform', () => {
    const scope = resolveProductAreaScope(seedItemWithArea('Internal Tooling'));
    expect(scope).toMatchObject({ area: 'Internal Tooling', hasWeb: true, hasIOS: true, hasAndroid: true });
  });
});
