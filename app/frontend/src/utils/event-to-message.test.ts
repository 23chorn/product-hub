import { describe, it, expect } from 'vitest';
import { eventToMessage, lastProgressIndexForStage } from './event-to-message';

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

  it('shows the feature link on a story_decomposition_F* base-stage push', () => {
    const msg = eventToMessage({
      ...base,
      stage: 'story_decomposition_F1',
      event_type: 'ado_pushed',
      summary: 'Feature 1 stories pushed to Azure DevOps',
      details: JSON.stringify({ feature_url: 'https://ado/feature/1' }),
    });
    expect(msg!.content).toBe('Feature 1 stories pushed to Azure DevOps\n→ View Feature: https://ado/feature/1');
  });

  it('shows the test plan link on a story_decomposition_F*_qa push', () => {
    const msg = eventToMessage({
      ...base,
      stage: 'story_decomposition_F1_qa',
      event_type: 'ado_pushed',
      summary: 'Feature 1 test cases pushed to Azure DevOps',
      details: JSON.stringify({ test_plan_url: 'https://ado/plan/1' }),
    });
    expect(msg!.content).toBe('Feature 1 test cases pushed to Azure DevOps\n→ View Test Plan: https://ado/plan/1');
  });

  it('shows both links when a single event carries both (legacy combined push)', () => {
    const msg = eventToMessage({
      ...base,
      stage: 'story_decomposition_F1_qa',
      event_type: 'ado_pushed',
      summary: 'Feature 1 stories & test cases pushed to Azure DevOps',
      details: JSON.stringify({ feature_url: 'https://ado/feature/1', test_plan_url: 'https://ado/plan/1' }),
    });
    expect(msg!.content).toBe(
      'Feature 1 stories & test cases pushed to Azure DevOps\n→ View Feature: https://ado/feature/1\n→ View Test Plan: https://ado/plan/1'
    );
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

describe('lastProgressIndexForStage', () => {
  it('returns -1 when no progress line exists for the stage', () => {
    const msgs = [{ isProgress: true, stage: 'story_decomposition_F1' }];
    expect(lastProgressIndexForStage(msgs, 'story_decomposition_F2')).toBe(-1);
  });

  it('finds each parallel feature\'s own progress line independently', () => {
    // Interleaved parallel-wave progress lines — one per feature stage.
    const msgs = [
      { isProgress: true, stage: 'story_decomposition_F1' },
      { isProgress: true, stage: 'story_decomposition_F2' },
      { isProgress: true, stage: 'story_decomposition_F3' },
    ];
    expect(lastProgressIndexForStage(msgs, 'story_decomposition_F1')).toBe(0);
    expect(lastProgressIndexForStage(msgs, 'story_decomposition_F2')).toBe(1);
    expect(lastProgressIndexForStage(msgs, 'story_decomposition_F3')).toBe(2);
  });

  it('ignores non-progress messages and returns the most recent match', () => {
    const msgs = [
      { isProgress: true, stage: 'analyst' },
      { isProgress: false, stage: 'analyst' }, // a completed/verdict line, not live status
      { isProgress: true, stage: 'analyst' },
    ];
    expect(lastProgressIndexForStage(msgs, 'analyst')).toBe(2);
  });
});
