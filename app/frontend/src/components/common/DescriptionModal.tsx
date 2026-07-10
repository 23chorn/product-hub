interface Props {
  title?: string;
  description: string;
  onClose: () => void;
}

/** Read-only popover for an initiative's original problem statement — shared by the
 *  live pipeline header and the Progress Tracker detail header. */
export function DescriptionModal({ title = 'Initial Description', description, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 font-sans" onClick={onClose}>
      <div className="w-full max-w-2xl mx-4 bg-surface-50 dark:bg-surface-900 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{title}</h3>
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
          >
            [x]
          </button>
        </div>
        <div className="px-5 py-4 max-h-96 overflow-y-auto">
          <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{description}</p>
        </div>
        <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
