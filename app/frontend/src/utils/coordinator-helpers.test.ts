import { describe, it, expect } from 'vitest';
import {
  stripReadyMarker,
  extractReadyPayload,
  parseCriticData,
  criticSummaryLine,
} from './coordinator-helpers';

const ready = (payload: object) => `Here is my plan.\n\nCOORDINATOR_READY\n${JSON.stringify(payload)}`;

describe('stripReadyMarker', () => {
  it('removes a trailing COORDINATOR_READY block', () => {
    const text = ready({ enriched_context: 'ctx' });
    expect(stripReadyMarker(text)).toBe('Here is my plan.');
  });
  it('leaves plain text untouched', () => {
    expect(stripReadyMarker('just a message')).toBe('just a message');
  });
});

describe('extractReadyPayload', () => {
  it('returns nulls when no marker present', () => {
    expect(extractReadyPayload('no marker here')).toEqual({
      enrichedContext: null,
      kbQueries: [],
      recommendedStages: null,
      stageRationale: null,
    });
  });

  it('parses all fields from the payload', () => {
    const text = ready({
      enriched_context: 'enriched',
      kb_queries: ['q1', 'q2'],
      recommended_stages: ['analyst', 'pm_prd'],
      stage_rationale: 'because',
    });
    expect(extractReadyPayload(text)).toEqual({
      enrichedContext: 'enriched',
      kbQueries: ['q1', 'q2'],
      recommendedStages: ['analyst', 'pm_prd'],
      stageRationale: 'because',
    });
  });

  it('defaults non-array / non-string fields safely', () => {
    const text = ready({ enriched_context: 'x', kb_queries: 'nope', recommended_stages: 5 });
    const out = extractReadyPayload(text);
    expect(out.kbQueries).toEqual([]);
    expect(out.recommendedStages).toBeNull();
    expect(out.stageRationale).toBeNull();
  });

  it('returns nulls on malformed JSON after the marker', () => {
    const out = extractReadyPayload('COORDINATOR_READY\n{ broken json }');
    expect(out.enrichedContext).toBeNull();
  });
});

describe('parseCriticData', () => {
  it('extracts the critic block from coordinator_action', () => {
    const cp = { coordinator_action: JSON.stringify({ critic: { verdict: 'approve', issues: [], questions: [] } }) };
    expect(parseCriticData(cp)?.verdict).toBe('approve');
  });
  it('returns null for missing or malformed action', () => {
    expect(parseCriticData({})).toBeNull();
    expect(parseCriticData({ coordinator_action: 'not json' })).toBeNull();
  });
});

describe('criticSummaryLine', () => {
  it('returns null when no critic data', () => {
    expect(criticSummaryLine(null)).toBeNull();
  });
  it('summarises a clean approval', () => {
    expect(criticSummaryLine({ verdict: 'approve', issues: [], questions: [] }))
      .toBe('Flint approved — no issues found');
  });
  it('counts minor notes on approval', () => {
    expect(criticSummaryLine({ verdict: 'approve', issues: [{ severity: 'minor', description: 'x' }], questions: [] }))
      .toBe('Flint approved with 1 minor note');
  });
  it('summarises flagged major issues and questions', () => {
    const line = criticSummaryLine({
      verdict: 'revise',
      issues: [{ severity: 'critical', description: 'a' }, { severity: 'major', description: 'b' }],
      questions: ['q1'],
    });
    expect(line).toContain('2 major issues');
    expect(line).toContain('1 question');
  });
});
