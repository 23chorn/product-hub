import { describe, it, expect } from 'vitest';
import { extractAdrTitle, extractAdrBlock, formatMonthShort } from './decision-log-helpers';

describe('extractAdrTitle', () => {
  it('prefers the title after a [date] prefix and strips bold markers', () => {
    expect(extractAdrTitle('## [12-03-2026] **Use Postgres**')).toBe('Use Postgres');
  });

  it('falls back to a plain or bolded ## heading', () => {
    expect(extractAdrTitle('## **ADR Draft: Caching layer**')).toBe('ADR Draft: Caching layer');
    expect(extractAdrTitle('## Adopt event sourcing')).toBe('Adopt event sourcing');
  });

  it('returns "Decision" when no heading is present', () => {
    expect(extractAdrTitle('just some prose without a heading')).toBe('Decision');
  });
});

describe('extractAdrBlock', () => {
  it('extracts a block fenced between --- delimiters', () => {
    const content = `Intro text
---
## Decision: X
Body line
---
Trailing text`;
    expect(extractAdrBlock(content)).toBe('## Decision: X\nBody line');
  });

  it('falls back to heading-through-end when there is no closing delimiter', () => {
    const content = `preamble
## Decision: Y
the rest of the message`;
    expect(extractAdrBlock(content)).toBe('## Decision: Y\nthe rest of the message');
  });

  it('returns null when there is no ## heading', () => {
    expect(extractAdrBlock('no heading here, just text')).toBeNull();
  });
});

describe('formatMonthShort', () => {
  it('formats YYYY-MM into a short month + year label', () => {
    expect(formatMonthShort('2026-02')).toBe('Feb 2026');
    expect(formatMonthShort('2025-12')).toBe('Dec 2025');
  });
});
