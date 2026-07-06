import type { ReactNode } from 'react';
import { tryParseBacklog, isBacklogArtifactType } from '@pap/shared';
import { removeStoryFromBacklog, removeTestCaseFromStory } from '../../utils/backlog-helpers';
import { deriveFeatureButtons, deriveEpicFeaturesArtifactId } from '../../utils/feature-artifacts';
import { BacklogView } from './BacklogView';
import { BacklogStoriesTests } from './BacklogOverviewModal';
import { EpicFeaturesView, tryParseEpicFeatures, removePhase, removeFeatureFromPhase } from './EpicFeaturesView';
import { ArtifactTabShell } from './ArtifactPrimitives';
import { tryParseQATests } from '@pap/shared';
import { QATestsView, removeTestCase } from './QATestsView';
import { TechRefinementView, tryParseTechRefinement } from './TechRefinementView';
import { PrototypePreview, type PrototypeData } from '../coordinator/PrototypePreview';
import { renderArtifactMarkdown, isDocumentArtifact } from '@pap/shared';
import { MarkdownContent } from '../common/MarkdownContent';
import type { WorkflowRow, WorkflowCheckpoint } from '../../stores/workflowStore';

export interface ArtifactViewContext {
  artifactType: string;
  activeWorkflow: WorkflowRow | null;
  checkpoints: WorkflowCheckpoint[];
  pendingCheckpoint?: WorkflowCheckpoint;
  hasApprovePermission: boolean;
  resolveLoading: boolean;
  /** FR id→text and NFR id→text maps from the PRD artifact — used for hover tooltips on prdRef badges. */
  frMap?: Record<string, string>;
  nfrMap?: Record<string, string>;
  /** Rerun the current stage (used by the incomplete-artifact recovery prompt). */
  rerunStage: () => void;
  /** Close the artifact drawer. */
  onClose: () => void;
  /** Surgically delete one item from the artifact and save (no LLM call) — only provided
   *  while actively reviewing a pending checkpoint with approve permission; undefined for
   *  read-only/historical views, which keeps delete buttons from rendering there. */
  requestDelete?: (itemLabel: string, computeNewContent: () => string) => void;
}

/**
 * Pick and render the body view for a (non-empty) artifact's content. This is the single
 * place that maps an artifactType to its specialised view — add a new structured view here.
 *
 * Order matters: structured parsers are tried first, then the incomplete-JSON recovery
 * prompt for JSON stage types, then prototype, then the document→markdown converter, and
 * finally a raw-markdown fallback.
 */
