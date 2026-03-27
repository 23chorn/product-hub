import { type FormEvent, type Ref } from 'react';

export interface ChatInputAreaProps {
  reply: string;
  onReplyChange: (value: string) => void;
  isStreaming: boolean;
  error: string | null;
  onClearError?: () => void;
  onSubmit: (e: FormEvent) => void;
  textareaRef: Ref<HTMLTextAreaElement>;
  onAutoResize: () => void;
  hasWorkflow: boolean;
}

export function ChatInputArea(props: ChatInputAreaProps) {
  const { reply, onReplyChange, isStreaming, error, onSubmit, textareaRef, onAutoResize, hasWorkflow } = props;

  return (
    <div className="px-4 pb-4 pt-2 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}
      <form onSubmit={onSubmit} className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={reply}
          onChange={(e) => { onReplyChange(e.target.value); onAutoResize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e as any); }
          }}
          placeholder={hasWorkflow ? 'Message the Chief of Staff... (Shift+Enter for new line)' : 'Reply... (Shift+Enter for new line)'}
          rows={2}
          disabled={isStreaming}
          className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 overflow-y-auto"
        />
        <button
          type="submit"
          disabled={!reply.trim() || isStreaming}
          className="px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors self-end"
        >
          Send
        </button>
      </form>
    </div>
  );
}
