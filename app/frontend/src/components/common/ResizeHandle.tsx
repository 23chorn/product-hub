import { Separator } from 'react-resizable-panels';

/**
 * Vertical drag handle between two horizontally-arranged Panels, with an optional
 * collapse/expand toggle. `collapseDirection` controls which neighboring panel the
 * toggle acts on (and which way the chevron points) — 'before' collapses the panel
 * to the left of this handle, 'after' collapses the panel to the right.
 */
export function ResizeHandle({
  collapsed, onToggleCollapse, collapseDirection = 'before',
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  collapseDirection?: 'before' | 'after';
}) {
  // The chevron path below points left. Show it as-is when that's the "collapse" affordance
  // for the current state, otherwise flip it — see collapseDirection doc above.
  const pointsLeft = collapseDirection === 'before' ? !collapsed : !!collapsed;

  return (
    <div className="relative flex-shrink-0 w-2 group">
      <Separator className="w-full h-full bg-surface-200 dark:bg-surface-700 group-hover:bg-brand-400 dark:group-hover:bg-brand-500 transition-colors cursor-col-resize" />
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 z-10 w-4 h-8 flex items-center justify-center rounded bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-600 text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 shadow-sm"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg className={`w-3 h-3 transition-transform ${pointsLeft ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}
