import { useEffect, useState } from 'react';
import { MarkdownContent } from '../common/MarkdownContent';
import { api } from '../../services/api';
import { stripFrontmatter } from '../../utils/markdown';
import type { KbFileCommit } from '@pap/shared';

function LineStats({ commit }: { commit: KbFileCommit }) {
  if (commit.linesAdded === 0 && commit.linesRemoved === 0) {
    return <span className="text-[10px] text-surface-400 dark:text-surface-500">No line changes</span>;
  }
  return (
    <span className="text-[10px] font-mono flex items-center gap-1.5">
      {commit.linesAdded > 0 && <span className="text-green-600 dark:text-green-400">+{commit.linesAdded}</span>}
      {commit.linesRemoved > 0 && <span className="text-red-600 dark:text-red-400">-{commit.linesRemoved}</span>}
    </span>
  );
}

export function FileHistoryPanel({ fileId }: { fileId: number }) {
  const [commits, setCommits] = useState<KbFileCommit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    api.getKbFileHistory(fileId)
      .then(({ commits }) => setCommits(commits))
      .catch((err) => setError(err?.response?.data?.error ?? 'Failed to load history'))
      .finally(() => setIsLoading(false));
  }, [fileId]);

  const toggleVersion = async (commit: KbFileCommit) => {
    if (expandedCommit === commit.commitId) {
      setExpandedCommit(null);
      return;
    }
    setExpandedCommit(commit.commitId);
    if (versions[commit.commitId] !== undefined) return;
    setLoadingVersion(commit.commitId);
    try {
      const { content } = await api.getKbFileVersion(fileId, commit.commitId);
      setVersions((prev) => ({ ...prev, [commit.commitId]: content }));
    } catch (err: any) {
      setVersions((prev) => ({ ...prev, [commit.commitId]: err?.response?.data?.error ?? 'Failed to load this version' }));
    } finally {
      setLoadingVersion(null);
    }
  };

  if (isLoading) return <p className="text-sm text-surface-400">Loading history…</p>;
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (commits.length === 0) return <p className="text-sm text-surface-400">No history found.</p>;

  return (
    <div className="space-y-2">
      {commits.map((commit) => {
        const isExpanded = expandedCommit === commit.commitId;
        return (
          <div key={commit.commitId} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-surface-800 dark:text-surface-200 truncate">{commit.message || '(no commit message)'}</p>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                  {commit.authorName} · {new Date(commit.date).toLocaleString()} · <span className="font-mono">{commit.commitId.slice(0, 8)}</span>
                </p>
                <div className="mt-1">
                  <LineStats commit={commit} />
                </div>
              </div>
              <button
                onClick={() => toggleVersion(commit)}
                className="flex-shrink-0 text-xs px-2 py-1 rounded text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
              >
                {isExpanded ? 'Hide' : 'View full version'}
              </button>
            </div>
            {isExpanded && (
              <div className="mt-2 pt-2 border-t border-surface-100 dark:border-surface-700/60 text-xs">
                {loadingVersion === commit.commitId ? (
                  <p className="text-surface-400">Loading version…</p>
                ) : (
                  <MarkdownContent breaks>{stripFrontmatter(versions[commit.commitId] ?? '')}</MarkdownContent>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
