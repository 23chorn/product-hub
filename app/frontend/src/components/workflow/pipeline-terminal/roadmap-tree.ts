import type { StageStatus } from '../../../stores/workflowStore';

/** Builds the box-drawing tree shown in the left-rail roadmap. Only stages that
 *  actually have sub-sections get tree glyphs: flat stages render as plain rows,
 *  but a contiguous run of per-feature refinement stages (story_decomposition_F1,
 *  F2, ...) is grouped under a "Refinement" branch — further split into phase
 *  sub-branches when more than one phase is present — so phase → feature
 *  containment is shown structurally instead of a subtitle line.
 *
 *  Grouping and ordering are both by declared feature order (F1, F2, F3, ... — i.e.
 *  the epic_features artifact's phase → feature order), NOT by `stages`' refinement/
 *  wave order. Independent features get parallelized into waves purely by dependency
 *  layering, so a wave can freely mix features from different phases (e.g. wave 1 =
 *  [F1, F3], wave 2 = [F2]) — walking `stages` directly would then split a single
 *  phase into multiple disjoint branches, or show F3 before F2. Wave order is a
 *  transient execution detail, not the roadmap's identity, so it's surfaced elsewhere
 *  (a "wave N" badge) rather than reordering this tree. */

export type RoadmapNode =
  | { kind: 'stage'; stageName: string; prefix: string; nested: boolean; featureIndex?: number }
  | { kind: 'branch'; key: string; label: string; prefix: string; status: StageStatus };

const FEATURE_STAGE_RE = /^story_decomposition_F(\d+)$/;

/** Rolls a group of leaf statuses up into one status for their branch header, so a
 *  branch row carries the same StatusIcon as any stage row instead of being iconless.
 *  A branch (Refinement, or a phase within it) reads as "in progress" from the moment
 *  any child has started or finished until every child is complete — not just while a
 *  child happens to be actively running — so it doesn't flicker back to "pending"
 *  during the gap between one feature finishing and the next one starting. */
function aggregateStatus(names: string[], getStatus: (stageName: string) => StageStatus): StageStatus {
  const statuses = names.map(getStatus);
  if (statuses.some(s => s === 'rejected')) return 'rejected';
  if (statuses.some(s => s === 'at-checkpoint')) return 'at-checkpoint';
  if (statuses.every(s => s === 'complete')) return 'complete';
  if (statuses.some(s => s === 'complete' || s === 'in-progress')) return 'in-progress';
  if (statuses.every(s => s === 'skipped')) return 'skipped';
  return 'pending';
}

export function buildRoadmapTree(
  stages: string[],
  phaseLabels: string[],
  getStatus: (stageName: string) => StageStatus,
  phaseEpicTitles: Record<string, string> = {},
): RoadmapNode[] {
  const nodes: RoadmapNode[] = [];
  let i = 0;

  while (i < stages.length) {
    const stage = stages[i];
    if (!FEATURE_STAGE_RE.test(stage)) {
      nodes.push({ kind: 'stage', stageName: stage, prefix: '', nested: false });
      i++;
      continue;
    }

    const runStart = i;
    while (i < stages.length && FEATURE_STAGE_RE.test(stages[i])) i++;
    const run = stages.slice(runStart, i);

    // A single feature is just one row — no branch worth drawing.
    if (run.length === 1) {
      const idx = parseInt(run[0].match(FEATURE_STAGE_RE)![1], 10) - 1;
      nodes.push({ kind: 'stage', stageName: run[0], prefix: '', nested: false, featureIndex: idx });
      continue;
    }

    nodes.push({ kind: 'branch', key: 'refinement', label: 'Refinement', prefix: '', status: aggregateStatus(run, getStatus) });

    const featureIndexOf = (s: string) => parseInt(s.match(FEATURE_STAGE_RE)![1], 10) - 1;
    // Walk the run in declared (F1, F2, F3, ...) order rather than however `stages`
    // happens to list them, so parallel-wave scheduling can't reorder this tree.
    const byFeatureOrder = [...run].sort((a, b) => featureIndexOf(a) - featureIndexOf(b));

    // Group by phase, in each phase's first-seen order along the declared sequence —
    // every feature for a phase lands in that phase's single group even when other
    // phases' features are interleaved between them in `stages`.
    const groups: { phase: string | undefined; stageNames: string[] }[] = [];
    const groupByPhase = new Map<string | undefined, string[]>();
    for (const s of byFeatureOrder) {
      const phase = phaseLabels[featureIndexOf(s)];
      let stageNames = groupByPhase.get(phase);
      if (!stageNames) {
        stageNames = [];
        groupByPhase.set(phase, stageNames);
        groups.push({ phase, stageNames });
      }
      stageNames.push(s);
    }
    const distinctPhases = new Set(groups.map(g => g.phase).filter(Boolean));

    if (distinctPhases.size <= 1) {
      // No meaningful phase split — features hang directly off "Refinement".
      byFeatureOrder.forEach((s, j) => {
        const isLast = j === byFeatureOrder.length - 1;
        nodes.push({ kind: 'stage', stageName: s, prefix: isLast ? '└─ ' : '├─ ', nested: true, featureIndex: featureIndexOf(s) });
      });
    } else {
      groups.forEach((g, gi) => {
        const groupIsLast = gi === groups.length - 1;
        const phaseLabel = g.phase ?? 'Other';
        const epicTitle = g.phase ? phaseEpicTitles[g.phase] : undefined;
        // Epic titles often already say the phase (e.g. epic "MVP Rollout" for phase
        // "MVP") — in that case the epic title alone is enough; only append it
        // separately when it doesn't already mention the phase name.
        const label = epicTitle && !epicTitle.toLowerCase().includes(phaseLabel.toLowerCase())
          ? `${phaseLabel} — ${epicTitle}`
          : (epicTitle ?? phaseLabel);
        nodes.push({
          kind: 'branch',
          key: `phase-${gi}`,
          label,
          prefix: groupIsLast ? '└─ ' : '├─ ',
          status: aggregateStatus(g.stageNames, getStatus),
        });
        g.stageNames.forEach((s, si) => {
          const isLast = si === g.stageNames.length - 1;
          const cont = groupIsLast ? '   ' : '│  ';
          nodes.push({ kind: 'stage', stageName: s, prefix: `${cont}${isLast ? '└─ ' : '├─ '}`, nested: true, featureIndex: featureIndexOf(s) });
        });
      });
    }
  }

  return nodes;
}
