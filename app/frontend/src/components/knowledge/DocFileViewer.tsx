import { useEffect, useState } from 'react';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { api } from '../../services/api';
import { useAuthStore, isViewOnly } from '../../stores/authStore';
import { CommentThread } from './CommentThread';
import { FileHistoryPanel } from './FileHistoryPanel';
import { ResizeHandle } from '../common/ResizeHandle';
import type { KbFile, KbComment } from '@pap/shared';

type RightTab = 'comments' | 'history';

/** Strip the leading YAML frontmatter block before rendering — it's surfaced as badges instead. */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function DocFileViewer({ fileId }: { fileId: number }) {
  const { user, noAuth } = useAuthStore();
  const readOnly = isViewOnly(user, noAuth);

  const [file, setFile] = useState<KbFile | null>(null);
  const [comments, setComments] = useState<KbComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commentsPanelRef = usePanelRef();
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('comments');

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    api.getKbFile(fileId)
      .then(({ file, comments }) => { setFile(file); setComments(comments); })
      .catch((err) => setError(err?.response?.data?.error ?? 'Failed to load file'))
      .finally(() => setIsLoading(false));
  }, [fileId]);

  const runAIReview = async () => {
    setIsReviewing(true);
    setError(null);
    try {
      const { comments: suggestions } = await api.reviewKbFileWithAI(fileId);
      setComments((prev) => [...prev, ...suggestions]);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'AI review failed');
    } finally {
      setIsReviewing(false);
    }
  };

  const addComment = async (body: string, quote?: string) => {
    const comment = await api.addKbComment(fileId, body, quote);
    setComments((prev) => [...prev, comment]);
  };

  const setCommentStatus = async (id: number, status: 'open' | 'resolved') => {
    const updated = await api.setKbCommentStatus(id, status);
    setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
  };

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-surface-400 bg-white dark:bg-surface-900">Loading…</div>;
  }
  if (!file) {
    return <div className="flex-1 flex items-center justify-center text-sm text-surface-400 bg-white dark:bg-surface-900">{error ?? 'File not found'}</div>;
  }

  return (
    <>
      <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{file.path}</h3>
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5 truncate">{file.repoLabel}</p>
          </div>
          {!readOnly && (
            <button
              onClick={runAIReview}
              disabled={isReviewing}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 disabled:opacity-50 transition-colors"
            >
              {isReviewing ? 'Reviewing…' : 'Review with AI'}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {!file.frontmatterValid && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
              Missing or incomplete frontmatter
            </span>
          )}
          {file.frontmatterOwner && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 font-medium">
              Owner: {file.frontmatterOwner}
            </span>
          )}
          {file.frontmatterStatus && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
              Status: {file.frontmatterStatus}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
      </div>

      <Group orientation="horizontal" className="flex-1 min-h-0" id="doc-file-viewer-layout">
        <Panel id="doc-content" minSize="30%">
          <div className="h-full overflow-y-auto px-6 py-4">
            <div className="prose prose-sm dark:prose-invert max-w-none bg-white dark:bg-surface-900 rounded-lg p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{stripFrontmatter(file.content)}</ReactMarkdown>
            </div>
          </div>
        </Panel>

        <ResizeHandle
          collapsed={commentsCollapsed}
          collapseDirection="after"
          onToggleCollapse={() => {
            if (commentsPanelRef.current?.isCollapsed()) commentsPanelRef.current?.expand();
            else commentsPanelRef.current?.collapse();
          }}
        />

        <Panel
          id="doc-comments"
          defaultSize="35%"
          minSize="20%"
          maxSize="80%"
          collapsible
          collapsedSize={0}
          panelRef={commentsPanelRef}
          onResize={() => setCommentsCollapsed(commentsPanelRef.current?.isCollapsed() ?? false)}
        >
          <div className="h-full flex flex-col">
            <div className="flex gap-1 px-3 pt-3 flex-shrink-0">
              {(['comments', 'history'] as RightTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                    rightTab === tab
                      ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                      : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                  }`}
                >
                  {tab === 'comments' ? `Comments${comments.length > 0 ? ` (${comments.length})` : ''}` : 'History'}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {rightTab === 'comments' ? (
                <CommentThread comments={comments} disabled={readOnly} onAddComment={addComment} onSetStatus={setCommentStatus} />
              ) : (
                <FileHistoryPanel fileId={fileId} />
              )}
            </div>
          </div>
        </Panel>
      </Group>
    </>
  );
}
