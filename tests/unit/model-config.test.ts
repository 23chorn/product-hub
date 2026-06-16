import { describe, it, expect } from 'vitest';
import { modelMaxOutputTokens, PROVIDER_MODELS } from '../../app/backend/src/utils/model-config';

describe('modelMaxOutputTokens', () => {
  it('returns a positive default for unknown models', () => {
    expect(modelMaxOutputTokens('totally-unknown-model')).toBeGreaterThan(0);
  });
  it('returns a finite number for every known model', () => {
    for (const models of Object.values(PROVIDER_MODELS)) {
      for (const m of models) {
        const n = modelMaxOutputTokens(m.id);
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    }
  });
});
