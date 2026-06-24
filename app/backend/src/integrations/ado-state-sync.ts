/**
 * ado-state-sync — refreshes cached ADO work item state for the Completed Initiatives
 * page. Read-only against ADO beyond the single batch fetch; reconciles on demand via
 * an explicit per-initiative "Refresh" action, never automatically. Modeled on
 * kb-sync.ts's "fetch remote, reconcile against the local cache" shape.
 */

import db from '../data/database';
import { getAzureDevOpsClient } from './azure-devops';
import Logger from '../utils/logger';

const logger = new Logger('ADO-STATE-SYNC');

export interface RefreshResult {
  refreshed: number;
  notFound: number;
}

/** Re-fetch `System.State` for every ado_work_item_map row belonging to an item's workflows. */
export async function refreshItemAdoState(itemId: string): Promise<RefreshResult> {
  const rows = db.prepare<[string], { id: number; ado_id: number }>(
    `SELECT id, ado_id FROM ado_work_item_map WHERE workflow_id IN (SELECT id FROM workflows WHERE item_id = ?)`
  ).all(itemId);

  if (rows.length === 0) return { refreshed: 0, notFound: 0 };

  const client = getAzureDevOpsClient();
  const workItems = await client.getWorkItemsBatch(rows.map(r => r.ado_id), ['System.State']);
  const stateById = new Map(workItems.map(w => [w.id!, w.fields['System.State'] as string | undefined]));

  const now = Date.now();
  let refreshed = 0;
  let notFound = 0;

  const update = db.prepare('UPDATE ado_work_item_map SET state = ?, state_synced_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) {
      const state = stateById.get(row.ado_id);
      if (state === undefined) {
        notFound++;
        continue;
      }
      update.run(state, now, row.id);
      refreshed++;
    }
  })();

  logger.info(`Refreshed ADO state for item ${itemId}: ${refreshed} updated, ${notFound} not found`);
  return { refreshed, notFound };
}
