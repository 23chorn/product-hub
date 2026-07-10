import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { api } from '../../services/api';
import { ARTIFACT_TYPE_LABELS, STAGE_LABELS } from '../../constants/stage-labels';
import { renderStructuredArtifact } from './ArtifactContentView';

interface SplitArtifactPaneProps {
  artifactId: number;
  onClose: () => void;
}

/**
 * Read-only companion pane shown alongside the main ArtifactViewer drawer so a reviewer
 * can keep a second document (e.g. the PRD) visible while working through another
 * (e.g. the backlog). Reuses renderStructuredArtifact for identical rendering to the
 * primary pane, minus any review/edit affordances (no pendingCheckpoint, no requestDelete).
 */
export function SplitArtifactPane({ artifactId, onClose }: SplitArtifactPaneProps) {
  const { checkpoints, activeWorkflow } = useWorkflowStore();
  const [content, setContent] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    setContent(null);
    setArtifactType('');
    api.getArtifactContent(artifactId)
      .then(({ content: c, type: t }) => {
        if (stale) return;
        setContent(c);
        setArtifactType(t);
      })
      .catch((err) => {
        if (stale) return;
        setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load artifact');
      })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [artifactId]);

  return (
    <div className="flex-1 min-w-0 bg-surface-50 dark:bg-surface-800 shadow-xl flex flex-col overflow-hidden border-r border-surface-200 dark:border-surface-700">
      <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
          {ARTIFACT_TYPE_LABELS[artifactType] ?? STAGE_LABELS[artifactType] ?? (artifactType || 'Document')}
        </h2>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
          title="Close split view"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : content ? renderStructuredArtifact(content, {
          artifactType,
          activeWorkflow,
          checkpoints,
          hasApprovePermission: false,
          resolveLoading: false,
          rerunStage: () => {},
          onClose,
        }) : (
          <p className="text-sm text-surface-400 italic">No content available.</p>
        )}
      </div>
    </div>
  );
}
