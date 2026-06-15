import { describe, it, expect } from 'vitest';
import { eventToMessage } from './event-to-message';

const base = {
  id: 1,
  workflow_id: 'w1',
  stage: 'analyst',
  details: null as string | null,
  created_at: 1000,
};

describe('eventToMessage', () => {
  it('maps a plain event to a coordinator message', () => {
    const msg = eventToMessage({ ...base, event_type: 'stage_progress', summary: 'Working…' });
    expect(msg).toMatchObject({
      role: 'coordinator',
      content: 'Working…',
      timestamp: 1000,
      eventType: 'stage_progress',
      stage: 'analyst',
    });
  });

  it('appends a wiki URL on stage_completed', () => {
    const msg = eventToMessage({
      ...base,
      event_type: 'stage_completed',
      summary: 'Research done',
      details: JSON.stringify({ wiki_url: 'https://wiki/x' }),
    });
    expect(msg!.content).toBe('Research done\n→ https://wiki/x');
  });

  it('formats a passing critic verdict', () => {
    const msg = eventToMessage({
      ...base,
      event_type: 'critic_verdict',
      summary: 'review',
      details: JSON.stringify({ critic_verdict: 'approve', issue_count: 0, reviewed_stage: 'analyst' }),
    });
    expect(msg!.content).toContain('Quality Review');
    expect(msg!.content).toContain('✓');
  });

  it('formats a board (epic) sync with counts', () => {
    const msg = eventToMessage({
      ...base,
      event_type: 'board_synced',
      summary: 'pushed',
      details: JSON.stringify({ top_id: 42, top_url: 'https://ado/42', level: 'epic', feature_count: 3, story_count: 1 }),
    });
    expect(msg!.content).toContain('Epic #42 created on Azure DevOps');
    expect(msg!.content).toContain('3 features');
    expect(msg!.content).toContain('1 story');
    expect(msg!.content).toContain('→ https://ado/42');
  });

  it('falls back to the raw summary on malformed details', () => {
    const msg = eventToMessage({ ...base, event_type: 'critic_verdict', summary: 'raw', details: '{bad json' });
    expect(msg!.content).toBe('raw');
  });

  it('passes through undefined stage', () => {
    const msg = eventToMessage({ ...base, stage: null, event_type: 'heartbeat', summary: 'tick' });
    expect(msg!.stage).toBeUndefined();
  });
});
