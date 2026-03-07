import { useState } from 'react';
import { useWorkflowStore } from '../stores/workflowStore';
import { useSessionStore } from '../stores/sessionStore';
import { api } from '../services/api';

const STAGE_LABELS: Record<string, string> = {
  analyst:    'Analyst (Sage)',
  pm_prd:     'PM Strategy (Rex)',
  pm_backlog: 'Backlog Agent (Pip)',
  critic:     'Critic',
  curator:    'Context Curator',
};

export function CoordinatorChat() {
  const { activeWorkflow, stageSequence, completedStages, currentStage, applyWorkflowStatus, resetWorkflow } = useWorkflowStore();
  const { selectedItem } = useSessionStore();

  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemId = selectedItem?.id ?? '';
  const hasWorkflow = activeWorkflow !== null;
  const isComplete = activeWorkflow?.status === 'complete';
  const isAtCheckpoint = activeWorkflow?.status === 'paused_at_checkpoint';

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim() || !itemId || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.startWorkflow(itemId, goal.trim());
      const status = await api.getWorkflowStatus(result.workflowId);
      applyWorkflowStatus(status);
      setGoal('');
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to start workflow');
    } finally {
      setLoading(false);
    }
  }

  // No item selected
  if (!itemId) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select an initiative from the left panel to start a workflow.
        </p>
      </div>
    );
  }

  // No active workflow — show goal form
  if (!hasWorkflow) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New Workflow</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Describe what you want to build. Be specific about users, constraints, and scope.
          </p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-lg space-y-4">
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p className="font-medium text-gray-700 dark:text-gray-300">Stages that will run:</p>
              <div className="flex flex-wrap gap-2">
                {['analyst', 'pm_prd', 'pm_backlog', 'critic', 'curator'].map((s) => (
                  <span key={s} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400">
                    {STAGE_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            </div>
            <form onSubmit={handleStart} className="space-y-3">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStart(e as any); }
                }}
                placeholder="e.g. Build a WhatsApp chatbot for small business owners in emerging markets that lets them browse a product catalogue and receive personalised recommendations — must work on 2G connections."
                rows={5}
                className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={!goal.trim() || loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Starting…' : 'Start Workflow'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Active workflow — show summary / completion state
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex items-start justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {isComplete ? 'Workflow Complete'
              : isAtCheckpoint ? `Checkpoint: ${STAGE_LABELS[currentStage ?? ''] ?? currentStage}`
              : `Running: ${STAGE_LABELS[currentStage ?? ''] ?? currentStage}`}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-sm">
            {activeWorkflow.goal}
          </p>
        </div>
        <button
          onClick={resetWorkflow}
          className="ml-4 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
          title="Clear workflow and start over"
        >
          Clear
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        {isComplete ? (
          <>
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="text-green-600 dark:text-green-400 text-xl">✓</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">All stages complete</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {completedStages.length} stage{completedStages.length !== 1 ? 's' : ''} completed.
                Check context diffs in the stage tracker if the Curator proposed any changes.
              </p>
            </div>
            <button
              onClick={resetWorkflow}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Start new workflow
            </button>
          </>
        ) : isAtCheckpoint ? (
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Checkpoint — {STAGE_LABELS[currentStage ?? ''] ?? currentStage}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Review the output in the right panel, then approve, revise, or reject to continue.
            </p>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {STAGE_LABELS[currentStage ?? ''] ?? currentStage ?? 'Agent'} is working…
              </span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              The agent is producing its output. The right panel will update when it's ready for your review.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
