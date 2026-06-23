import { describe, it, expect } from 'vitest';
import { computeFeatureWaves, resolveFeatureDependencies, collapseFeatureDecompositionStages } from '../../app/backend/src/agents/feature-decomposition';

describe('resolveFeatureDependencies', () => {
  it('returns empty deps for every feature when none declare dependsOn', () => {
    const features = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
    const { resolvedByIndex, warnings } = resolveFeatureDependencies(features);
    expect(warnings).toEqual([]);
    expect(resolvedByIndex.get(0)).toEqual([]);
    expect(resolvedByIndex.get(1)).toEqual([]);
    expect(resolvedByIndex.get(2)).toEqual([]);
  });

  it('resolves exact title matches to indices, case-insensitively', () => {
    const features = [
      { title: 'Real-time Message Delivery', dependsOn: [] },
      { title: 'Chat Room Management', dependsOn: [] },
      { title: 'Ticker Card Sharing', dependsOn: ['real-time message delivery'] },
    ];
    const { resolvedByIndex, warnings } = resolveFeatureDependencies(features);
    expect(warnings).toEqual([]);
    expect(resolvedByIndex.get(2)).toEqual([0]);
  });

  it('drops unresolved title references with a warning, never throws', () => {
    const features = [
      { title: 'A', dependsOn: [] },
      { title: 'B', dependsOn: ['Nonexistent Feature'] },
    ];
    const { resolvedByIndex, warnings } = resolveFeatureDependencies(features);
    expect(resolvedByIndex.get(1)).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/unresolved title/);
  });

  it('drops self-references with a warning', () => {
    const features = [{ title: 'A', dependsOn: ['A'] }];
    const { resolvedByIndex, warnings } = resolveFeatureDependencies(features);
    expect(resolvedByIndex.get(0)).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/lists itself/);
  });

  it('dedupes repeated dependency references', () => {
    const features = [
      { title: 'A', dependsOn: [] },
      { title: 'B', dependsOn: ['A', 'A', 'a'] },
    ];
    const { resolvedByIndex } = resolveFeatureDependencies(features);
    expect(resolvedByIndex.get(1)).toEqual([0]);
  });

  it('handles malformed/missing dependsOn gracefully', () => {
    const features = [{ title: 'A' }, { title: 'B', dependsOn: 'not-an-array' as any }, { title: 'C', dependsOn: [123 as any, null as any, ''] }];
    const { resolvedByIndex, warnings } = resolveFeatureDependencies(features);
    expect(resolvedByIndex.get(0)).toEqual([]);
    expect(resolvedByIndex.get(1)).toEqual([]);
    expect(resolvedByIndex.get(2)).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('computeFeatureWaves', () => {
  it('returns a single wave when no feature has dependencies (capped by maxConcurrency)', () => {
    const deps = [[], [], [], [], []];
    const { waves, hadCycle } = computeFeatureWaves(deps, 3);
    expect(hadCycle).toBe(false);
    expect(waves).toEqual([[0, 1, 2], [3, 4]]);
  });

  it('respects a simple linear chain (fully sequential)', () => {
    // 0 -> 1 -> 2 (1 depends on 0, 2 depends on 1)
    const deps = [[], [0], [1]];
    const { waves, hadCycle } = computeFeatureWaves(deps, 3);
    expect(hadCycle).toBe(false);
    expect(waves).toEqual([[0], [1], [2]]);
  });

  it('groups independent features into one wave and sequences dependents after', () => {
    // 0, 1, 2 independent; 3 depends on 0; 4 depends on 1 and 2
    const deps = [[], [], [], [0], [1, 2]];
    const { waves, hadCycle } = computeFeatureWaves(deps, 3);
    expect(hadCycle).toBe(false);
    expect(waves).toEqual([[0, 1, 2], [3, 4]]);
  });

  it('every feature index appears in exactly one wave, exactly once', () => {
    const deps = [[], [0], [], [1, 2], []];
    const { waves } = computeFeatureWaves(deps, 2);
    const flat = waves.flat();
    expect(flat.length).toBe(deps.length);
    expect(new Set(flat).size).toBe(deps.length);
  });

  it('falls back to fully sequential single-member waves on a cycle, dropping no feature', () => {
    // 0 <-> 1 form a cycle; 2 is independent
    const deps = [[1], [0], []];
    const { waves, hadCycle, cycleMembers } = computeFeatureWaves(deps, 3);
    expect(hadCycle).toBe(true);
    // feature 2 (acyclic) is layered normally before the cycle is broken
    expect(waves[0]).toEqual([2]);
    // the cyclic pair degrades to single-member waves, in index order
    expect(waves.slice(1)).toEqual([[0], [1]]);
    expect(cycleMembers.sort()).toEqual([0, 1]);
    const flat = waves.flat();
    expect(new Set(flat).size).toBe(deps.length);
  });

  it('handles empty input', () => {
    const { waves, hadCycle } = computeFeatureWaves([], 3);
    expect(waves).toEqual([]);
    expect(hadCycle).toBe(false);
  });

  it('treats out-of-range or self-referencing dependency indices as no-ops', () => {
    const deps = [[0], [99], []];
    const { waves, hadCycle } = computeFeatureWaves(deps, 3);
    expect(hadCycle).toBe(false);
    expect(waves).toEqual([[0, 1, 2]]);
  });
});

describe('collapseFeatureDecompositionStages', () => {
  it('returns the sequence unchanged when no feature-wave stages are present', () => {
    const sequence = ['analyst', 'pm_prd', 'epic_feature_planner', 'story_decomposition', 'curator'];
    expect(collapseFeatureDecompositionStages(sequence)).toEqual(sequence);
  });

  it('collapses a single wave of feature stages plus backlog_merge back into story_decomposition', () => {
    const sequence = [
      'analyst', 'pm_prd', 'epic_feature_planner',
      'story_decomposition_F1', 'story_decomposition_F2', 'backlog_merge',
      'curator',
    ];
    expect(collapseFeatureDecompositionStages(sequence)).toEqual([
      'analyst', 'pm_prd', 'epic_feature_planner', 'story_decomposition', 'curator',
    ]);
  });

  it('collapses multiple sequential waves of feature stages into one placeholder', () => {
    // wave 1: F1, F2 run concurrently; wave 2: F3 depends on one of them
    const sequence = [
      'analyst', 'epic_feature_planner',
      'story_decomposition_F1', 'story_decomposition_F2', 'story_decomposition_F3',
      'backlog_merge', 'curator',
    ];
    expect(collapseFeatureDecompositionStages(sequence)).toEqual([
      'analyst', 'epic_feature_planner', 'story_decomposition', 'curator',
    ]);
  });

  it('collapses even without a trailing backlog_merge entry', () => {
    const sequence = ['analyst', 'story_decomposition_F1', 'story_decomposition_F2'];
    expect(collapseFeatureDecompositionStages(sequence)).toEqual(['analyst', 'story_decomposition']);
  });

  it('is idempotent — collapsing an already-collapsed sequence is a no-op', () => {
    const sequence = ['analyst', 'pm_prd', 'story_decomposition', 'curator'];
    expect(collapseFeatureDecompositionStages(collapseFeatureDecompositionStages(sequence))).toEqual(sequence);
  });
});
