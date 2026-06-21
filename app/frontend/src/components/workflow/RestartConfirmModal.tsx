interface RestartConfirmModalProps {
  isDemo: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before restarting a workflow from the beginning (discards all progress). */
export function RestartConfirmModal({ isDemo, loading, onCancel, onConfirm }: RestartConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Restart from the beginning?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This action cannot be undone</p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
          {isDemo
            ? 'Restarting the demo discards every artifact and checkpoint produced so far and reruns the full pipeline from stage one.'
            : 'Restarting discards every artifact and checkpoint produced so far and reruns the full pipeline from stage one. There is no way to recover the current progress afterward.'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 px-3 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Go Back
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Restarting...' : 'Yes, Restart'}
          </button>
        </div>
      </div>
    </div>
  );
}
