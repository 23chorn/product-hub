import { describe, it, expect } from 'vitest';
import { bumpPatch, DISCIPLINE_LABELS } from './types';

describe('bumpPatch', () => {
  it('increments the patch segment of a semver', () => {
    expect(bumpPatch('1.0.0')).toBe('1.0.1');
    expect(bumpPatch('2.5.9')).toBe('2.5.10');
  });
  it('returns the input unchanged when not a 3-part numeric version', () => {
    expect(bumpPatch('1.0')).toBe('1.0');
    expect(bumpPatch('v1.0.0')).toBe('v1.0.0');
    expect(bumpPatch('latest')).toBe('latest');
  });
});

describe('DISCIPLINE_LABELS', () => {
  it('maps known disciplines to display labels', () => {
    expect(DISCIPLINE_LABELS.dev).toBe('Dev');
    expect(DISCIPLINE_LABELS.qa).toBe('QA');
  });
});
