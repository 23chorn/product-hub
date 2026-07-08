import { describe, it, expect, afterEach, vi } from 'vitest';

// Real schema in-memory DB — recordOverlapFlags/loadAutoResolvedStoryKeys hit backlog_overlap_flags,
// which FK-references workflows/items.
vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

import db from '../../app/backend/src/data/database';
import {
  detectBacklogOverlaps,
  excludeAutoResolvedStories,
  recordOverlapFlags,
  loadAutoResolvedStoryKeys,
  AUTO_RESOLVE_THRESHOLD,
} from '../../app/backend/src/agents/backlog-overlap';

function seedWorkflowAndItem(workflowId: string, itemId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, created_at, updated_at)
     VALUES (?, 'initiative', 'Item', 'active', 'airtable', ?, ?)`,
  ).run(itemId, now, now);
  db.prepare(
    `INSERT INTO workflows (id, item_id, goal, status, stage_sequence, created_at, updated_at)
     VALUES (?, ?, 'Ship it', 'active', '[]', ?, ?)`,
  ).run(workflowId, itemId, now, now);
}

afterEach(() => {
  for (const t of ['backlog_overlap_flags', 'workflows', 'items']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

describe('detectBacklogOverlaps', () => {
  it('flags near-identical stories across different features', () => {
    const features = [
      { key: 'F1', stories: [{ story_id: 'F1-S1', title: 'Reset password', i_want: 'to reset my password via email link', so_that: 'I can regain access' }] },
      { key: 'F2', stories: [{ story_id: 'F2-S1', title: 'Password reset', i_want: 'to reset my password via email link', so_that: 'I can regain access to my account' }] },
    ];
    const candidates = detectBacklogOverlaps(features);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].featureKeyA).toBe('F1');
    expect(candidates[0].featureKeyB).toBe('F2');
    expect(candidates[0].score).toBeGreaterThan(0.35);
  });

  it('ignores same-feature story pairs even when identical', () => {
    const story = { story_id: 'F1-S1', title: 'Reset password', i_want: 'to reset my password', so_that: 'I regain access' };
    const features = [{ key: 'F1', stories: [story, { ...story, story_id: 'F1-S2' }] }];
    expect(detectBacklogOverlaps(features)).toHaveLength(0);
  });

  it('does not flag unrelated stories', () => {
    const features = [
      { key: 'F1', stories: [{ story_id: 'F1-S1', title: 'Export CSV', i_want: 'to export my transaction history as CSV', so_that: 'I can archive it' }] },
      { key: 'F2', stories: [{ story_id: 'F2-S1', title: 'Dark mode', i_want: 'to toggle dark mode', so_that: 'I can use the app at night' }] },
    ];
    expect(detectBacklogOverlaps(features)).toHaveLength(0);
  });

  it('puts a later-positioned feature on the B side of every candidate (ordering guarantee relied on by pushFeatureToADO)', () => {
    const storyText = { title: 'Reset password', i_want: 'to reset my password via email link', so_that: 'I can regain access' };
    const features = [
      { key: 'F1', stories: [{ story_id: 'F1-S1', ...storyText }] },
      { key: 'F2', stories: [{ story_id: 'F2-S1', ...storyText }] },
      { key: 'F3', stories: [{ story_id: 'F3-S1', ...storyText }] },
    ];
    const candidates = detectBacklogOverlaps(features);
    // F3 was appended last — every candidate touching F3 must have it on the B side.
    for (const c of candidates.filter(c => c.featureKeyA === 'F3' || c.featureKeyB === 'F3')) {
      expect(c.featureKeyB).toBe('F3');
    }
  });
});

describe('excludeAutoResolvedStories', () => {
  it('drops only the story matching the (featureKey, story_id) pair', () => {
    const stories = [{ story_id: 'F2-S1' }, { story_id: 'F2-S2' }];
    const keys = new Set(['F2::F2-S1']);
    const result = excludeAutoResolvedStories('F2', stories, keys);
    expect(result.map(s => s.story_id)).toEqual(['F2-S2']);
  });

  it('leaves stories untouched when none are in the auto-resolved set', () => {
    const stories = [{ story_id: 'F2-S1' }];
    expect(excludeAutoResolvedStories('F2', stories, new Set())).toEqual(stories);
  });
});

describe('recordOverlapFlags + loadAutoResolvedStoryKeys', () => {
  it('round-trips auto_resolved rows keyed by the dropped (B) side', () => {
    seedWorkflowAndItem('wf-1', 'itm-1');
    recordOverlapFlags([
      {
        workflowId: 'wf-1', itemId: 'itm-1',
        featureKeyA: 'F1', storyIdA: 'F1-S1',
        featureKeyB: 'F2', storyIdB: 'F2-S1',
        score: 0.9, matchedTerms: ['reset', 'password'],
        status: 'auto_resolved',
      },
    ]);

    const keys = loadAutoResolvedStoryKeys('wf-1');
    expect(keys.has('F2::F2-S1')).toBe(true);
    expect(keys.has('F1::F1-S1')).toBe(false);
  });

  it('does not surface pending flags as auto-resolved', () => {
    seedWorkflowAndItem('wf-1', 'itm-1');
    recordOverlapFlags([
      {
        workflowId: 'wf-1', itemId: 'itm-1',
        featureKeyA: 'F1', storyIdA: 'F1-S1',
        featureKeyB: 'F2', storyIdB: 'F2-S1',
        score: 0.4, matchedTerms: [],
        status: 'pending',
      },
    ]);

    expect(loadAutoResolvedStoryKeys('wf-1').size).toBe(0);
  });
});

describe('AUTO_RESOLVE_THRESHOLD', () => {
  it('is stricter than the flagging threshold so only near-certain matches auto-drop', () => {
    // Sanity guard against an accidental typo dropping this below the flag threshold,
    // which would make every flagged candidate also an auto-drop candidate.
    expect(AUTO_RESOLVE_THRESHOLD).toBeGreaterThan(0.35);
    expect(AUTO_RESOLVE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
