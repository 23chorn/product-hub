import { describe, it, expect } from 'vitest';
import {
  stageGoal,
  stageProgressTarget,
  stageProgressWorking,
  STAGE_SESSION_MAP,
  STAGE_ARTIFACT_TYPE,
  checkpointArtifactLabel,
  progressHeartbeatLine,
  airtableStatusForStage,
  stageNotDecide,
  resolveMaxOutputTokens,
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

describe('resolveMaxOutputTokens', () => {
  it('returns the base ceiling unchanged for a fresh generation', () => {
    expect(resolveMaxOutputTokens(12_000, false)).toBe(12_000);
  });
  it('boosts the ceiling for a revision call, since it must reproduce the full prior draft plus the edit', () => {
    expect(resolveMaxOutputTokens(12_000, true)).toBe(18_000);
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

describe('checkpointArtifactLabel', () => {
  it('resolves a static stage to its artifact label', () => {
    expect(checkpointArtifactLabel('pm_prd')).toBe('PRD');
  });
  it('resolves dynamic per-feature story decomposition stages', () => {
    expect(checkpointArtifactLabel('story_decomposition_F3')).toBe('Stories');
  });
  it('resolves dynamic per-feature QA stages by suffix, regardless of the static map', () => {
    expect(checkpointArtifactLabel('story_decomposition_F3_qa')).toBe('QA Tests');
    expect(checkpointArtifactLabel('anything_qa')).toBe('QA Tests');
  });
  it('falls back to the raw stage key when unmapped', () => {
    expect(checkpointArtifactLabel('mystery_stage')).toBe('mystery_stage');
  });
});

describe('progressHeartbeatLine', () => {
  it('reports "preparing" before any visible output has been drafted', () => {
    expect(progressHeartbeatLine('Writing PRD', 12, 0)).toBe('Writing PRD — 12s elapsed, preparing before drafting begins...');
    expect(progressHeartbeatLine('Writing PRD', 12, 199)).toContain('preparing before drafting begins');
  });
  it('reports rounded k-chars once past the 200-char threshold', () => {
    expect(progressHeartbeatLine('Writing PRD', 30, 200)).toBe('Writing PRD — 30s elapsed, 1k chars drafted');
    expect(progressHeartbeatLine('Writing PRD', 30, 2500)).toBe('Writing PRD — 30s elapsed, 3k chars drafted');
  });
});

describe('airtableStatusForStage', () => {
  it('maps known stages to their Airtable status', () => {
    expect(airtableStatusForStage('analyst')).toBe('Researching');
    expect(airtableStatusForStage('solution_architect')).toBe('Architecting');
  });
  it('maps any per-feature story decomposition stage to the shared status', () => {
    expect(airtableStatusForStage('story_decomposition_F1')).toBe('Refining');
    expect(airtableStatusForStage('story_decomposition_F2')).toBe('Refining');
  });
  it('returns null for stages with no corresponding Airtable status', () => {
    expect(airtableStatusForStage('critic')).toBeNull();
    expect(airtableStatusForStage('prototype')).toBeNull();
  });
});

describe('stageNotDecide', () => {
  it('returns stage-specific boundaries for a known stage', () => {
    expect(stageNotDecide('analyst').toLowerCase()).toContain('do not propose product solutions');
  });
  it('falls back to a generic scope boundary for an unknown stage', () => {
    expect(stageNotDecide('mystery_stage')).toBe('Follow the output format and scope defined above. Do not add scope that was not in the workflow goal.');
  });
});
