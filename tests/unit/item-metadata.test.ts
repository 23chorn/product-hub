import { describe, it, expect } from 'vitest';
import { coerceProductArea } from '../../app/backend/src/agents/item-metadata';

describe('coerceProductArea', () => {
  it('returns a trimmed string value', () => {
    expect(coerceProductArea('  Web App  ')).toBe('Web App');
  });

  it('joins an array of selections with commas', () => {
    expect(coerceProductArea(['Web', 'iOS'])).toBe('Web, iOS');
  });

  it('returns null for an empty string', () => {
    expect(coerceProductArea('   ')).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(coerceProductArea([])).toBeNull();
  });

  it('returns null for undefined or null', () => {
    expect(coerceProductArea(undefined)).toBeNull();
    expect(coerceProductArea(null)).toBeNull();
  });

  it('returns null for a non-string, non-array value', () => {
    expect(coerceProductArea(42)).toBeNull();
    expect(coerceProductArea({ x: 1 })).toBeNull();
  });
});
