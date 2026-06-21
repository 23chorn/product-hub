import { useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/** Markdown editor with a 50/50 source + live preview split and synced scrolling. */
export function MarkdownEditor({
  value, onChange, placeholder, textareaRef: externalRef, readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  readOnly?: boolean;
}) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const taRef = externalRef ?? internalRef;
  const previewRef = useRef<HTMLDivElement>(null);
  const isSyncingFromEditor = useRef(false);
  const isSyncingFromPreview = useRef(false);

  const syncFromEditor = () => {
    if (isSyncingFromPreview.current || !taRef.current || !previewRef.current) return;
    const ta = taRef.current;
    const ratio = ta.scrollTop / (ta.scrollHeight - ta.clientHeight || 1);
    isSyncingFromEditor.current = true;
    const preview = previewRef.current;
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
    requestAnimationFrame(() => { isSyncingFromEditor.current = false; });
  };

  const syncFromPreview = () => {
    if (isSyncingFromEditor.current || !taRef.current || !previewRef.current) return;
    const preview = previewRef.current;
    const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
    isSyncingFromPreview.current = true;
    const ta = taRef.current;
    ta.scrollTop = ratio * (ta.scrollHeight - ta.clientHeight);
    requestAnimationFrame(() => { isSyncingFromPreview.current = false; });
  };

  return (
    <div className="flex h-full gap-2">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncFromEditor}
        placeholder={placeholder}
        spellCheck={false}
        readOnly={readOnly}
        className={`w-1/2 h-full resize-none rounded-lg border text-surface-900 dark:text-surface-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${readOnly ? 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 cursor-default' : 'border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800'}`}
      />
      <div
        ref={previewRef}
        onScroll={syncFromPreview}
        className="w-1/2 h-full overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/60 p-4"
      >
        {value.trim() ? (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-surface-800 dark:prose-headings:text-surface-100 prose-p:text-surface-700 dark:prose-p:text-surface-300 prose-li:text-surface-700 dark:prose-li:text-surface-300 prose-code:text-brand-600 dark:prose-code:text-brand-400 prose-pre:bg-surface-100 dark:prose-pre:bg-surface-900">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {value}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-surface-400 dark:text-surface-500 italic">Preview will appear here…</p>
        )}
      </div>
    </div>
  );
}