export function renderStructuredArtifact(content: string, ctx: ArtifactViewContext): ReactNode {
  const { artifactType, activeWorkflow, checkpoints, pendingCheckpoint, hasApprovePermission, resolveLoading, frMap, nfrMap, rerunStage, onClose, requestDelete } = ctx;

  const initiativeTitle = activeWorkflow?.summary ?? activeWorkflow?.goal?.split('\n')[0];
  const epicFeaturesArtifactId = deriveEpicFeaturesArtifactId(checkpoints);
  const prdArtifactId = checkpoints.find(c => c.stage === 'pm_prd' && c.artifact_id != null)?.artifact_id ?? null;

  // The final cross-feature merge ('backlog' exactly, not the per-feature 'backlog_F<n>'
  // artifacts) — show the same Stories/Tests tabbed view as the pipeline's "Stories/Tests"
  // button, rather than a bare read of this one snapshot with no tests alongside it and no
  // epic_features enrichment.
  if (artifactType === 'backlog') {
    return (
      <BacklogStoriesTests
        featureButtons={deriveFeatureButtons(checkpoints)}
        initiativeTitle={initiativeTitle}
        epicFeaturesArtifactId={epicFeaturesArtifactId}
        prdArtifactId={prdArtifactId}
      />
    );
  }

  // Per-feature refinement backlog (backlog_F<n>) — Stories-only tab view using
  // already-loaded artifact content; QA tests are a separate checkpoint reviewed
  // independently, so the Tests tab is intentionally absent here.
  if (/^backlog_F\d+$/.test(artifactType) && content) {
    const featureBacklogData = tryParseBacklog(content);
    if (featureBacklogData) {
      const previewFeature = featureBacklogData.features?.[0] ?? featureBacklogData.feature;
      const storyCount = previewFeature?.stories?.length ?? 0;
      return (
        <ArtifactTabShell
          tabs={[{ id: 'stories', label: 'Stories', count: storyCount > 0 ? storyCount : undefined }]}
          activeTab="stories"
          onTabChange={() => {}}
        >
          <BacklogView
            data={featureBacklogData}
            isFeaturePreview
            initiativeTitle={initiativeTitle}
            frMap={frMap}
            nfrMap={nfrMap}
            onDeleteStory={requestDelete ? (storyIndex) => {
              const story = previewFeature?.stories[storyIndex];
              if (!story) return;
              requestDelete(`story "${story.title}"`, () => JSON.stringify(removeStoryFromBacklog(featureBacklogData, storyIndex)));
            } : undefined}
            onDeleteTestCase={requestDelete ? (storyIndex, testCaseIndex) => {
              const tc = previewFeature?.stories[storyIndex]?.test_cases?.[testCaseIndex];
              if (!tc) return;
              requestDelete(`test case "${tc.id}"`, () => JSON.stringify(removeTestCaseFromStory(featureBacklogData, storyIndex, testCaseIndex)));
            } : undefined}
          />
        </ArtifactTabShell>
      );
    }
  }

  const epicFeaturesData = artifactType === 'epic_features' ? tryParseEpicFeatures(content) : null;
  const backlogData = isBacklogArtifactType(artifactType) ? tryParseBacklog(content) : null;
  const techData = isBacklogArtifactType(artifactType) && !backlogData ? tryParseTechRefinement(content) : null;

  if (epicFeaturesData) return (
    <ArtifactTabShell tabs={[{ id: 'plan', label: 'Epic Plan' }]} activeTab="plan" onTabChange={() => {}}>
      <EpicFeaturesView
        data={epicFeaturesData}
        initiativeTitle={initiativeTitle}
        frMap={frMap}
        nfrMap={nfrMap}
        onDeletePhase={requestDelete ? (phaseIndex) => {
          const phase = epicFeaturesData.phases?.[phaseIndex];
          if (!phase) return;
          requestDelete(`epic "${phase.epicTitle ?? phase.label}"`, () => JSON.stringify(removePhase(epicFeaturesData, phaseIndex)));
        } : undefined}
        onDeleteFeature={requestDelete ? (phaseIndex, featureIndex) => {
          const feature = epicFeaturesData.phases?.[phaseIndex]?.features[featureIndex];
          if (!feature) return;
          requestDelete(`feature "${feature.title}"`, () => JSON.stringify(removeFeatureFromPhase(epicFeaturesData, phaseIndex, featureIndex)));
        } : undefined}
      />
    </ArtifactTabShell>
  );
  if (backlogData) {
    const previewFeature = backlogData.features?.[0] ?? backlogData.feature;
    return (
      <BacklogView
        data={backlogData}
        initiativeTitle={initiativeTitle}
        frMap={frMap}
        nfrMap={nfrMap}
        onDeleteStory={requestDelete ? (storyIndex) => {
          const story = previewFeature?.stories[storyIndex];
          if (!story) return;
          requestDelete(`story "${story.title}"`, () => JSON.stringify(removeStoryFromBacklog(backlogData, storyIndex)));
        } : undefined}
        onDeleteTestCase={requestDelete ? (storyIndex, testCaseIndex) => {
          const tc = previewFeature?.stories[storyIndex]?.test_cases?.[testCaseIndex];
          if (!tc) return;
          requestDelete(`test case "${tc.id}"`, () => JSON.stringify(removeTestCaseFromStory(backlogData, storyIndex, testCaseIndex)));
        } : undefined}
      />
    );
  }
  if (techData) return <TechRefinementView data={techData} />;
  const qaData = artifactType === 'qa_tests' ? tryParseQATests(content) : null;
  if (qaData) return (
    <QATestsView
      data={qaData}
      frMap={frMap}
      onDeleteTestCase={requestDelete ? (index) => {
        const tc = qaData.test_cases[index];
        if (!tc) return;
        requestDelete(`test case "${tc.id}"`, () => JSON.stringify(removeTestCase(qaData, index)));
      } : undefined}
    />
  );
  // JSON artifact types that failed to parse — render as code block with warning
  if (artifactType === 'qa_tests' || isBacklogArtifactType(artifactType)) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="flex-1 space-y-2">
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              This artifact appears incomplete — the stage was likely interrupted mid-stream. Retry the stage to regenerate a complete output.
            </p>
            {pendingCheckpoint && hasApprovePermission && (
              <button
                onClick={rerunStage}
                disabled={resolveLoading}
                className="py-1.5 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 text-white text-xs font-medium rounded-md transition-colors"
              >
                {resolveLoading ? 'Retrying...' : 'Retry Stage'}
              </button>
            )}
          </div>
        </div>
        <pre className="text-xs font-mono text-surface-700 dark:text-surface-300 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg p-4 overflow-auto whitespace-pre-wrap break-words leading-relaxed">{content}</pre>
      </div>
    );
  }
  if (artifactType === 'prototype') {
    try {
      const protoData: PrototypeData = JSON.parse(content);
      if (protoData.files && activeWorkflow) {
        return (
          <PrototypePreview
            prototype={protoData}
            workflowId={activeWorkflow.id}
            onClose={onClose}
            onUpdate={() => {}}
          />
        );
      }
    } catch { /* fall through to raw view */ }
  }
  // Document artifacts are stored as JSON but rendered as markdown via the converter.
  if (isDocumentArtifact(artifactType)) {
    const md = renderArtifactMarkdown(artifactType, content, 'display');
    if (md !== null) {
      return (
        <MarkdownContent>{md}</MarkdownContent>
      );
    }
  }
  return (
    <MarkdownContent>{content}</MarkdownContent>
  );
}
