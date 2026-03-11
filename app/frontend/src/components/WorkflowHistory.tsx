import { useState, useEffect } from 'react';
import { useWorkflowStore } from '../stores/workflowStore';
import { api } from '../services/api';

interface WorkflowListItem {
  id: string;
  item_id: string;
  goal: string;
  summary: string | null;
  status: string;
  current_stage: string | null;
  stage_sequence: string;
  created_at: number;
  updated_at: number;
  checkpoint_count: number;
}

export function WorkflowHistory() {
  const { applyWorkflowStatus } = useWorkflowStore();
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    api.getWorkflowList()
      .then(({ workflows: w }) => setWorkflows(w))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function loadWorkflow(id: string) {
    try {
      const status = await api.getWorkflowStatus(id);
      applyWorkflowStatus(status);
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-xs text-gray-400 animate-pulse">Loading workflows...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-700">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Past Workflows
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {workflows.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No workflows yet. Start one by entering a goal.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {workflows.map((w) => {
              const stages: string[] = JSON.parse(w.stage_sequence || '[]');
              const goalPreview = w.summary || (w.goal.split('\n')[0].slice(0, 80) + (w.goal.length > 80 ? '...' : ''));
              const date = new Date(w.created_at);
              const isConfirming = confirmDeleteId === w.id;

              return (
                <div key={w.id} className="relative">
                  {isConfirming && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 dark:bg-gray-800/90 px-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 dark:text-gray-400">Delete?</span>
                        <button
                          onClick={async () => {
                            try {
                              await api.deleteWorkflow(w.id);
                              setWorkflows(prev => prev.filter(wf => wf.id !== w.id));
                            } catch { /* ignore */ }
                            setConfirmDeleteId(null);
                          }}
                          className="px-2 py-0.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-stretch">
                    <button
                      onClick={() => loadWorkflow(w.id)}
                      className="flex-1 text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors min-w-0"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-2">
                          {goalPreview}
                        </p>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs ${
                          w.status === 'complete'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : w.status === 'paused_at_checkpoint'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : w.status === 'active'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                        }`}>
                          {w.status === 'complete' ? 'done' : w.status === 'paused_at_checkpoint' ? 'paused' : w.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 dark:text-gray-500">
                        <span>{date.toLocaleDateString()}</span>
                        <span>{stages.length} stage{stages.length !== 1 ? 's' : ''}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(w.id)}
                      className="flex-shrink-0 px-2 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title="Delete workflow"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
