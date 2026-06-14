import { describe, it, expect } from 'vitest';
import {
  stageGoal,
  stageProgressTarget,
  stageProgressWorking,
  STAGE_SESSION_MAP,
  STAGE_ARTIFACT_TYPE,
} from '../../app/backend/src/agents/stage-metadata';

const GOAL = 'Build price alerts';

describe('stageGoal', () => {
  it('embeds the goal in a known stage template', () => {
    const g = stageGoal('analyst', GOAL);
    expect(g).toContain(GOAL);
    expect(g.toLowerCase()).toContain('research');
  });
  it('falls back to a generic goal for unknown stages', () => {
    const g = stageGoal('mystery_stage', GOAL);
    expect(g).toContain(GOAL);
    expect(g).toContain('mystery_stage');
  });
});

describe('stageProgressTarget / stageProgressWorking', () => {
  it('returns the artifact subject for known stages', () => {
    expect(stageProgressTarget('analyst')).toBe('the Research Brief');
    expect(stageProgressTarget('pm_prd')).toBe('the PRD');
  });
  it('names the actor in the working message', () => {
    expect(stageProgressWorking('analyst')).toContain('Sage');
    expect(stageProgressWorking('prototype')).toContain('generating');
  });
  it('degrades gracefully for unknown stages', () => {
    expect(stageProgressWorking('mystery')).toContain('coordinator');
  });
});

describe('stage maps', () => {
  it('core document stages are present in both the session and artifact maps', () => {
    for (const stage of ['analyst', 'pm_prd', 'epic_feature_planner', 'solution_architect']) {
      expect(STAGE_SESSION_MAP[stage], `missing session map for ${stage}`).toBeDefined();
      expect(STAGE_ARTIFACT_TYPE[stage], `missing artifact type for ${stage}`).toBeDefined();
    }
  });
});
