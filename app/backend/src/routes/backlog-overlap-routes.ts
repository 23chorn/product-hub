/**
 * Human review of the deterministic cross-feature overlap candidates flagged at the
 * backlog_merge stage — see detectBacklogOverlaps() in agents/backlog-overlap.ts.
 */
import { Router, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import db from '../data/database';
import { loadLatestArtifactContent } from '../agents/artifact-helpers';
import { deleteMergedBacklogStory } from '../agents/story-removal';
import { stripJsonFence } from '../utils/json-repair';
import Logger from '../utils/logger';

const logger = new Logger('BACKLOG-OVERLAP-ROUTES');
export const backlogOverlapRoutes = Router();

interface OverlapFlagRow {
  id: number;
  workflow_id: string;
  item_id: string;
  feature_key_a: string;
  story_id_a: string;
  feature_key_b: string;
  story_id_b: string;
  score: number;
  matched_terms: string;
  status: 'pending' | 'confirmed' | 'dismissed' | 'auto_resolved';
  resolved_by_user_id: number | null;
  resolved_at: number | null;
  notes: string | null;
  created_at: number;
  flag_type: 'overlap' | 'scope_violation';
}

/**
 * Resolve title/as_a/i_want/so_that detail for a story_id from the merged backlog
 * artifact, so the review panel can show more than a bare ID.
 */
async function loadStoryDetailMap(itemId: string): Promise<Map<string, any>> {
  const storiesById = new Map<string, any>();
  const content = await loadLatestArtifactContent(itemId, 'backlog');
  if (!content) return storiesById;
  try {
    const parsed = JSON.parse(stripJsonFence(content));
    for (const feature of parsed.features ?? []) {
      for (const story of feature.stories ?? []) {
        storiesById.set(story.story_id, { ...story, featureKey: feature.key, featureTitle: feature.title });
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to parse merged backlog for overlap detail (item ${itemId}): ${err.message}`);
  }
  return storiesById;
}

// ── GET /api/workflow/:workflowId/backlog-overlaps ─────────────────────────────

backlogOverlapRoutes.get('/:workflowId/backlog-overlaps', async (req: AuthRequest, res: Response) => {
  const { workflowId } = req.params;
  try {
    const rows = db.prepare<[string], OverlapFlagRow>(
      `SELECT * FROM backlog_overlap_flags WHERE workflow_id = ? ORDER BY status ASC, score DESC`
    ).all(workflowId);

    const wf = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
    const storiesById = wf ? await loadStoryDetailMap(wf.item_id) : new Map<string, any>();

    const flags = rows.map(row => ({
      id: row.id,
      status: row.status,
      flagType: row.flag_type ?? 'overlap',
      score: row.score,
      matchedTerms: JSON.parse(row.matched_terms || '[]'),
      notes: row.notes,
      // For a scope_violation row, feature_key_a is the FR's rightful owner (no real "story A"
      // to show — that feature may not have written its own version of it yet).
      owningFeatureKey: row.feature_key_a,
      storyA: storiesById.get(row.story_id_a) ?? { story_id: row.story_id_a, featureKey: row.feature_key_a },
      storyB: storiesById.get(row.story_id_b) ?? { story_id: row.story_id_b, featureKey: row.feature_key_b },
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }));

    res.json({ flags });
  } catch (err: any) {
    logger.error(`Failed to fetch backlog overlaps for workflow ${workflowId}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/workflow/backlog-overlaps/:id ────────────────────────────────────

/**
 * Resolve a pending overlap flag. status 'dismissed' just marks it as not a real duplicate —
 * nothing is deleted. status 'confirmed' requires `keep: 'A' | 'B'`: the OTHER side's story is
 * actually removed (merged backlog artifact, plus its ADO work item + linked test cases + effort
 * rollup if it was already pushed) — the human calling this decides which ticket survives,
 * rather than the earlier-pushed side always winning by default (as the pre-push auto-resolve
 * in backlog-overlap.ts still does for near-certain matches).
 */
backlogOverlapRoutes.patch('/backlog-overlaps/:id', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid overlap flag ID' });

  const { status, notes, keep } = req.body as { status?: 'confirmed' | 'dismissed'; notes?: string; keep?: 'A' | 'B' };
  if (status !== 'confirmed' && status !== 'dismissed') {
    return res.status(400).json({ error: 'status must be "confirmed" or "dismissed"' });
  }
  if (status === 'confirmed' && keep !== 'A' && keep !== 'B') {
    return res.status(400).json({ error: 'keep must be "A" or "B" when confirming a real overlap' });
  }

  try {
    const row = db.prepare<[number], {
      id: number; workflow_id: string; item_id: string;
      feature_key_a: string; story_id_a: string; feature_key_b: string; story_id_b: string;
      status: string;
    }>('SELECT * FROM backlog_overlap_flags WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: `Overlap flag not found: ${id}` });
    if (row.status !== 'pending') return res.status(400).json({ error: `Overlap flag ${id} was already resolved (${row.status})` });

    if (status === 'confirmed') {
      // The side NOT kept is the one removed — mirrors recordOverlapFlags' auto-resolve
      // convention (side A kept, side B dropped) but lets the human choose either direction.
      const dropSide = keep === 'A'
        ? { featureKey: row.feature_key_b, storyId: row.story_id_b }
        : { featureKey: row.feature_key_a, storyId: row.story_id_a };
      await deleteMergedBacklogStory(row.workflow_id, row.item_id, dropSide.featureKey, dropSide.storyId);
      logger.info(`Overlap flag ${id}: kept ${keep === 'A' ? row.feature_key_a : row.feature_key_b}/${keep === 'A' ? row.story_id_a : row.story_id_b}, deleted ${dropSide.featureKey}/${dropSide.storyId}`);
    }

    db.prepare(`
      UPDATE backlog_overlap_flags
      SET status = ?, notes = ?, resolved_by_user_id = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, notes ?? null, req.user?.id ?? null, Date.now(), id);

    logger.info(`Overlap flag ${id} marked ${status} by ${req.user?.username ?? 'system'}`);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Failed to resolve overlap flag ${id}`, err);
    res.status(500).json({ error: err.message });
  }
});
