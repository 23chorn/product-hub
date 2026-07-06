import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import type { InitiativeComment } from '@pap/shared';

type Tab = 'activity' | 'decisions';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function CommentIcon({ type }: { type: InitiativeComment['type'] }) {
  if (type === 'decision') {
    return (
      <svg className="w-3.5 h-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    );
  }
  if (type === 'pause') {
    return (
      <svg className="w-3.5 h-3.5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type === 'resume') {
    return (
      <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

export function CommentsPanel({ itemId }: { itemId: string }) {
  const { noAuth, user } = useAuthStore();
  const isAdmin = noAuth || !!user?.is_admin;

  const [tab, setTab] = useState<Tab>('activity');
  const [comments, setComments] = useState<InitiativeComment[]>([]);
  const [loading, setLoading] = useState(true);

  // Derive paused state from the most recent pause/resume event in the comment list
  const isPaused = (() => {
    for (let i = comments.length - 1; i >= 0; i--) {
      if (comments[i].type === 'pause') return true;
      if (comments[i].type === 'resume') return false;
    }
    return false;
  })();

  // New comment form
  const [commentType, setCommentType] = useState<'note' | 'decision'>('note');
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pause form
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseSubmitting, setPauseSubmitting] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  const fetchComments = () => {
    api.getInitiativeComments(itemId)
      .then(data => setComments(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchComments();
  }, [itemId]);

  const scrollToBottom = () => {
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
  };

  const handleSubmitComment = async () => {
    if (!body.trim()) return;
    if (commentType === 'decision' && !title.trim()) return;
    setSubmitting(true);
    try {
      await api.addInitiativeComment(itemId, { body: body.trim(), type: commentType, title: title.trim() || undefined });
      setBody('');
      setTitle('');
      fetchComments();
      scrollToBottom();
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async () => {
    if (!pauseReason.trim()) return;
    setPauseSubmitting(true);
    try {
      await api.pauseInitiative(itemId, pauseReason.trim());
      setPauseReason('');
      setShowPauseForm(false);
      fetchComments();
      scrollToBottom();
      // Trigger home screen refresh by dispatching a storage event
      window.dispatchEvent(new Event('initiative-status-changed'));
    } finally {
      setPauseSubmitting(false);
    }
  };

  const handleResume = async () => {
    setPauseSubmitting(true);
    try {
      await api.resumeInitiative(itemId);
      fetchComments();
      scrollToBottom();
      window.dispatchEvent(new Event('initiative-status-changed'));
    } finally {
      setPauseSubmitting(false);
    }
  };

  const displayed = tab === 'decisions'
    ? comments.filter(c => c.type === 'decision')
    : comments;

  return (
    <div className="w-80 flex-shrink-0 border-l border-surface-200 dark:border-surface-800/80 flex flex-col bg-white dark:bg-[#0d1117] font-mono">
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-2 pb-0 border-b border-surface-200 dark:border-surface-800/80">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wide">Log</span>
          {isAdmin && (
            isPaused ? (
              <button
                onClick={handleResume}
                disabled={pauseSubmitting}
                className="text-[10px] px-2 py-0.5 rounded border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
              >
                Resume
              </button>
            ) : (
              <button
                onClick={() => setShowPauseForm(v => !v)}
                className="text-[10px] px-2 py-0.5 rounded border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
              >
                Pause
              </button>
            )
          )}
        </div>
        {/* Pause reason form */}
        {showPauseForm && (
          <div className="mb-2 space-y-1.5">
            <textarea
              value={pauseReason}
              onChange={e => setPauseReason(e.target.value)}
              placeholder="Reason for pausing…"
              rows={2}
              className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-200 placeholder-surface-400 resize-none focus:outline-none focus:border-orange-400"
            />
            <div className="flex gap-1.5">
              <button
                onClick={handlePause}
                disabled={!pauseReason.trim() || pauseSubmitting}
                className="text-[10px] px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 disabled:opacity-50"
              >
                Confirm pause
              </button>
              <button
                onClick={() => { setShowPauseForm(false); setPauseReason(''); }}
                className="text-[10px] px-2 py-1 rounded bg-surface-100 dark:bg-surface-800 text-surface-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-3">
          {(['activity', 'decisions'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[10px] pb-1.5 border-b-2 transition-colors capitalize ${tab === t ? 'border-brand-500 text-brand-600 dark:text-brand-400 font-semibold' : 'border-transparent text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Comment list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <p className="text-[11px] text-surface-400 text-center pt-4">Loading…</p>
        ) : displayed.length === 0 ? (
          <p className="text-[11px] text-surface-400 text-center pt-4">
            {tab === 'decisions' ? 'No decisions logged yet.' : 'No activity yet.'}
          </p>
        ) : displayed.map(c => (
          <div key={c.id} className="flex gap-2">
            <div className="flex-shrink-0 mt-0.5">
              <CommentIcon type={c.type} />
            </div>
            <div className="min-w-0 flex-1">
              {c.type === 'decision' && c.title && (
                <p className="text-[11px] font-semibold text-surface-800 dark:text-surface-100 leading-snug mb-0.5">{c.title}</p>
              )}
              <p className="text-[11px] text-surface-600 dark:text-surface-400 leading-relaxed whitespace-pre-wrap break-words">{c.body}</p>
              <p className="text-[10px] text-surface-400 dark:text-surface-600 mt-0.5">{c.authorName} · {relativeTime(c.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-surface-200 dark:border-surface-800/80 p-3 space-y-2">
        {/* Type toggle */}
        <div className="flex gap-1.5">
          {(['note', 'decision'] as const).map(t => (
            <button
              key={t}
              onClick={() => setCommentType(t)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize ${commentType === t ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400' : 'border-surface-300 dark:border-surface-700 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* Decision title */}
        {commentType === 'decision' && (
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Decision headline…"
            className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-200 placeholder-surface-400 focus:outline-none focus:border-brand-400"
          />
        )}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={commentType === 'decision' ? 'Context and reasoning…' : 'Add a note…'}
          rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitComment(); }}
          className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 text-surface-800 dark:text-surface-200 placeholder-surface-400 resize-none focus:outline-none focus:border-brand-400"
        />
        <button
          onClick={handleSubmitComment}
          disabled={!body.trim() || (commentType === 'decision' && !title.trim()) || submitting}
          className="w-full text-[10px] py-1 rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors"
        >
          {submitting ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
