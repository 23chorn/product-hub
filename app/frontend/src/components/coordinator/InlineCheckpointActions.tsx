import { useState, useEffect } from 'react';
import { parseCriticData } from '../../utils/coordinator-helpers';
import { CriticQuestionForm } from '../artifact/CriticQuestionForm';
import { ApproveConfirmModal } from '../artifact/ApproveConfirmModal';
import { FigmaDesignActions } from '../artifact/FigmaDesignActions';
import { parseFigmaDesignContent } from '../../utils/figma-design';
import { api } from '../../services/api';
import { useAuthStore, canApprove, parseRequiredRoles, ROLE_LABELS } from '../../stores/authStore';

// Inline approve/reject for checkpoints that have no artifact (e.g. stuck stages)
export function InlineCheckpointActions({
  checkpoint,
  onResolved,
}: {
  checkpoint: { id: number; stage: string; artifact_id?: number | null; coordinator_action?: string | null; required_role?: string | null };
  onResolved: (result: any) => void;
}) {
  const requiredRoles = parseRequiredRoles(checkpoint.required_role);
  const [showRevise, setShowRevise] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user, noAuth } = useAuthStore();
  const hasPermission = canApprove(user, noAuth, requiredRoles);

  const criticData = parseCriticData(checkpoint);
  const hasQuestions = (criticData?.questions?.length ?? 0) > 0;

  async function resolve(status: 'approved' | 'rejected' | 'revised', fb?: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await api.resolveCheckpoint(checkpoint.id, status, fb);
      onResolved({ ...result, status });
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function figmaComplete(figmaUrl?: string, screenLinks?: Record<string, string>) {
    setLoading(true);
    setError(null);
    try {
      const result = await api.figmaComplete(checkpoint.id, figmaUrl, undefined, screenLinks);
      onResolved({ ...result, status: 'approved' });
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }

  const isFigmaDesign = checkpoint.stage === 'figma_design';

  // The checkpoint only carries the figma_file_url metadata, not the per-screen
  // list — fetch the full artifact so each screen gets its own link input below.
  const [figmaContent, setFigmaContent] = useState<string | null>(null);
  const [figmaContentLoaded, setFigmaContentLoaded] = useState(false);
  useEffect(() => {
    if (!isFigmaDesign || !checkpoint.artifact_id) { setFigmaContentLoaded(true); return; }
    let stale = false;
    api.getArtifactContent(checkpoint.artifact_id)
      .then(({ content }) => { if (!stale) setFigmaContent(content); })
      .finally(() => { if (!stale) setFigmaContentLoaded(true); });
    return () => { stale = true; };
  }, [isFigmaDesign, checkpoint.artifact_id]);
  const figmaDesign = isFigmaDesign ? parseFigmaDesignContent(figmaContent) : null;

  if (!hasPermission) {
    const roleLabels = requiredRoles.map(r => ROLE_LABELS[r] ?? r);
    return (
      <div className="pt-2">
        <div className="flex items-center gap-2 text-xs text-surface-400 dark:text-surface-500">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>
            Approval requires{' '}
            {roleLabels.length > 0
              ? roleLabels.map((label, i) => (
                  <span key={label}>
                    {i > 0 && <span className="text-surface-500"> or </span>}
                    <strong className="text-surface-300">{label}</strong>
                  </span>
                ))
              : 'a specific role'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-2">
      {error && <p className="text-xs text-red-500">{error}</p>}
      {showRevise ? (
        hasQuestions ? (
          <CriticQuestionForm
            questions={criticData!.questions}
            onSubmit={(fb) => resolve('revised', fb)}
            onCancel={() => { setShowRevise(false); setFeedback(''); }}
            loading={loading}
          />
        ) : (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change?"
              rows={2}
              className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => resolve('revised', feedback)}
                disabled={!feedback.trim() || loading}
                className="px-2.5 py-1 text-xs bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white rounded-md transition-colors"
              >
                {loading ? 'Sending...' : 'Send Revision'}
              </button>
              <button onClick={() => { setShowRevise(false); setFeedback(''); }} className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
                Cancel
              </button>
            </div>
          </div>
        )
      ) : isFigmaDesign ? (
        !figmaContentLoaded ? (
          <p className="text-xs text-surface-400 dark:text-surface-500">Loading...</p>
        ) : (
          <FigmaDesignActions
            figmaFileUrl={figmaDesign!.figmaFileUrl}
            screens={figmaDesign!.screens}
            loading={loading}
            compact
            onMarkComplete={({ figmaUrl, screenLinks }) => figmaComplete(figmaUrl, screenLinks)}
            onRevise={() => setShowRevise(true)}
            onReject={() => setShowRejectConfirm(true)}
          />
        )
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowApproveConfirm(true)}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-md bg-green-600 hover:bg-green-700 disabled:bg-surface-300 text-white transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => setShowRevise(true)}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 text-white transition-colors"
          >
            Revise
          </button>
          <button
            onClick={() => setShowRejectConfirm(true)}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Reject
          </button>
        </div>
      )}

      {/* Approve confirmation modal */}
      {showApproveConfirm && (
        <ApproveConfirmModal
          loading={loading}
          onCancel={() => setShowApproveConfirm(false)}
          onConfirm={() => resolve('approved')}
        />
      )}

      {/* Reject confirmation modal */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRejectConfirm(false)} />
          <div className="relative bg-surface-50 dark:bg-surface-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">End this workflow?</h3>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-surface-600 dark:text-surface-300 mb-5">
              Rejecting will permanently end this workflow. All completed stages are preserved, but no further stages will run. You can start a new workflow with a fresh goal afterward.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectConfirm(false)}
                disabled={loading}
                className="flex-1 py-2 px-3 text-sm font-medium rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => resolve('rejected')}
                disabled={loading}
                className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-surface-300 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Rejecting...' : 'Yes, Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
