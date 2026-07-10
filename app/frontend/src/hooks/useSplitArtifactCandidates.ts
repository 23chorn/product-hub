import { useEffect, useState } from 'react';
import { STAGE_PERSONAS } from '@pap/shared';
import { useWorkflowStore, type WorkflowCheckpoint } from '../stores/workflowStore';
import { ARTIFACT_TYPE_LABELS, STAGE_LABELS } from '../constants/stage-labels';
import { api } from '../services/api';
import { deriveEpicFeaturesArtifactId } from '../utils/feature-artifacts';
import { tryParseEpicFeatures, toPhases } from '../components/artifact/EpicFeaturesView';

export interface SplitArtifactCandidate {
  id: number;
  label: string;
  order: number;
}

const FEATURE_STAGE_RE = /^story_decomposition_F(\d+)$/;
const FEATURE_ARTIFACT_RE = /^backlog_F(\d+)$/;

/** F-index (1-based, across all phases) -> feature title, from the epic_feature_planner
 *  artifact — powers the "F1 - <feature title>" labels for per-feature backlog candidates. */
function buildFeatureTitleMap(content: string): Record<number, string> {
  const parsed = tryParseEpicFeatures(content);
  const map: Record<number, string> = {};
  if (!parsed) return map;
  let idx = 0;
  for (const phase of toPhases(parsed)) {
    for (const feature of phase.features ?? []) {
      idx += 1;
      map[idx] = feature.title;
    }
  }
  return map;
}

/**
 * Documents from the active workflow that can be opened in the split-view companion pane
 * (see SplitArtifactPane) alongside whatever is currently being reviewed — e.g. keep the
 * PRD visible while reviewing the backlog. Only the final (most recent) artifact per stage
 * is offered — a revised/retried stage produces multiple checkpoints, and older versions
 * aren't useful comparison targets. Ordered to match the workflow's actual stage_sequence
 * rather than checkpoint creation time.
 *
 * Labels favor the plain document name (ARTIFACT_TYPE_LABELS / STAGE_PERSONAS role) over the
 * persona-flavored stage label ("Requirements", not "Requirements — Rex"), and per-feature
 * backlog artifacts are named "F1 - <feature title>" rather than their internal "Refinement"
 * stage name.
 */
export function useSplitArtifactCandidates(excludeArtifactId?: number | null): SplitArtifactCandidate[] {
  const { checkpoints, activeWorkflow } = useWorkflowStore();
  const [featureTitles, setFeatureTitles] = useState<Record<number, string>>({});
  const epicFeaturesArtifactId = deriveEpicFeaturesArtifactId(checkpoints);

  useEffect(() => {
    if (!epicFeaturesArtifactId) { setFeatureTitles({}); return; }
    let stale = false;
    api.getArtifactContent(epicFeaturesArtifactId)
      .then(({ content }) => { if (!stale) setFeatureTitles(buildFeatureTitleMap(content)); })
      .catch(() => {});
    return () => { stale = true; };
  }, [epicFeaturesArtifactId]);

  const stageOrder: string[] = activeWorkflow ? JSON.parse(activeWorkflow.stage_sequence || '[]') : [];
  const finalByStage = new Map<string, WorkflowCheckpoint>();
  for (const c of checkpoints) {
    if (!c.artifact_id) continue;
    const existing = finalByStage.get(c.stage);
    if (!existing || c.created_at > existing.created_at) finalByStage.set(c.stage, c);
  }

  return [...finalByStage.values()]
    .filter(c => c.artifact_id !== excludeArtifactId)
    .map(c => ({ checkpoint: c, type: c.artifact?.type ?? c.stage }))
    // Prototypes render as a standalone interactive preview (iframe + file tree) — they're
    // never useful squeezed into a half-width comparison pane, so exclude them entirely.
    .filter(({ type }) => type !== 'prototype')
    .map(({ checkpoint: c, type }) => {
      const orderIdx = stageOrder.indexOf(c.stage);
      const featureNum = FEATURE_ARTIFACT_RE.exec(type)?.[1] ?? FEATURE_STAGE_RE.exec(type)?.[1];
      const label = featureNum
        ? `F${featureNum}${featureTitles[Number(featureNum)] ? ` - ${featureTitles[Number(featureNum)]}` : ''}`
        : ARTIFACT_TYPE_LABELS[type] ?? STAGE_PERSONAS[c.stage]?.role ?? STAGE_LABELS[type] ?? type;
      return {
        id: c.artifact_id as number,
        label,
        order: orderIdx === -1 ? Infinity : orderIdx,
      };
    })
    .sort((a, b) => a.order - b.order);
}
