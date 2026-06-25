interface DeleteItemButtonProps {
  onDelete: () => void;
  label: string;
  className?: string;
}

/** Small trash icon used next to a story/feature/epic/test-case row during checkpoint
 *  review. Stops propagation so it can sit beside a row's own toggle button without
 *  triggering it. */
export function DeleteItemButton({ onDelete, label, className = '' }: DeleteItemButtonProps) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      title={label}
      aria-label={label}
      className={`flex-shrink-0 p-1 rounded text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ${className}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}
