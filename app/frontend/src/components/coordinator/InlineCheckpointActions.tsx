import { useState } from 'react';
import { STAGE_LABELS } from '../../constants/stage-labels';
import { parseCriticData } from '../../utils/coordinator-helpers';
import { CriticQuestionForm } from '../artifact/CriticQuestionForm';
import { api } from '../../services/api';
import { useAuthStore, canApprove, ROLE_LABELS } from '../../stores/authStore';

// Inline approve/reject for checkpoints that have no artifact (e.g. stuck stages)
export function InlineCheckpointActions({
  checkpoint,
  onResolved,
}: {
  checkpoint: { id: number; stage: string; coordinator_action?: string | null; required_role?: string | null };
  onResolved: (result: any) => void;
}) {
  const [showRevise, setShowRevise] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user, noAuth } = useAuthStore();
  const hasPermission = canApprove(user, noAuth, checkpoint.required_role ?? null);

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

  if (!hasPermission) {
    const roleLabel = checkpoint.required_role ? (ROLE_LABELS[checkpoint.required_role] ?? checkpoint.required_role) : null;
    return (
      <div className="pt-2">
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>Approval requires {roleLabel ? <strong className="text-slate-300">{roleLabel}</strong> : 'a specific role'}</span>
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
              className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => resolve('revised', feedback)}
                disabled={!feedback.trim() || loading}
                className="px-2.5 py-1 text-xs bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-md transition-colors"
              >
                {loading ? 'Sending...' : 'Send Revision'}
              </button>
              <button onClick={() => { setShowRevise(false); setFeedback(''); }} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                Cancel
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 dark:text-slate-500 mr-1">
            {STAGE_LABELS[checkpoint.stage] ?? checkpoint.stage}:
          </span>
          <button
            onClick={() => resolve('approved')}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-md bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => setShowRevise(true)}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white transition-colors"
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

      {/* Reject confirmation modal */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRejectConfirm(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">End this workflow?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
              Rejecting will permanently end this workflow. All completed stages are preserved, but no further stages will run. You can start a new workflow with a fresh goal afterward.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectConfirm(false)}
                disabled={loading}
                className="flex-1 py-2 px-3 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => resolve('rejected')}
                disabled={loading}
                className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
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
