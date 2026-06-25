import { describe, it, expect } from 'vitest';
import {
  backlogTier,
  getSprintMeta,
  getAllStories,
  getAllFeatures,
  tryParseBacklog,
  getStoryPlatforms,
  countTicketsByPlatform,
  type BacklogData,
  type BacklogStory,
} from '@pap/shared';

const story = (title: string) => ({ title });

const tier3: BacklogData = {
  epic: { title: 'E', totalEffort: 21, sprintsRequired: 2 },
  features: [
    { title: 'F1', stories: [story('s1'), story('s2')] },
    { title: 'F2', stories: [story('s3')] },
  ],
};
const tier2: BacklogData = { feature: { title: 'F', stories: [story('s1')], totalEffort: 8 } };
const tier1: BacklogData = { story: { ...story('s1'), totalEffort: 3 } };

describe('backlogTier', () => {
  it('classifies each tier', () => {
    expect(backlogTier(tier3)).toBe(3);
    expect(backlogTier(tier2)).toBe(2);
    expect(backlogTier(tier1)).toBe(1);
    expect(backlogTier({})).toBe(1);
  });
});

describe('getAllStories', () => {
  it('flattens stories across features (tier 3)', () => {
    expect(getAllStories(tier3).map(s => s.title)).toEqual(['s1', 's2', 's3']);
  });
  it('returns the single feature/story for lower tiers', () => {
    expect(getAllStories(tier2)).toHaveLength(1);
    expect(getAllStories(tier1)).toHaveLength(1);
    expect(getAllStories({})).toEqual([]);
  });
});

describe('getAllFeatures', () => {
  it('returns features only for tier 3', () => {
    expect(getAllFeatures(tier3)).toHaveLength(2);
    expect(getAllFeatures(tier2)).toEqual([]);
  });
});

describe('getSprintMeta', () => {
  it('reads metadata from the present tier', () => {
    expect(getSprintMeta(tier3)?.totalEffort).toBe(21);
    expect(getSprintMeta(tier1)?.totalEffort).toBe(3);
  });
  it('returns null when no effort metadata', () => {
    expect(getSprintMeta({ epic: { title: 'E' } })).toBeNull();
    expect(getSprintMeta({})).toBeNull();
  });
});

describe('tryParseBacklog', () => {
  it('parses raw backlog JSON', () => {
    expect(tryParseBacklog(JSON.stringify(tier2))?.feature?.title).toBe('F');
  });
  it('strips markdown code fences', () => {
    const fenced = '```json\n' + JSON.stringify(tier1) + '\n```';
    expect(tryParseBacklog(fenced)?.story?.title).toBe('s1');
  });
  it('recovers JSON after a preamble', () => {
    const text = 'Here is the backlog:\n' + JSON.stringify(tier2);
    expect(tryParseBacklog(text)?.feature?.title).toBe('F');
  });
  it('returns null for non-backlog JSON or garbage', () => {
    expect(tryParseBacklog('{"unrelated":true}')).toBeNull();
    expect(tryParseBacklog('not json at all')).toBeNull();
  });
});

describe('getStoryPlatforms', () => {
  it('prefers the new `platform` field, normalizing case and dropping unknown values', () => {
    expect(getStoryPlatforms({ ...story('s'), platform: 'iOS' } as BacklogStory)).toEqual(['ios']);
    expect(getStoryPlatforms({ ...story('s'), platform: ['backend', 'web', 'bogus'] } as BacklogStory)).toEqual(['backend', 'web']);
  });

  it('falls back to legacy technical_notes presence when there is no platform field', () => {
    const s = { ...story('s'), technical_notes: { backend: 'do the thing', ios: 'n/a', android: null } } as BacklogStory;
    expect(getStoryPlatforms(s)).toEqual(['backend']);
  });

  it('returns an empty array when neither field is present', () => {
    expect(getStoryPlatforms(story('s') as BacklogStory)).toEqual([]);
  });
});

describe('countTicketsByPlatform', () => {
  it('counts a multi-platform story toward every platform it touches', () => {
    const stories = [
      { ...story('s1'), platform: ['backend', 'ios'] },
      { ...story('s2'), platform: 'web' },
      { ...story('s3') },
    ] as BacklogStory[];
    expect(countTicketsByPlatform(stories)).toEqual({ total: 3, backend: 1, web: 1, ios: 1, android: 0 });
  });
});
