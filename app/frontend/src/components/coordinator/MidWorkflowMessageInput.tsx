import { useState } from 'react';

interface MidWorkflowMessageInputProps {
  reply: string;
  onReplyChange: (value: string) => void;
  isStreaming: boolean;
  error: string | null;
  onClearError: () => void;
  onSubmit: (e: React.FormEvent) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onAutoResize: () => void;
}

/**
 * Collapsed "Message coordinator" affordance shown mid-workflow. Expands into a
 * small textarea + send/cancel form; collapses again after sending.
 */
export function MidWorkflowMessageInput({
  reply,
  onReplyChange,
  isStreaming,
  error,
  onClearError,
  onSubmit,
  textareaRef,
  onAutoResize,
}: MidWorkflowMessageInputProps) {
  const [showInput, setShowInput] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    onSubmit(e);
    setShowInput(false);
  };

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
      {showInput ? (
        <form onSubmit={handleSubmit} className="p-3 space-y-2">
          <textarea
            ref={textareaRef}
            value={reply}
            onChange={(e) => { onReplyChange(e.target.value); onAutoResize(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as any); }
              if (e.key === 'Escape') { setShowInput(false); onReplyChange(''); }
            }}
            placeholder="Message the coordinator…"
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={!reply.trim() || isStreaming} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white text-xs font-medium rounded-md transition-colors">
              Send
            </button>
            <button type="button" onClick={() => { setShowInput(false); onReplyChange(''); }} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error} <button onClick={onClearError} className="underline">dismiss</button></p>}
        </form>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className="w-full py-2 text-xs text-slate-400 dark:text-slate-500 hover:text-teal-500 dark:hover:text-teal-400 transition-colors"
        >
          + Message coordinator
        </button>
      )}
    </div>
  );
}
