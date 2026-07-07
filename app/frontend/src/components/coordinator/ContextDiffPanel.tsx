import { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface ContextDiff {
  id: number;
  workflow_id: string | null;
  file_name: string;
  diff_content: string;   // JSON: { section, action, content }
  rationale: string;
  status: string;
  created_at: number;
}

interface DiffSpec {
  section: string;
  action: 'add' | 'update' | 'remove';
  content: string;
}

interface Props {
  onClose: () => void;
}

export function ContextDiffPanel({ onClose }: Props) {
  const [diffs, setDiffs] = useState<ContextDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<number | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadDiffs();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadDiffs() {
    setLoading(true);
    try {
      const { diffs: d } = await api.getPendingContextDiffs();
      setDiffs(d);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load diffs');
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: number) {
    setActioning(id);
    setError(null);
    try {
      await api.approveContextDiff(id);
      setDiffs((prev) => prev.filter((d) => d.id !== id));
      setToast('Context updated.');
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to approve');
    } finally {
      setActioning(null);
    }
  }

  async function reject(id: number) {
    setActioning(id);
    setError(null);
    try {
      await api.rejectContextDiff(id);
      setDiffs((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to reject');
    } finally {
      setActioning(null);
    }
  }

  // Behaviour-doc diffs confirm a feature is live in production — that's a deliberate,
  // individually-reviewed action, so they're excluded from the bulk "Approve All" button
  // (which only ever touches plain .md context diffs).
  const isBehaviourDiff = (diff: ContextDiff) => diff.file_name.startsWith('behaviour/');
  const bulkApprovable = diffs.filter((d) => !isBehaviourDiff(d));

  async function approveAll() {
    setApprovingAll(true);
    setError(null);
    let count = 0;
    for (const diff of bulkApprovable) {
      try {
        await api.approveContextDiff(diff.id);
        setDiffs((prev) => prev.filter((d) => d.id !== diff.id));
        count++;
      } catch { /* continue */ }
    }
    setApprovingAll(false);
    if (count > 0) setToast(`${count} context file${count !== 1 ? 's' : ''} updated.`);
  }

  function parseDiffSpec(content: string): DiffSpec | null {
    try { return JSON.parse(content) as DiffSpec; } catch { return null; }
  }

  const actionLabel = (action: string) => {
    if (action === 'add') return <span className="text-green-600 dark:text-green-400 text-xs font-medium">+ ADD</span>;
    if (action === 'update') return <span className="text-brand-600 dark:text-brand-400 text-xs font-medium">~ UPDATE</span>;
    if (action === 'remove') return <span className="text-red-600 dark:text-red-400 text-xs font-medium">− REMOVE</span>;
    return <span className="text-surface-500 text-xs">{action}</span>;
  };

  return (
    <div className="bg-white dark:bg-surface-900 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 w-full max-w-2xl max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            Context Diff Review
          </h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            {diffs.length} pending change{diffs.length !== 1 ? 's' : ''} to context files
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bulkApprovable.length > 1 && (
            <button
              onClick={approveAll}
              disabled={approvingAll || actioning !== null}
              className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-medium rounded-lg transition-colors"
            >
              {approvingAll ? 'Approving…' : 'Approve All'}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mx-5 mt-3 flex-shrink-0 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-xs text-green-700 dark:text-green-400">{toast}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 flex-shrink-0 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Diff list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && (
          <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-8">Loading…</p>
        )}

        {!loading && diffs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-surface-500 dark:text-surface-400">No pending context diffs.</p>
            <button
              onClick={onClose}
              className="mt-3 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              Close
            </button>
          </div>
        )}

        {diffs.map((diff) => {
          const spec = parseDiffSpec(diff.diff_content);
          const busy = actioning === diff.id || approvingAll;
          const isBehaviour = isBehaviourDiff(diff);

          return (
            <div
              key={diff.id}
              className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden"
            >
              {/* Diff header */}
              <div className="px-3 py-2 bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {spec && actionLabel(spec.action)}
                  <span className="text-xs font-mono text-surface-600 dark:text-surface-400 truncate">
                    {diff.file_name}
                  </span>
                  {spec?.section && (
                    <span className="text-xs text-surface-400 dark:text-surface-500">
                      {isBehaviour ? `Scenario: ${spec.section}` : `§ ${spec.section}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => approve(diff.id)}
                    disabled={busy}
                    title={isBehaviour ? 'Confirms this behaviour is now live in production' : undefined}
                    className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400 rounded transition-colors disabled:opacity-50"
                  >
                    {actioning === diff.id ? '…' : isBehaviour ? 'Confirm Live' : 'Approve'}
                  </button>
                  <button
                    onClick={() => reject(diff.id)}
                    disabled={busy}
                    className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>

              {/* Proposed content */}
              {spec && spec.action !== 'remove' && spec.content && (
                <div className="px-3 py-2 bg-green-50 dark:bg-green-900/10">
                  <p className="text-xs text-green-700 dark:text-green-500 font-medium mb-1">
                    {spec.action === 'add' ? 'Add' : 'Replace with'}
                  </p>
                  <p className={`text-xs text-surface-700 dark:text-surface-300 whitespace-pre-wrap leading-relaxed ${isBehaviour ? 'font-mono' : ''}`}>
                    {spec.content}
                  </p>
                </div>
              )}

              {spec?.action === 'remove' && (
                <div className="px-3 py-2 bg-red-50 dark:bg-red-900/10">
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {isBehaviour ? `Remove scenario "${spec.section}"` : `Remove section "§ ${spec.section}"`}
                  </p>
                </div>
              )}

              {/* Rationale */}
              <div className="px-3 py-2 border-t border-surface-100 dark:border-surface-800">
                <p className="text-xs text-surface-500 dark:text-surface-400 italic">{diff.rationale}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
