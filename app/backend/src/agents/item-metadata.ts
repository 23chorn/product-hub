/**
 * item-metadata — small shared helpers for reading the JSON blob stored on
 * items.metadata (synced from Airtable at workflow start). Centralises the
 * productArea read/coerce logic that was previously hand-inlined across the
 * coordinator, router, prototype, multi-agent, and stage-runner modules.
 * Also home to itemSessionDir(), the single source of truth for where an
 * item's on-disk artifacts live.
 *
 * Deliberately a leaf module (only depends on the db) so any agent module can
 * import it without risking an import cycle.
 */
import * as path from 'path';
import db, { DATA_DIR } from '../data/database';

/** Parsed items.metadata for an item, or null when the row/column is missing or malformed. */
export function readItemMetadata(itemId: string): Record<string, unknown> | null {
  try {
    const row = db
      .prepare<[string], { metadata: string | null }>('SELECT metadata FROM items WHERE id = ?')
      .get(itemId);
    if (!row?.metadata) return null;
    return JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Coerce a raw productArea value into a single trimmed label, or null when unset.
 * productArea is stored as a string or an array of strings depending on whether the
 * upstream Airtable field is single- or multi-select.
 */
export function coerceProductArea(raw: unknown): string | null {
  const area = Array.isArray(raw) ? raw.join(', ').trim() : typeof raw === 'string' ? raw.trim() : '';
  return area || null;
}

/** Read + coerce the productArea label for an item in one step. */
export function readProductArea(itemId: string): string | null {
  return coerceProductArea(readItemMetadata(itemId)?.productArea);
}

/** 'YYYY-MM' for the month an item was created, in local time. Falls back to the
 * current month if the item row can't be found (e.g. disk writes racing the insert). */
export function itemStartMonth(itemId: string): string {
  const row = db.prepare<[string], { created_at: number }>('SELECT created_at FROM items WHERE id = ?').get(itemId);
  const d = new Date(row?.created_at ?? Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Root of an item's on-disk artifact tree: data/sessions/<YYYY-MM>/<itemId>,
 * indexed by the month the item was created so the sessions folder doesn't grow
 * into one huge flat directory. Single source of truth for this path — every
 * reader/writer of an item's session files must go through this.
 */
export function itemSessionDir(itemId: string): string {
  return path.join(DATA_DIR, 'sessions', itemStartMonth(itemId), itemId);
}
