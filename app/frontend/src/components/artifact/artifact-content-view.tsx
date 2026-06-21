import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tryParseBacklog, isBacklogArtifactType } from '../../utils/backlog-helpers';
import { BacklogView } from './BacklogView';
import { EpicFeaturesView, tryParseEpicFeatures } from './EpicFeaturesView';
import { QATestsView, tryParseQATests } from './QATestsView';
import { TechRefinementView, tryParseTechRefinement } from './TechRefinementView';
import { PrototypePreview, type PrototypeData } from '../coordinator/PrototypePreview';
import { convertArtifactToMarkdown, isDocumentArtifact } from '../../utils/artifact-to-markdown';
import type { WorkflowRow, WorkflowCheckpoint } from '../../stores/workflowStore';

export interface ArtifactViewContext {
  artifactType: string;
  activeWorkflow: WorkflowRow | null;
  pendingCheckpoint?: WorkflowCheckpoint;
  hasApprovePermission: boolean;
  resolveLoading: boolean;
  /** Rerun the current stage (used by the incomplete-artifact recovery prompt). */
  rerunStage: () => void;
  /** Close the artifact drawer. */
  onClose: () => void;
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
  const { artifactType, activeWorkflow, pendingCheckpoint, hasApprovePermission, resolveLoading, rerunStage, onClose } = ctx;

  const epicFeaturesData = artifactType === 'epic_features' ? tryParseEpicFeatures(content) : null;
  const backlogData = isBacklogArtifactType(artifactType) ? tryParseBacklog(content) : null;
  const techData = isBacklogArtifactType(artifactType) && !backlogData ? tryParseTechRefinement(content) : null;

  if (epicFeaturesData) return <EpicFeaturesView data={epicFeaturesData} />;
  if (backlogData) return (
    <BacklogView
      data={backlogData}
      isFeaturePreview={/^backlog_F\d+$/.test(artifactType)}
      initiativeTitle={activeWorkflow?.summary ?? activeWorkflow?.goal?.split('\n')[0]}
    />
  );
  if (techData) return <TechRefinementView data={techData} />;
  const qaData = artifactType === 'qa_tests' ? tryParseQATests(content) : null;
  if (qaData) return <QATestsView data={qaData} />;
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
    const md = convertArtifactToMarkdown(artifactType, content);
    if (md !== null) {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </div>
      );
    }
  }
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
