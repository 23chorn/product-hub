/** Collapsible card wrapper used for the pipeline and tests sections. */
export function CollapsiblePanel({
  title, badge, badgeVariant, pipeNum, open, onToggle, children,
}: {
  title: string;
  badge?: string;
  badgeVariant?: 'success' | 'warning' | 'running' | 'neutral';
  pipeNum?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const badgeCls =
    badgeVariant === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
    badgeVariant === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
    badgeVariant === 'running' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' :
    'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {title}
          </span>
          {pipeNum !== undefined && (
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">#{pipeNum}</span>
          )}
          {badge && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${badgeCls}`}>{badge}</span>
          )}
        </div>
        <svg
          className={`w-3 h-3 text-slate-400 transition-transform duration-200 flex-shrink-0 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          {children}
        </div>
      )}
    </div>
  );
}
