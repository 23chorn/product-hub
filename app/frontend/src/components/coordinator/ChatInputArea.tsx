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
    <div className="px-4 pb-4 pt-2 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
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
          className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 overflow-y-auto"
        />
        <button
          type="submit"
          disabled={!reply.trim() || isStreaming}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors self-end"
        >
          Send
        </button>
      </form>
    </div>
  );
}
