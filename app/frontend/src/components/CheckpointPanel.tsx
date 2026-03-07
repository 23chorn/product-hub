import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkflowStore } from '../stores/workflowStore';
import { api } from '../services/api';

const STAGE_LABELS: Record<string, string> = {
  analyst:    'Analyst Research',
  pm_prd:     'Product Requirements Document',
  pm_backlog: 'Backlog',
  critic:     'Critic Review',
  curator:    'Context Curation',
};

export function CheckpointPanel() {
  const { activeWorkflow, checkpoints, applyWorkflowStatus, addCoordinatorMessage } = useWorkflowStore();

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);

  const pending = checkpoints.find((c) => c.status === 'pending') ?? null;

  // Load artifact content whenever the pending checkpoint changes
  useEffect(() => {
    if (!pending?.artifact_id) { setArtifactContent(null); return; }
    setArtifactLoading(true);
    api.getArtifactContent(pending.artifact_id)
      .then(({ content }) => setArtifactContent(content))
      .catch(() => setArtifactContent(null))
      .finally(() => setArtifactLoading(false));
  }, [pending?.id]);

  if (!activeWorkflow || activeWorkflow.status !== 'paused_at_checkpoint') return null;
  if (!pending) return null;

  const resolved = checkpoints.filter((c) => c.status !== 'pending' && c.id !== pending.id);

  // Parse coordinator_action for critic verdict display
  let criticInfo: { verdict?: string; issue_count?: number; critical_issues?: number; questions?: string[] } | null = null;
  if (pending.coordinator_action) {
    try { criticInfo = JSON.parse(pending.coordinator_action); } catch { /* ignore */ }
  }

  async function resolve(status: 'approved' | 'rejected' | 'revised', fb?: string) {
    if (!activeWorkflow) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.resolveCheckpoint(pending!.id, status, fb);
      applyWorkflowStatus(result.workflow);

      const statusLabel = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'sent for revision';
      addCoordinatorMessage({
        role: 'coordinator',
        content: `Checkpoint **${STAGE_LABELS[pending!.stage] ?? pending!.stage}** ${statusLabel}.${
          result.nextStage ? ` Moving to **${STAGE_LABELS[result.nextStage] ?? result.nextStage}**.` : ''
        }${result.complete ? ' Workflow complete.' : ''}`,
        timestamp: Date.now(),
      });

      setFeedback('');
      setShowReviseForm(false);
      setShowRejectConfirm(false);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to resolve checkpoint');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stage header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
            Checkpoint — {STAGE_LABELS[pending.stage] ?? pending.stage}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Review the output below and decide how to proceed.
        </p>

        {/* Critic verdict banner */}
        {criticInfo?.verdict && (
          <div className={`mt-2 flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium ${
            criticInfo.verdict === 'approve'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}>
            <span>{criticInfo.verdict === 'approve' ? '✓' : '✕'}</span>
            <span>Critic verdict: <strong>{criticInfo.verdict}</strong></span>
            {criticInfo.critical_issues !== undefined && criticInfo.critical_issues > 0 && (
              <span className="ml-1 text-red-600 dark:text-red-400">
                ({criticInfo.critical_issues} critical issue{criticInfo.critical_issues !== 1 ? 's' : ''})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Artifact content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {artifactLoading ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Loading output…</p>
        ) : artifactContent ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifactContent}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">
            No artifact attached. The agent may still be running — the panel refreshes automatically.
          </p>
        )}

        {/* Critic questions */}
        {criticInfo?.questions && criticInfo.questions.length > 0 && (
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">Questions from Critic</p>
            <ul className="space-y-1">
              {criticInfo.questions.map((q, i) => (
                <li key={i} className="text-xs text-amber-800 dark:text-amber-300">• {q}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Checkpoint history */}
        {resolved.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <span>{historyOpen ? '▾' : '▸'}</span>
              <span>Checkpoint history ({resolved.length})</span>
            </button>
            {historyOpen && (
              <div className="mt-2 space-y-2">
                {resolved.map((cp) => (
                  <div key={cp.id} className="text-xs border border-gray-200 dark:border-gray-700 rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{STAGE_LABELS[cp.stage] ?? cp.stage}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        cp.status === 'approved' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                        cp.status === 'rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                        'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}>
                        {cp.status}
                      </span>
                    </div>
                    {cp.human_feedback && (
                      <p className="mt-1 text-gray-500 dark:text-gray-400 italic">"{cp.human_feedback}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action area */}
      <div className="px-4 pb-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 space-y-2">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        {showReviseForm ? (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change? Be specific."
              rows={3}
              className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => resolve('revised', feedback)}
                disabled={!feedback.trim() || loading}
                className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Sending…' : 'Send Revision'}
              </button>
              <button
                onClick={() => { setShowReviseForm(false); setFeedback(''); }}
                disabled={loading}
                className="py-2 px-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : showRejectConfirm ? (
          <div className="space-y-2">
            <p className="text-xs text-red-600 dark:text-red-400">
              Rejecting will end the workflow. Are you sure?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => resolve('rejected')}
                disabled={loading}
                className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Rejecting…' : 'Yes, Reject'}
              </button>
              <button
                onClick={() => setShowRejectConfirm(false)}
                disabled={loading}
                className="py-2 px-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => resolve('approved')}
              disabled={loading}
              className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? '…' : 'Approve'}
            </button>
            <button
              onClick={() => setShowReviseForm(true)}
              disabled={loading}
              className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Revise
            </button>
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={loading}
              className="flex-1 py-2 px-3 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 text-sm font-medium rounded-lg transition-colors"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
