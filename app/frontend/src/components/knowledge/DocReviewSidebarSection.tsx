import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { SectionHeader } from '../skill/SectionHeader';
import type { KbFileListItem, KbRepo } from '@pap/shared';

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  in_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  draft: 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
};

function statusBadgeClass(status: string | null): string {
  if (!status) return 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400';
  return STATUS_COLORS[status.toLowerCase().replace(/\s+/g, '_')] ?? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
}

export function DocReviewSidebarSection({
  isOpen, onToggle, selectedFileId, onSelectFile,
}: {
  isOpen: boolean;
  onToggle: () => void;
  selectedFileId: number | null;
  onSelectFile: (file: KbFileListItem) => void;
}) {
  const [repos, setRepos] = useState<KbRepo[]>([]);
  const [files, setFiles] = useState<KbFileListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [invalidOnly, setInvalidOnly] = useState(false);
  // Per-repo expand state — all repos start collapsed; absence from the set means collapsed.
  const [expandedRepos, setExpandedRepos] = useState<Set<number>>(new Set());

  const toggleRepo = (repoId: number) => {
    setExpandedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const [{ repos: repoList }, { files: fileList }] = await Promise.all([
        api.listKbRepos(),
        api.listKbFiles(),
      ]);
      setRepos(repoList);
      setFiles(fileList);
    } catch {
      /* Knowledge Studio may have no repos configured yet */
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const owners = useMemo(() => Array.from(new Set(files.map((f) => f.frontmatterOwner).filter(Boolean))) as string[], [files]);
  const statuses = useMemo(() => Array.from(new Set(files.map((f) => f.frontmatterStatus).filter(Boolean))) as string[], [files]);

  const filteredFiles = useMemo(() => files.filter((f) =>
    (!ownerFilter || f.frontmatterOwner === ownerFilter) &&
    (!statusFilter || f.frontmatterStatus === statusFilter) &&
    (!invalidOnly || !f.frontmatterValid)
  ), [files, ownerFilter, statusFilter, invalidOnly]);

  const filesByRepo = useMemo(() => {
    const map = new Map<number, KbFileListItem[]>();
    for (const f of filteredFiles) {
      const list = map.get(f.repoId) ?? [];
      list.push(f);
      map.set(f.repoId, list);
    }
    return map;
  }, [filteredFiles]);

  return (
    <>
      <SectionHeader label="Documentation Review" count={files.length} isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        isLoading ? (
          <div className="px-4 pb-2 text-xs text-surface-400">Loading…</div>
        ) : repos.length === 0 ? (
          <div className="px-4 pb-2 text-xs text-surface-400">No repos tracked yet — add one in Settings → Knowledge Repos.</div>
        ) : (
          <>
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="text-xs bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded px-1.5 py-1 text-surface-600 dark:text-surface-300"
              >
                <option value="">All owners</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded px-1.5 py-1 text-surface-600 dark:text-surface-300"
              >
                <option value="">All statuses</option>
                {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-surface-500 dark:text-surface-400 cursor-pointer">
                <input type="checkbox" checked={invalidOnly} onChange={(e) => setInvalidOnly(e.target.checked)} />
                Needs frontmatter
              </label>
            </div>

            {repos.map((repo) => {
              const repoFiles = filesByRepo.get(repo.id) ?? [];
              if (repoFiles.length === 0 && (ownerFilter || statusFilter || invalidOnly)) return null;
              const isExpanded = expandedRepos.has(repo.id);
              return (
                <div key={repo.id}>
                  <button
                    onClick={() => toggleRepo(repo.id)}
                    className="w-full flex items-center gap-1.5 px-4 pt-1.5 pb-0.5 text-xs font-medium text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                  >
                    <svg
                      className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="truncate">{repo.label} ({repoFiles.length})</span>
                  </button>
                  {!isExpanded ? null : repoFiles.length === 0 ? (
                    <div className="px-4 pb-2 text-xs text-surface-400">No .md files synced</div>
                  ) : repoFiles.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => onSelectFile(file)}
                      className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
                        selectedFileId === file.id
                          ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                          : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm text-surface-800 dark:text-surface-200 truncate" title={file.path}>
                          {file.frontmatterFileName || file.path}
                        </span>
                        {!file.frontmatterValid && (
                          <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <title>Missing or incomplete frontmatter</title>
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-.25-5a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0V8z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 pl-0">
                        {file.frontmatterOwner && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 font-medium leading-none truncate max-w-[7rem]">
                            {file.frontmatterOwner}
                          </span>
                        )}
                        {file.frontmatterStatus && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium leading-none ${statusBadgeClass(file.frontmatterStatus)}`}>
                            {file.frontmatterStatus}
                          </span>
                        )}
                        {file.openCommentCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300 font-medium leading-none ml-auto">
                            {file.openCommentCount}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </>
        )
      )}
    </>
  );
}
