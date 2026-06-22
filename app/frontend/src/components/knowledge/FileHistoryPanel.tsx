import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import type { KbFileCommit } from '@pap/shared';

export function FileHistoryPanel({ fileId }: { fileId: number }) {
  const [commits, setCommits] = useState<KbFileCommit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    api.getKbFileHistory(fileId)
      .then(({ commits }) => setCommits(commits))
      .catch((err) => setError(err?.response?.data?.error ?? 'Failed to load history'))
      .finally(() => setIsLoading(false));
  }, [fileId]);

  const toggleDiff = async (commit: KbFileCommit, previous: KbFileCommit | undefined) => {
    if (!previous) return;
    if (expandedCommit === commit.commitId) {
      setExpandedCommit(null);
      return;
    }
    setExpandedCommit(commit.commitId);
    if (diffs[commit.commitId]) return;
    setLoadingDiff(commit.commitId);
    try {
      const { diff } = await api.getKbFileDiff(fileId, previous.commitId, commit.commitId);
      setDiffs((prev) => ({ ...prev, [commit.commitId]: diff }));
    } catch (err: any) {
      setDiffs((prev) => ({ ...prev, [commit.commitId]: err?.response?.data?.error ?? 'Failed to load diff' }));
    } finally {
      setLoadingDiff(null);
    }
  };

  if (isLoading) return <p className="text-sm text-surface-400">Loading history…</p>;
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (commits.length === 0) return <p className="text-sm text-surface-400">No history found.</p>;

  return (
    <div className="space-y-2">
      {commits.map((commit, i) => {
        const previous = commits[i + 1];
        const isExpanded = expandedCommit === commit.commitId;
        return (
          <div key={commit.commitId} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-surface-800 dark:text-surface-200 truncate">{commit.message || '(no commit message)'}</p>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                  {commit.authorName} · {new Date(commit.date).toLocaleString()} · <span className="font-mono">{commit.commitId.slice(0, 8)}</span>
                </p>
              </div>
              {previous && (
                <button
                  onClick={() => toggleDiff(commit, previous)}
                  className="flex-shrink-0 text-xs px-2 py-1 rounded text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                >
                  {isExpanded ? 'Hide changes' : 'View changes'}
                </button>
              )}
            </div>
            {isExpanded && (
              <div className="mt-2 text-xs prose prose-sm dark:prose-invert max-w-none">
                {loadingDiff === commit.commitId ? (
                  <p className="text-surface-400">Loading diff…</p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{diffs[commit.commitId] ?? ''}</ReactMarkdown>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
