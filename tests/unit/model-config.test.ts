import { describe, it, expect } from 'vitest';
import {
  modelMaxOutputTokens,
  estimateCost,
  calculateCost,
  MODEL_PRICING,
  WEB_SEARCH_COST_PER_QUERY,
} from '../../app/backend/src/utils/model-config';

describe('modelMaxOutputTokens', () => {
  it('returns a positive default for unknown models', () => {
    expect(modelMaxOutputTokens('totally-unknown-model')).toBeGreaterThan(0);
  });
  it('returns a finite number for every priced model', () => {
    for (const model of Object.keys(MODEL_PRICING)) {
      const n = modelMaxOutputTokens(model);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });
});

describe('calculateCost', () => {
  const model = Object.keys(MODEL_PRICING)[0];
  const p = MODEL_PRICING[model];

  it('computes token cost from the pricing table', () => {
    const cost = calculateCost(model, 1_000_000, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(p.input + p.output, 6);
  });

  it('adds web-search cost per query', () => {
    const base = calculateCost(model, 0, 0, 0, 0, 0);
    const withSearch = calculateCost(model, 0, 0, 0, 0, 3);
    expect(withSearch - base).toBeCloseTo(3 * WEB_SEARCH_COST_PER_QUERY, 9);
  });

  it('returns 0 for an unknown model with no searches', () => {
    expect(calculateCost('unknown', 1000, 0, 0, 1000)).toBe(0);
  });

  it('still charges search cost for an unknown model', () => {
    expect(calculateCost('unknown', 0, 0, 0, 0, 2)).toBeCloseTo(2 * WEB_SEARCH_COST_PER_QUERY, 9);
  });
});

describe('estimateCost', () => {
  const model = Object.keys(MODEL_PRICING)[0];

  it('returns a formatted cost annotation for known models', () => {
    const s = estimateCost(model, 1000, 0, 0, 500);
    expect(s).toMatch(/cost ~\$\d+\.\d{6}/);
  });

  it('returns an empty string for unknown models with no searches', () => {
    expect(estimateCost('unknown', 1000, 0, 0, 500)).toBe('');
  });

  it('notes search counts when present', () => {
    expect(estimateCost(model, 0, 0, 0, 0, 2)).toContain('searches=2');
  });
});
