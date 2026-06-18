interface ApproveConfirmModalProps {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before approving a checkpoint (advances the workflow to the next stage). */
export function ApproveConfirmModal({ loading, onCancel, onConfirm }: ApproveConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Approve this stage?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This advances the workflow to the next stage</p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
          Make sure you've reviewed the output above. Once approved, the next stage starts immediately.
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
            className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Approving...' : 'Yes, Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
