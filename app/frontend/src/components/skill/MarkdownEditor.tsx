import { useRef } from 'react';
import { MarkdownContent } from '../common/MarkdownContent';

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
          <MarkdownContent breaks>{value}</MarkdownContent>
        ) : (
          <p className="text-xs text-surface-400 dark:text-surface-500 italic">Preview will appear here…</p>
        )}
      </div>
    </div>
  );
}
