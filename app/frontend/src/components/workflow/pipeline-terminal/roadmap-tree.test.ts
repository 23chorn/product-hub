import { describe, it, expect } from 'vitest';
import { buildRoadmapTree } from './roadmap-tree';

const allPending = () => 'pending' as const;

describe('buildRoadmapTree', () => {
  it('groups a single phase with no branch split', () => {
    const stages = ['analyst', 'story_decomposition_F1', 'story_decomposition_F2', 'curator'];
    const nodes = buildRoadmapTree(stages, ['MVP', 'MVP'], allPending);
    const stageNames = nodes.filter(n => n.kind === 'stage').map(n => n.stageName);
    expect(stageNames).toEqual(['analyst', 'story_decomposition_F1', 'story_decomposition_F2', 'curator']);
  });

  it('keeps every feature of a phase together even when wave order interleaves phases', () => {
    // Declared order: F1, F2 = Phase A; F3, F4 = Phase B.
    // Wave order (as it would appear in stage_sequence after dependency-based
    // scheduling) interleaves them: wave 1 = [F1, F3], wave 2 = [F2, F4].
    const stages = [
      'epic_feature_planner',
      'story_decomposition_F1',
      'story_decomposition_F3',
      'story_decomposition_F2',
      'story_decomposition_F4',
      'backlog_merge',
    ];
    const phaseLabels = ['Phase A', 'Phase A', 'Phase B', 'Phase B'];
    const nodes = buildRoadmapTree(stages, phaseLabels, allPending);

    const branches = nodes.filter(n => n.kind === 'branch');
    const phaseBranches = branches.filter(b => b.key.startsWith('phase-'));
    // Exactly one branch per phase — not split into multiple disjoint groups.
    expect(phaseBranches.map(b => b.label)).toEqual(['Phase A', 'Phase B']);

    const stageNodes = nodes.filter((n): n is Extract<typeof n, { kind: 'stage' }> => n.kind === 'stage' && n.nested);
    const stageNames = stageNodes.map(n => n.stageName);
    // Phase A's features (F1, F2) are contiguous, in declared order, followed by
    // Phase B's (F3, F4) — not the interleaved wave order [F1, F3, F2, F4].
    expect(stageNames).toEqual([
      'story_decomposition_F1',
      'story_decomposition_F2',
      'story_decomposition_F3',
      'story_decomposition_F4',
    ]);
  });

  it('orders features within a phase by feature index even when the run lists them out of order', () => {
    const stages = ['story_decomposition_F2', 'story_decomposition_F1', 'story_decomposition_F3'];
    const nodes = buildRoadmapTree(stages, ['MVP', 'MVP', 'MVP'], allPending);
    const stageNames = nodes.filter(n => n.kind === 'stage').map(n => n.stageName);
    expect(stageNames).toEqual(['story_decomposition_F1', 'story_decomposition_F2', 'story_decomposition_F3']);
  });
});
