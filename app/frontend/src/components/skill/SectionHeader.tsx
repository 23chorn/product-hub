/** Collapsible sidebar section header with a chevron, optional count, and action slot. */
export function SectionHeader({
  label, count, isOpen, onToggle, action,
}: {
  label: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 cursor-pointer select-none group" onClick={onToggle}>
      <div className="flex items-center space-x-1.5 min-w-0">
        <svg
          className={`w-3 h-3 text-surface-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide group-hover:text-surface-700 dark:group-hover:text-surface-200 transition-colors">
          {label}
        </span>
        {count !== undefined && (
          <span className="text-xs text-surface-400 dark:text-surface-500">({count})</span>
        )}
      </div>
      {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
    </div>
  );
}
