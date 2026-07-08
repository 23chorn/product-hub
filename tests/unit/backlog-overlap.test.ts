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
  buildFrOwnershipMap,
  detectOutOfScopeFrReferences,
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

  it('does not flag near-identical stories that are tagged for different platforms', () => {
    const features = [
      { key: 'F1', stories: [{ story_id: 'F1-S1', title: 'Confirmation Screen', i_want: 'to see a confirmation after submitting', so_that: 'I know it succeeded', platform: 'ios' }] },
      { key: 'F2', stories: [{ story_id: 'F2-S1', title: 'Confirmation Screen', i_want: 'to see a confirmation after submitting', so_that: 'I know it succeeded', platform: 'android' }] },
    ];
    expect(detectBacklogOverlaps(features)).toHaveLength(0);
  });

  it('still flags near-identical stories tagged for the same platform', () => {
    const features = [
      { key: 'F1', stories: [{ story_id: 'F1-S1', title: 'Confirmation Screen', i_want: 'to see a confirmation after submitting', so_that: 'I know it succeeded', platform: 'ios' }] },
      { key: 'F2', stories: [{ story_id: 'F2-S1', title: 'Confirmation Screen', i_want: 'to see a confirmation after submitting', so_that: 'I know it succeeded', platform: 'ios' }] },
    ];
    expect(detectBacklogOverlaps(features)).toHaveLength(1);
  });

  it('still flags near-identical stories when platform is untagged on either side (legacy data)', () => {
    const features = [
      { key: 'F1', stories: [{ story_id: 'F1-S1', title: 'Reset password', i_want: 'to reset my password via email link', so_that: 'I can regain access' }] },
      { key: 'F2', stories: [{ story_id: 'F2-S1', title: 'Reset password', i_want: 'to reset my password via email link', so_that: 'I can regain access', platform: 'web' }] },
    ];
    expect(detectBacklogOverlaps(features)).toHaveLength(1);
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

describe('buildFrOwnershipMap', () => {
  it('maps each FR id to its owning feature by position', () => {
    const map = buildFrOwnershipMap([
      { prdRef: { functionalRequirements: ['FR-01', 'FR-02'] } },
      { prdRef: { functionalRequirements: ['FR-03'] } },
    ]);
    expect(map.get('FR1')).toBe('F1');
    expect(map.get('FR2')).toBe('F1');
    expect(map.get('FR3')).toBe('F2');
  });

  it('handles snake_case field names from older artifacts', () => {
    const map = buildFrOwnershipMap([{ prd_ref: { functional_requirements: ['FR1'] } }]);
    expect(map.get('FR1')).toBe('F1');
  });

  it('returns an empty map when no feature has FR ownership', () => {
    expect(buildFrOwnershipMap([{}, {}]).size).toBe(0);
  });
});

describe('detectOutOfScopeFrReferences', () => {
  it('flags a story that traces to an FR owned by a different feature', () => {
    const frOwnership = buildFrOwnershipMap([
      { prdRef: { functionalRequirements: ['FR1'] } },
      { prdRef: { functionalRequirements: ['FR2'] } },
    ]);
    const stories = [{ story_id: 'F1.S1', prd_ref: { functional_requirements: ['FR2'] } }];
    const violations = detectOutOfScopeFrReferences('F1', stories, frOwnership);
    expect(violations).toEqual([{ featureKey: 'F1', storyId: 'F1.S1', owningFeatureKey: 'F2', frId: 'FR2' }]);
  });

  it('does not flag a story that traces only to its own feature\'s FRs', () => {
    const frOwnership = buildFrOwnershipMap([{ prdRef: { functionalRequirements: ['FR1', 'FR2'] } }]);
    const stories = [{ story_id: 'F1.S1', prd_ref: { functional_requirements: ['FR1', 'FR2'] } }];
    expect(detectOutOfScopeFrReferences('F1', stories, frOwnership)).toEqual([]);
  });

  it('does not flag an FR with no known owner (missing data, not a violation)', () => {
    const frOwnership = buildFrOwnershipMap([{ prdRef: { functionalRequirements: ['FR1'] } }]);
    const stories = [{ story_id: 'F1.S1', prd_ref: { functional_requirements: ['FR9'] } }];
    expect(detectOutOfScopeFrReferences('F1', stories, frOwnership)).toEqual([]);
  });

  it('matches FR id format variants (FR-02 vs FR2)', () => {
    const frOwnership = buildFrOwnershipMap([{ prdRef: { functionalRequirements: ['FR1'] } }, { prdRef: { functionalRequirements: ['FR-02'] } }]);
    const stories = [{ story_id: 'F1.S1', prd_ref: { functional_requirements: ['FR2'] } }];
    const violations = detectOutOfScopeFrReferences('F1', stories, frOwnership);
    expect(violations[0].owningFeatureKey).toBe('F2');
  });

  it('handles legacy camelCase prdRef on stories', () => {
    const frOwnership = buildFrOwnershipMap([{ prdRef: { functionalRequirements: ['FR1'] } }, { prdRef: { functionalRequirements: ['FR2'] } }]);
    const stories = [{ story_id: 'F1.S1', prdRef: { functionalRequirements: ['FR2'] } }];
    const violations = detectOutOfScopeFrReferences('F1', stories, frOwnership);
    expect(violations).toHaveLength(1);
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
