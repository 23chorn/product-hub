import { AirtableClient } from '../integrations/airtable';
import { contextStore } from '../data/context-store';
import { StatusChange } from '@pap/shared';
import { MOCK_ITEMS } from '../../../../tests/fixtures/mock-airtable-data';
import Logger from './logger';
import { appConfig } from '../config/app-config';

const logger = new Logger('STATUS-DETECTOR');

// Transitions considered material enough to surface for context review.
// Any → Shipped is always material (handled separately).
const MATERIAL_TRANSITIONS: Record<string, string[]> = {
  Discovery: ['Ready', 'In Progress', 'Shipped'],
  Ready:     ['In Progress', 'Shipped'],
  Blocked:   ['In Progress', 'Shipped'],
  Deferred:  ['In Progress', 'Shipped'],
};

function isMaterial(oldStatus: string, newStatus: string): boolean {
  if (newStatus === 'Shipped') return true;
  return (MATERIAL_TRANSITIONS[oldStatus] ?? []).includes(newStatus);
}

/**
 * Fetch all Airtable items, compare against stored snapshots,
 * update all snapshots, and return only the material status changes.
 */
export async function detectStatusChanges(airtableClient: AirtableClient): Promise<StatusChange[]> {
  logger.info('Checking Airtable for status changes...');

  let currentItems;
  if (appConfig.server.useMockData) {
    logger.info('[MOCK] Using mock items for status detection');
    currentItems = MOCK_ITEMS;
  } else {
    try {
      currentItems = await airtableClient.listItems();
    } catch (err: any) {
      logger.error('Failed to fetch Airtable items for status detection', err);
      throw err;
    }
  }

  const snapshots = new Map(
    contextStore.getAllSnapshots().map(s => [s.airtableId, s])
  );

  const changes: StatusChange[] = [];
  const now = Date.now();

  for (const item of currentItems) {
    const snapshot = snapshots.get(item.id);
    const newStatus = item.status;
    const title = item.initiative;

    if (snapshot && snapshot.status !== newStatus) {
      const oldStatus = snapshot.status;
      if (isMaterial(oldStatus, newStatus)) {
        changes.push({ airtableId: item.id, title, oldStatus, newStatus, detectedAt: now });
        logger.info(`Material change: "${title}" ${oldStatus} → ${newStatus}`);
      }
    }

    // Production milestone for stats: mark the linked local item shipped the first
    // time we observe its Airtable Status as 'Shipped'.
    if (newStatus === 'Shipped') {
      contextStore.markShipped(item.id);
    }

    // Always update snapshot regardless of whether status changed
    contextStore.upsertSnapshot(item.id, title, newStatus);
  }

  logger.info(`Status check complete: ${currentItems.length} items scanned, ${changes.length} material changes`);
  return changes;
}
