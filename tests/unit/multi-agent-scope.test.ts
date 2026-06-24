import { describe, it, expect } from 'vitest';
import {
  filterBacklogStoriesByScope,
  filterQaTestCasesByStoryIds,
  buildPlatformScopeSection,
  type ProductAreaScope,
} from '../../app/backend/src/agents/multi-agent-refinement';

const webOnly: ProductAreaScope = { area: 'Web', hasWeb: true, hasIOS: false, hasAndroid: false };
const unscoped: ProductAreaScope = { area: null, hasWeb: true, hasIOS: true, hasAndroid: true };

function backlogWith(stories: Array<{ story_id: string; platform?: unknown }>): string {
  return JSON.stringify({ epic: 'E', features: [{ title: 'F1', stories }] });
}

describe('buildPlatformScopeSection', () => {
  it('returns empty string when unscoped', () => {
    expect(buildPlatformScopeSection(unscoped)).toBe('');
  });

  it('lists in-scope channels and the platforms to exclude', () => {
    const section = buildPlatformScopeSection(webOnly);
    expect(section).toContain('**This feature is scoped to:** Web');
    expect(section).toContain('In-scope channels: backend, web');
    expect(section).toContain('iOS or Android');
    expect(section).toContain('Do NOT create stories');
  });

  it('omits the exclusion clause when every platform is in scope', () => {
    const allPlatforms: ProductAreaScope = { area: 'All', hasWeb: true, hasIOS: true, hasAndroid: true };
    const section = buildPlatformScopeSection(allPlatforms);
    expect(section).toContain('In-scope channels: backend, web, ios, android');
    expect(section).not.toContain('Do NOT create stories');
  });
});

describe('filterBacklogStoriesByScope', () => {
  it('is a no-op when unscoped', () => {
    const backlog = backlogWith([{ story_id: 'F1.S1', platform: 'ios' }]);
    const result = filterBacklogStoriesByScope(backlog, unscoped);
    expect(result.dropped).toBe(0);
    expect(result.survivorStoryIds).toBeNull();
    expect(result.backlog).toBe(backlog);
  });

  it('drops out-of-scope stories and keeps backend + in-scope + untagged', () => {
    const backlog = backlogWith([
      { story_id: 'F1.S1', platform: 'web' },      // keep (in scope)
      { story_id: 'F1.S2', platform: 'ios' },      // drop (out of scope)
      { story_id: 'F1.S3', platform: 'backend' },  // keep (backend always allowed)
      { story_id: 'F1.S4', platform: ['android'] },// drop (array, first elem out of scope)
      { story_id: 'F1.S5' },                        // keep (no platform tag)
    ]);
    const result = filterBacklogStoriesByScope(backlog, webOnly);
    expect(result.dropped).toBe(2);
    expect([...result.survivorStoryIds!].sort()).toEqual(['F1.S1', 'F1.S3', 'F1.S5']);
    const parsed = JSON.parse(result.backlog);
    expect(parsed.features[0].stories.map((s: any) => s.story_id)).toEqual(['F1.S1', 'F1.S3', 'F1.S5']);
  });

  it('returns the original string (dropped 0) when all stories are in scope', () => {
    const backlog = backlogWith([
      { story_id: 'F1.S1', platform: 'web' },
      { story_id: 'F1.S2', platform: 'backend' },
    ]);
    const result = filterBacklogStoriesByScope(backlog, webOnly);
    expect(result.dropped).toBe(0);
    expect(result.backlog).toBe(backlog);
    expect([...result.survivorStoryIds!].sort()).toEqual(['F1.S1', 'F1.S2']);
  });

  it('is a safe no-op on malformed backlog JSON', () => {
    const result = filterBacklogStoriesByScope('not json', webOnly);
    expect(result.dropped).toBe(0);
    expect(result.survivorStoryIds).toBeNull();
    expect(result.backlog).toBe('not json');
  });
});

describe('filterQaTestCasesByStoryIds', () => {
  const qa = JSON.stringify({
    test_cases: [
      { id: 'T1', story_ref: 'F1.S1' },
      { id: 'T2', story_ref: 'F1.S2' },  // references a dropped story
      { id: 'T3' },                       // no story_ref — always kept
    ],
  });

  it('skips filtering when survivorStoryIds is null', () => {
    const result = filterQaTestCasesByStoryIds(qa, null, 'F1');
    expect(result.dropped).toBe(0);
    expect(result.qaTests).toBe(qa);
  });

  it('drops test cases whose story_ref was filtered out', () => {
    const survivors = new Set(['F1.S1']);
    const result = filterQaTestCasesByStoryIds(qa, survivors, 'F1');
    expect(result.dropped).toBe(1);
    const parsed = JSON.parse(result.qaTests);
    expect(parsed.test_cases.map((t: any) => t.id)).toEqual(['T1', 'T3']);
  });

  it('is a safe no-op on malformed QA JSON', () => {
    const result = filterQaTestCasesByStoryIds('not json', new Set(['F1.S1']), 'F1');
    expect(result.dropped).toBe(0);
    expect(result.qaTests).toBe('not json');
  });

  it('never drops a cross-feature ref — survivorStoryIds only ever covers the current feature', () => {
    // F2's own survivor set obviously never contains an F1 key — this guard isn't
    // the place to validate cross-feature link integrity (regression: it used to
    // strip these unconditionally since it only ever checked the current feature's
    // own survivor set against every ref, regardless of which feature it named).
    const qaWithCrossRef = JSON.stringify({
      test_cases: [
        { id: 'T1', story_ref: 'F2.S1' },     // own feature, survives
        { id: 'T2', story_ref: 'F1.S5' },     // cross-feature — not this guard's concern
        { id: 'T3', story_ref: 'F2.S9' },     // own feature, dropped story — stripped
      ],
    });
    const survivors = new Set(['F2.S1']);
    const result = filterQaTestCasesByStoryIds(qaWithCrossRef, survivors, 'F2');
    expect(result.dropped).toBe(1);
    const parsed = JSON.parse(result.qaTests);
    expect(parsed.test_cases.map((t: any) => t.id)).toEqual(['T1', 'T2']);
  });
});
