import { Router, Request, Response } from 'express';
import { StatusChange, ContextStatusResponse } from '@pap/shared';
import { contextStore } from '../data/context-store';
import { detectStatusChanges } from '../utils/status-detector';
import { generateContextProposals, writeContextProposal } from '../agents/context-review';
import { getOrCreateAgent, clearAllContextCaches } from '../agents/agent-cache';
import { sessionStore } from '../data/session-store';
import { AirtableClient } from '../integrations/airtable';
import { isValidModelId } from '../utils/ai-provider';
import { appConfig } from '../config/app-config';
import { MOCK_SNAPSHOT_SEED } from '../../../../tests/fixtures/mock-airtable-data';
import Logger from '../utils/logger';

const logger = new Logger('CONTEXT-ROUTES');
const router = Router();

// In-memory cache of changes detected since last check (cleared after review completes)
let cachedChanges: StatusChange[] = [];

let airtableClient: AirtableClient | null = null;
function getAirtableClient(): AirtableClient {
  if (!airtableClient) airtableClient = new AirtableClient();
  return airtableClient;
}

/**
 * GET /api/context/status
 * Returns pending proposal count, last-checked timestamp, cached changes, and pending proposals.
 * Called on app mount to seed the notification badge without triggering an Airtable call.
 */
router.get('/status', (_req: Request, res: Response) => {
  try {
    const pendingCount = contextStore.getPendingCount();
    const proposals = contextStore.getPendingProposals();
    const snapshots = contextStore.getAllSnapshots();
    const lastChecked = snapshots.length > 0
      ? Math.max(...snapshots.map(s => s.lastChecked))
      : null;

    const body: ContextStatusResponse = { pendingCount, lastChecked, changes: cachedChanges, proposals };
    res.json(body);
  } catch (err: any) {
    logger.error('Failed to get context status', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/context/check
 * Fetch all Airtable items, compare against stored snapshots, and return material changes.
 * Updates the in-memory cachedChanges. Does NOT run the AI agent.
 */
router.post('/check', async (_req: Request, res: Response) => {
  try {
    let client: AirtableClient;
    try {
      client = getAirtableClient();
    } catch {
      // Airtable not configured — return empty (e.g. during dev without .env)
      cachedChanges = [];
      return res.json({ changes: [], pendingCount: contextStore.getPendingCount() });
    }

    const changes = await detectStatusChanges(client);
    cachedChanges = changes;
    res.json({ changes, pendingCount: contextStore.getPendingCount() });
  } catch (err: any) {
    logger.error('Failed to check status changes', err);
    res.status(500).json({ error: err.message || 'Failed to check Airtable status' });
  }
});

/**
 * POST /api/context/review
 * Run the Kira AI agent against the cached changes.
 * Creates a session tied to the 'context-keeper' system item, generates proposals, persists them.
 */
router.post('/review', async (req: Request, res: Response) => {
  try {
    const { model }: { model?: string } = req.body;

    if (model && !isValidModelId(model)) {
      return res.status(400).json({ error: `Invalid model: ${model}` });
    }

    if (cachedChanges.length === 0) {
      return res.status(400).json({ error: 'No changes detected. Run /api/context/check first.' });
    }

    // Create a session tied to the context-keeper system item
    const session = sessionStore.createSession('context-keeper', 'context', 'context-keeper');
    logger.info(`Created context review session: ${session.id}`);

    const agent = await getOrCreateAgent('context-keeper');
    const proposals = await generateContextProposals(agent, cachedChanges, model);

    if (proposals.length === 0) {
      logger.info('Context review produced no proposals');
      return res.json({ sessionId: session.id, proposals: [] });
    }

    for (const p of proposals) {
      contextStore.insertProposal(session.id, p.fileName, p.sectionHint || null, p.proposedText, p.rationale);
    }

    // Clear cached changes — review has consumed them
    cachedChanges = [];

    const saved = contextStore.getPendingProposals();
    logger.info(`Context review generated ${saved.length} proposal(s)`);
    res.json({ sessionId: session.id, proposals: saved });
  } catch (err: any) {
    logger.error('Failed to run context review', err);
    res.status(500).json({ error: err.message || 'Context review failed' });
  }
});

/**
 * GET /api/context/proposals
 * List all pending proposals (e.g. to re-populate the panel after page refresh).
 */
router.get('/proposals', (_req: Request, res: Response) => {
  try {
    const proposals = contextStore.getPendingProposals();
    res.json({ proposals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/context/proposal/:id
 * Confirm (writes file + invalidates context cache) or dismiss a proposal.
 * Accepts an optional `proposedText` to use the user-edited version instead of the stored one.
 */
router.patch('/proposal/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { action, proposedText }: { action: 'confirm' | 'dismiss'; proposedText?: string } = req.body;

    if (!action || !['confirm', 'dismiss'].includes(action)) {
      return res.status(400).json({ error: 'action must be "confirm" or "dismiss"' });
    }

    if (action === 'confirm') {
      const proposals = contextStore.getPendingProposals();
      const proposal = proposals.find(p => p.id === id);
      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found or already reviewed' });
      }

      await writeContextProposal({
        fileName: proposal.fileName,
        sectionHint: proposal.sectionHint,
        proposedText: proposedText ?? proposal.proposedText,
      });

      // Invalidate context cache on all cached agents so the next request picks up the new file
      clearAllContextCaches();

      contextStore.updateProposalStatus(id, 'confirmed');
      logger.info(`Confirmed proposal ${id}, wrote ${proposal.fileName}`);
    } else {
      contextStore.updateProposalStatus(id, 'dismissed');
      logger.info(`Dismissed proposal ${id}`);
    }

    res.json({ success: true, pendingCount: contextStore.getPendingCount() });
  } catch (err: any) {
    logger.error('Failed to update proposal', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/context/seed-test-data
 * Dev-only: seeds item_status_snapshots with old statuses from MOCK_SNAPSHOT_SEED
 * so that the next "Check for Changes" call produces material transitions.
 * Only works when USE_MOCK_DATA=true.
 */
router.post('/seed-test-data', (_req: Request, res: Response) => {
  if (!appConfig.server.useMockData) {
    return res.status(403).json({ error: 'Only available when USE_MOCK_DATA=true' });
  }
  for (const item of MOCK_SNAPSHOT_SEED) {
    contextStore.upsertSnapshot(item.airtableId, item.title, item.status);
  }
  // Reset cached changes so the panel shows a clean slate before the next check
  cachedChanges = [];
  logger.info('[DEV] Seeded test snapshots — ready for a "Check for Changes" run');
  res.json({ seeded: MOCK_SNAPSHOT_SEED.length });
});

export default router;
