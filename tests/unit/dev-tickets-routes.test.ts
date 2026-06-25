import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  const db = createTestDb();
  return { default: db };
});

import db from '../../app/backend/src/data/database';
import {
  findInitiativeBySeqNum,
  parseStreamFilter,
  matchesStream,
  buildFeatures,
  buildStoryPlatformMap,
} from '../../app/backend/src/routes/dev-tickets-routes';
import type { AdoWorkItemRow } from '../../app/backend/src/data/work-item-queries';
import type { BacklogData } from '@pap/shared';

function workItemRow(opts: { adoType: 'epic' | 'feature' | 'story'; localKey: string; state?: string | null }): AdoWorkItemRow {
  return {
    itemId: 'itm-x',
    ado_id: Math.floor(Math.random() * 1_000_000),
    ado_type: opts.adoType,
    ado_url: null,
    local_key: opts.localKey,
    title: `[${opts.localKey}] Row`,
    state: opts.state ?? null,
    state_synced_at: null,
    artifact_id: null,
    created_at: Date.now(),
  };
}

let seq = 0;

function seedItem(opts: { status?: string; seqNum?: number } = {}): string {
  const id = `itm-${++seq}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO items (id, type, title, status, source, seq_num, created_at, updated_at) VALUES (?, 'initiative', 'Some Initiative', ?, 'local', ?, ?, ?)`
  ).run(id, opts.status ?? 'active', opts.seqNum ?? seq, now, now);
  return id;
}

beforeEach(() => {
  db.prepare('DELETE FROM items').run();
});

describe('findInitiativeBySeqNum', () => {
  it('finds an active item by its seq_num', () => {
    const id = seedItem({ seqNum: 42 });
    expect(findInitiativeBySeqNum(42)?.id).toBe(id);
  });

  it('excludes an archived item', () => {
    seedItem({ seqNum: 7, status: 'archived' });
    expect(findInitiativeBySeqNum(7)).toBeUndefined();
  });

  it('returns undefined for a seq_num that does not exist', () => {
    expect(findInitiativeBySeqNum(999)).toBeUndefined();
  });
});

describe('parseStreamFilter', () => {
  it('returns null when the param is absent', () => {
    expect(parseStreamFilter(undefined)).toBeNull();
  });

  it('parses a comma-separated value', () => {
    expect(parseStreamFilter('backend,ios')).toEqual(new Set(['backend', 'ios']));
  });

  it('parses a repeated query param (array)', () => {
    expect(parseStreamFilter(['backend', 'web'])).toEqual(new Set(['backend', 'web']));
  });

  it('lowercases and trims values', () => {
    expect(parseStreamFilter(' Backend , IOS ')).toEqual(new Set(['backend', 'ios']));
  });

  it('throws on an unrecognized stream', () => {
    expect(() => parseStreamFilter('backend,bogus')).toThrow(/Unknown stream "bogus"/);
  });
});

describe('matchesStream', () => {
  it('matches everything when there is no active filter', () => {
    expect(matchesStream([], null)).toBe(true);
    expect(matchesStream(['ios'], null)).toBe(true);
  });

  it('includes untagged content (no resolvable platform) even when a filter is active', () => {
    expect(matchesStream([], new Set(['backend']))).toBe(true);
  });

  it('includes content whose platforms intersect the filter', () => {
    expect(matchesStream(['backend', 'ios'], new Set(['backend']))).toBe(true);
  });

  it('excludes content whose platforms are known and do not intersect the filter', () => {
    expect(matchesStream(['ios'], new Set(['backend']))).toBe(false);
  });
});

describe('buildFeatures', () => {
  const backlog: BacklogData = {
    features: [
      {
        title: 'Feature One',
        description: 'F1 desc',
        stories: [
          { title: 'Story 1', platform: 'backend' },
          { title: 'Story 2', platform: 'ios' },
        ],
      },
      {
        title: 'Feature Two',
        description: 'F2 desc',
        stories: [{ title: 'Story 3', platform: 'ios' }],
      },
    ],
  };

  it('merges ADO tracking with backlog content by positional local key', () => {
    const rows = [
      workItemRow({ adoType: 'feature', localKey: 'F1' }),
      workItemRow({ adoType: 'story', localKey: 'F1.S1' }),
      workItemRow({ adoType: 'story', localKey: 'F1.S2' }),
    ];
    const features = buildFeatures(rows, backlog, null);
    expect(features).toHaveLength(1);
    // title comes from the ADO row (canonical ticket title); description/platform come from the backlog artifact.
    expect(features[0]).toMatchObject({ title: '[F1] Row', description: 'F1 desc', localKey: 'F1' });
    expect((features[0] as any).stories).toHaveLength(2);
    expect((features[0] as any).stories[0]).toMatchObject({ title: '[F1.S1] Row', platform: 'backend', localKey: 'F1.S1' });
  });

  it('drops a story that does not match the stream filter', () => {
    const rows = [
      workItemRow({ adoType: 'feature', localKey: 'F1' }),
      workItemRow({ adoType: 'story', localKey: 'F1.S1' }),
      workItemRow({ adoType: 'story', localKey: 'F1.S2' }),
    ];
    const features = buildFeatures(rows, backlog, new Set(['backend']));
    expect(features).toHaveLength(1);
    expect((features[0] as any).stories).toHaveLength(1);
    expect((features[0] as any).stories[0].localKey).toBe('F1.S1');
  });

  it('drops a feature entirely once the stream filter empties out every one of its stories', () => {
    const rows = [
      workItemRow({ adoType: 'feature', localKey: 'F1' }),
      workItemRow({ adoType: 'story', localKey: 'F1.S1' }),
      workItemRow({ adoType: 'feature', localKey: 'F2' }),
      workItemRow({ adoType: 'story', localKey: 'F2.S1' }),
    ];
    const features = buildFeatures(rows, backlog, new Set(['backend']));
    expect(features.map((f: any) => f.localKey)).toEqual(['F1']);
  });

  it('still returns ADO tracking fields when no backlog content is available', () => {
    const rows = [workItemRow({ adoType: 'feature', localKey: 'F1', state: 'Active' })];
    const features = buildFeatures(rows, null, null);
    expect(features[0]).toMatchObject({ localKey: 'F1', state: 'Active' });
  });
});

describe('buildStoryPlatformMap', () => {
  it('keys platforms by the F<n>.S<m> local key matching storyLocalKey/featureLocalKey', () => {
    const backlog: BacklogData = {
      features: [{ title: 'F', stories: [{ title: 'S', platform: ['backend', 'web'] }] }],
    };
    const map = buildStoryPlatformMap(backlog);
    expect(map.get('F1.S1')).toEqual(['backend', 'web']);
  });

  it('returns an empty map when there is no backlog content', () => {
    expect(buildStoryPlatformMap(null).size).toBe(0);
  });
});
