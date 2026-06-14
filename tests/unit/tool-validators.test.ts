import { describe, it, expect } from 'vitest';
import { validateAnalystJson } from '../../app/backend/src/agents/tool-validators';

/** Parse a validator's stringified result. */
function run(json: unknown): { valid: boolean; issues?: string[] } {
  return JSON.parse(validateAnalystJson({ json: typeof json === 'string' ? json : JSON.stringify(json) }));
}

const validAnalyst = {
  title: 'Price Alerts Research',
  executive_summary: 'The market is large [1] and growing.',
  problem_space: 'Investors miss price moves.',
  conclusion: 'Build alerts.',
  market_size: { tam: '$5B', growth_cagr: '12%', key_driver: 'mobile trading' },
  target_users: [
    { segment: 'Retail', job_to_be_done: 'watch prices', current_workaround: 'limit orders', key_frustration: 'unintended fills' },
  ],
  competitive_landscape: [
    { player: 'Us', strength: 'native', gap: 'none' },
    { player: 'Rival', strength: 'reach', gap: 'no alerts' },
  ],
  constraints_and_risks: [{ risk: 'latency', mitigation: 'websocket' }],
  strategic_recommendations: ['Ship MVP', 'Measure latency'],
  references: [{ id: 1, title: 'Market report', url: 'https://reports.example-real.org/x' }],
};

describe('validateAnalystJson', () => {
  it('accepts a well-formed analyst brief', () => {
    const r = run(validAnalyst);
    expect(r.valid).toBe(true);
  });

  it('rejects non-string / empty json input', () => {
    expect(JSON.parse(validateAnalystJson({ json: '' })).valid).toBe(false);
    expect(JSON.parse(validateAnalystJson({} as any)).valid).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const r = JSON.parse(validateAnalystJson({ json: '{ not json' }));
    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/Invalid JSON/);
  });

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(validAnalyst) + '\n```';
    expect(JSON.parse(validateAnalystJson({ json: fenced })).valid).toBe(true);
  });

  it('flags missing required root fields', () => {
    const { title, ...rest } = validAnalyst;
    const r = run(rest);
    expect(r.valid).toBe(false);
    expect(r.issues).toContain('root: missing or empty "title"');
  });

  it('requires at least two competitive entries', () => {
    const r = run({ ...validAnalyst, competitive_landscape: [validAnalyst.competitive_landscape[0]] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('competitive_landscape'))).toBe(true);
  });

  it('flags placeholder reference URLs', () => {
    const r = run({
      ...validAnalyst,
      references: [{ id: 1, title: 'x', url: 'https://example.com/foo' }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('placeholder URL'))).toBe(true);
  });

  it('requires inline citations in the executive summary', () => {
    const r = run({ ...validAnalyst, executive_summary: 'No citations here.' });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('inline citations'))).toBe(true);
  });

  it('requires market_size sub-fields', () => {
    const r = run({ ...validAnalyst, market_size: { tam: '$5B' } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('market_size'))).toBe(true);
  });
});
