/**
 * item-assignments — shared raw-row fetcher for item_assignments. Used by both the
 * initiatives list (Home page) and the completed-initiatives review page so the two
 * agree on how an item's assigned users are batch-loaded.
 */
import db from './database';
import type { AssignedUser } from '@pap/shared';

/** Assigned users (id + display name) for each of the given item ids, batched into one query. */
export function getAssignedUsersByItem(itemIds: string[]): Map<string, AssignedUser[]> {
  const map = new Map<string, AssignedUser[]>();
  if (itemIds.length === 0) return map;

  const rows = db.prepare(`
    SELECT a.item_id, u.id, u.name
    FROM item_assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.item_id IN (${itemIds.map(() => '?').join(',')})
    ORDER BY a.created_at ASC
  `).all(...itemIds) as { item_id: string; id: number; name: string }[];

  for (const r of rows) {
    const arr = map.get(r.item_id) ?? [];
    arr.push({ id: r.id, name: r.name });
    map.set(r.item_id, arr);
  }
  return map;
}
