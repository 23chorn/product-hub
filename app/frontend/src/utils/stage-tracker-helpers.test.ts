import { describe, it, expect } from 'vitest';
import { deriveStageStatus, isFeatureRefinementStage } from './stage-tracker-helpers';

describe('isFeatureRefinementStage', () => {
  it('matches per-feature wave stages and their _qa siblings', () => {
    expect(isFeatureRefinementStage('story_decomposition_F1')).toBe(true);
    expect(isFeatureRefinementStage('story_decomposition_F12')).toBe(true);
    expect(isFeatureRefinementStage('story_decomposition_F3_qa')).toBe(true);
  });

  it('does not match the base stage or unrelated stages', () => {
    expect(isFeatureRefinementStage('story_decomposition')).toBe(false);
    expect(isFeatureRefinementStage('story_decomposition_qa')).toBe(false);
    expect(isFeatureRefinementStage('pm_prd')).toBe(false);
    expect(isFeatureRefinementStage('analyst')).toBe(false);
  });
});

describe('deriveStageStatus', () => {
  it('reports at-checkpoint when the stage is pending (via either list or scalar)', () => {
    expect(deriveStageStatus('pm_prd', null, [], 'pm_prd', 'paused_at_checkpoint')).toBe('at-checkpoint');
    expect(deriveStageStatus('pm_prd', null, [], null, 'active', [], ['pm_prd'])).toBe('at-checkpoint');
  });

  it('reports in-progress only when the workflow is active', () => {
    expect(deriveStageStatus('analyst', 'analyst', [], null, 'active')).toBe('in-progress');
    // Same stage but workflow not active → not in-progress.
    expect(deriveStageStatus('analyst', 'analyst', [], null, 'paused_at_checkpoint')).toBe('pending');
  });

  it('honors the inProgressStages list for concurrent waves', () => {
    expect(deriveStageStatus('story_decomposition_F2', null, [], null, 'active', ['story_decomposition_F2'])).toBe('in-progress');
  });

  it('reports complete for a finished stage', () => {
    expect(deriveStageStatus('analyst', 'pm_prd', ['analyst'], null, 'active')).toBe('complete');
  });

  it('defaults to pending when no other condition matches', () => {
    expect(deriveStageStatus('curator', 'analyst', [], null, 'active')).toBe('pending');
  });

  it('prioritizes at-checkpoint over in-progress and complete', () => {
    // Stage is both the current (active) stage and pending → checkpoint wins.
    expect(deriveStageStatus('pm_prd', 'pm_prd', ['pm_prd'], 'pm_prd', 'active')).toBe('at-checkpoint');
  });
});
