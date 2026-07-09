import type { ReactNode } from 'react';

export type ConfirmTone = 'success' | 'danger';

interface ToneSpec {
  circle: string;
  icon: string;
  confirmButton: string;
  iconPath: string;
}

// One source of truth for the per-tone styling + glyph. Add a tone here rather
// than branching at call sites.
const TONE_SPECS: Record<ConfirmTone, ToneSpec> = {
  success: {
    circle: 'bg-green-100 dark:bg-green-900/30',
    icon: 'text-green-600 dark:text-green-400',
    confirmButton: 'bg-green-600 hover:bg-green-700',
    iconPath: 'M5 13l4 4L19 7',
  },
  danger: {
    circle: 'bg-red-100 dark:bg-red-900/30',
    icon: 'text-red-600 dark:text-red-400',
    confirmButton: 'bg-red-600 hover:bg-red-700',
    iconPath:
      'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  },
};

interface ConfirmModalProps {
  tone: ConfirmTone;
  title: string;
  /** Short line under the title (e.g. "This action cannot be undone"). */
  subtitle: string;
  /** Main explanatory body — string or rich node. */
  body: ReactNode;
  /** Confirm button label in its idle state. */
  confirmLabel: string;
  /** Confirm button label while `loading` is true. */
  loadingLabel: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Cancel button label. Defaults to "Go Back". */
  cancelLabel?: string;
}

/**
 * Shared confirmation dialog: dimmed overlay + centered card with a tone-coloured
 * icon, title/subtitle, body, and a Cancel / Confirm button pair. Drives the
 * Approve / Reject / Restart confirmations so they can't drift apart.
 */
export function ConfirmModal({
  tone,
  title,
  subtitle,
  body,
  confirmLabel,
  loadingLabel,
  loading,
  onCancel,
  onConfirm,
  cancelLabel = 'Go Back',
}: ConfirmModalProps) {
  const spec = TONE_SPECS[tone];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-surface-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className={`flex-shrink-0 w-10 h-10 rounded-full ${spec.circle} flex items-center justify-center`}>
            <svg className={`w-5 h-5 ${spec.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={spec.iconPath} />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{title}</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <p className="text-sm text-surface-600 dark:text-surface-300 mb-5">{body}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 px-3 text-sm font-mono font-medium rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
          >
            {cancelLabel.toLowerCase()}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2 px-3 ${spec.confirmButton} disabled:bg-surface-300 text-white text-sm font-mono font-medium rounded-md transition-colors`}
          >
            {loading ? loadingLabel.toLowerCase() : `${confirmLabel.toLowerCase()} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
