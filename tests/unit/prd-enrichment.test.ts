import { describe, it, expect } from 'vitest';
import {
  collectFeaturePrdRefs,
  buildEpicEnrichment,
  buildFeatureEnrichment,
} from '../../app/backend/src/utils/prd-enrichment';

// PRD artifacts are stored as raw JSON (see agents/templates/prd.template.md), not markdown —
// these fixtures mirror that real shape rather than a rendered/markdown version.
const samplePrd = JSON.stringify({
  problem_statement: 'Users cannot do X today.',
  success_metrics: {
    primary: { metric: 'Conversion', baseline: '10%', target: '15%', timeframe: '60 days' },
  },
  out_of_scope: ['Accessibility work', 'Desktop app'],
  functional_requirements: [
    { id: 'FR1', requirement: 'The system shall allow users to send messages.' },
    { id: 'FR2', requirement: 'The system shall allow users to create rooms.' },
  ],
  non_functional_requirements: [
    { id: 'NFR1', category: 'Performance', requirement: 'p99 latency under 500ms', priority: 'Must' },
  ],
});

describe('collectFeaturePrdRefs', () => {
  it('reads the live snake_case prd_ref schema', () => {
    const feature = { stories: [{ prd_ref: { functional_requirements: ['FR1'], non_functional_requirements: ['NFR1'] } }] };
    const { frIds, nfrIds } = collectFeaturePrdRefs(feature);
    expect([...frIds]).toEqual(['FR1']);
    expect([...nfrIds]).toEqual(['NFR1']);
  });

  it('reads the legacy camelCase prdRef schema', () => {
    const feature = { stories: [{ prdRef: { functionalRequirements: ['FR2'], nonFunctionalRequirements: ['NFR1'] } }] };
    const { frIds, nfrIds } = collectFeaturePrdRefs(feature);
    expect([...frIds]).toEqual(['FR2']);
    expect([...nfrIds]).toEqual(['NFR1']);
  });

  it('aggregates refs across multiple stories without duplicates', () => {
    const feature = {
      stories: [
        { prd_ref: { functional_requirements: ['FR1'] } },
        { prd_ref: { functional_requirements: ['FR1', 'FR2'] } },
      ],
    };
    const { frIds } = collectFeaturePrdRefs(feature);
    expect([...frIds].sort()).toEqual(['FR1', 'FR2']);
  });

  it('returns empty sets when stories have no prd_ref', () => {
    const { frIds, nfrIds } = collectFeaturePrdRefs({ stories: [{ title: 'no refs here' }] });
    expect(frIds.size).toBe(0);
    expect(nfrIds.size).toBe(0);
  });
});

describe('buildEpicEnrichment', () => {
  it('renders problem statement, primary metric, and out-of-scope from the raw JSON PRD', () => {
    const html = buildEpicEnrichment(samplePrd);
    expect(html).toContain('Users cannot do X today.');
    expect(html).toContain('Conversion');
    expect(html).toContain('10%');
    expect(html).toContain('15%');
    expect(html).toContain('Accessibility work');
    expect(html).toContain('Desktop app');
  });

  it('returns empty string for unparseable content', () => {
    expect(buildEpicEnrichment('not json')).toBe('');
  });

  it('returns empty string for an empty PRD', () => {
    expect(buildEpicEnrichment('')).toBe('');
  });
});

describe('buildFeatureEnrichment', () => {
  it('includes full FR text (not just the ID) for referenced FRs', () => {
    const html = buildFeatureEnrichment(samplePrd, new Set(['FR1']), new Set());
    expect(html).toContain('FR1');
    expect(html).toContain('The system shall allow users to send messages.');
    // Not referenced — should be filtered out
    expect(html).not.toContain('create rooms');
  });

  it('includes full NFR detail (category, requirement, priority) for referenced NFRs', () => {
    const html = buildFeatureEnrichment(samplePrd, new Set(), new Set(['NFR1']));
    expect(html).toContain('NFR1');
    expect(html).toContain('Performance');
    expect(html).toContain('p99 latency under 500ms');
    expect(html).toContain('Must');
  });

  it('matches IDs across "FR-01" / "FR1" formatting variants', () => {
    const html = buildFeatureEnrichment(samplePrd, new Set(['FR-01']), new Set());
    expect(html).toContain('The system shall allow users to send messages.');
  });

  it('falls back to showing all FRs when none of the referenced IDs match', () => {
    const html = buildFeatureEnrichment(samplePrd, new Set(['FR99']), new Set());
    expect(html).toContain('send messages');
    expect(html).toContain('create rooms');
  });

  it('returns empty string when no PRD content is available', () => {
    expect(buildFeatureEnrichment('', new Set(['FR1']), new Set())).toBe('');
  });
});
