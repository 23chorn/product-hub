import { describe, it, expect } from 'vitest';
import { computeRevisionDiff } from '../../app/backend/src/utils/revision-diff';

describe('computeRevisionDiff', () => {
  it('reports no changes when texts are identical', () => {
    const out = computeRevisionDiff('a\nb\nc', 'a\nb\nc', 'PRD');
    expect(out).toContain('# Revision Diff — PRD');
    expect(out).toContain('No line-level changes detected');
  });

  it('shows added lines with a + marker and counts them', () => {
    const out = computeRevisionDiff('a\nb', 'a\nb\nc', 'PRD');
    expect(out).toContain('```diff');
    expect(out).toContain('+ c');
    expect(out).toContain('1 line added');
    expect(out).toContain('0 lines removed');
  });

  it('shows removed lines with a - marker and counts them', () => {
    const out = computeRevisionDiff('a\nb\nc', 'a\nc', 'Backlog');
    expect(out).toContain('- b');
    expect(out).toContain('1 line removed');
  });

  it('represents a changed line as a removal plus an addition', () => {
    const out = computeRevisionDiff('hello world', 'hello there', 'Analyst');
    expect(out).toContain('- hello world');
    expect(out).toContain('+ hello there');
    expect(out).toContain('1 line added');
    expect(out).toContain('1 line removed');
  });

  it('falls back to a stats-only summary for very large documents', () => {
    const big = Array.from({ length: 1500 }, (_, i) => `line ${i}`).join('\n');
    const bigChanged = Array.from({ length: 1500 }, (_, i) => `changed ${i}`).join('\n');
    const out = computeRevisionDiff(big, bigChanged, 'Architecture');
    expect(out).toContain('Document too large for line-by-line diff');
    expect(out).toContain('Original: 1500 lines');
    expect(out).toContain('Revised: 1500 lines');
  });
});
