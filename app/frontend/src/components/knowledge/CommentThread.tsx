import { useState } from 'react';
import type { KbComment } from '@pap/shared';

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function CommentRow({ comment, disabled, onSetStatus }: {
  comment: KbComment;
  disabled: boolean;
  onSetStatus: (id: number, status: 'open' | 'resolved') => void;
}) {
  const isAgent = comment.source === 'agent';
  return (
    <div className={`rounded-lg border p-3 ${comment.status === 'resolved' ? 'opacity-60' : ''} ${
      isAgent
        ? 'border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/10'
        : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
    }`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-surface-700 dark:text-surface-300 truncate">{comment.authorName}</span>
          {isAgent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300 font-medium leading-none flex-shrink-0">
              AI suggestion
            </span>
          )}
          <span className="text-[10px] text-surface-400 dark:text-surface-500 flex-shrink-0">{formatTimestamp(comment.createdAt)}</span>
        </div>
        {!disabled && (
          <button
            onClick={() => onSetStatus(comment.id, comment.status === 'resolved' ? 'open' : 'resolved')}
            className="text-[10px] px-1.5 py-0.5 rounded text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 flex-shrink-0"
          >
            {comment.status === 'resolved' ? 'Reopen' : 'Resolve'}
          </button>
        )}
      </div>
      {comment.quote && (
        <blockquote className="text-xs text-surface-500 dark:text-surface-400 border-l-2 border-surface-300 dark:border-surface-600 pl-2 mb-1.5 italic">
          “{comment.quote}”
        </blockquote>
      )}
      <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}

export function CommentThread({
  comments, disabled, onAddComment, onSetStatus,
}: {
  comments: KbComment[];
  disabled: boolean;
  onAddComment: (body: string, quote?: string) => Promise<void>;
  onSetStatus: (id: number, status: 'open' | 'resolved') => void;
}) {
  const [body, setBody] = useState('');
  const [quote, setQuote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddComment(body.trim(), quote.trim() || undefined);
      setBody('');
      setQuote('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-surface-400 dark:text-surface-500">No comments yet.</p>
      ) : (
        comments.map((c) => <CommentRow key={c.id} comment={c} disabled={disabled} onSetStatus={onSetStatus} />)
      )}

      {!disabled && (
        <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2">
          <input
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            placeholder="Optional: quote the passage this is about"
            className="w-full text-xs bg-white dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment or suggestion for the owner…"
            rows={3}
            className="w-full text-sm bg-white dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
          />
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={!body.trim() || submitting}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
