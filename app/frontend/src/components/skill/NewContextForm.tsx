import { MarkdownEditor } from './MarkdownEditor';

export interface NewContextFormProps {
  form: { label: string; description: string; content: string };
  setForm: React.Dispatch<React.SetStateAction<NewContextFormProps['form']>>;
  onSubmit: () => void;
  onCancel: () => void;
  isCreating: boolean;
}

/** Form for creating a new project context file injected into agent system prompts. */
export function NewContextForm({ form, setForm, onSubmit, onCancel, isCreating }: NewContextFormProps) {
  const field = (key: keyof NewContextFormProps['form'], value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Preview the derived filename
  const previewFileName = form.label.trim()
    ? form.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md'
    : '';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">New Context File</h3>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
          Injected into every agent's system prompt as background context.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Label *</label>
            <input
              value={form.label}
              onChange={(e) => field('label', e.target.value)}
              placeholder="e.g. Competitive Landscape"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {previewFileName && (
              <p className="mt-1 text-xs text-surface-400 font-mono">{previewFileName}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Description</label>
            <input
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              placeholder="e.g. Key competitors and market positioning"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Initial Content <span className="font-normal text-surface-400">— Edit · Preview</span>
          </label>
          <div className="h-80">
            <MarkdownEditor
              value={form.content}
              onChange={(v) => field('content', v)}
              placeholder="Start writing your context here…"
            />
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 flex items-center justify-end space-x-2 flex-shrink-0">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={isCreating || !form.label.trim()}
          className="text-xs px-4 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        >
          {isCreating ? 'Creating…' : 'Create Context File'}
        </button>
      </div>
    </div>
  );
}
