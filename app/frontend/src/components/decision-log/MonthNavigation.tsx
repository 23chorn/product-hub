import { formatMonthShort } from '../../utils/decision-log-helpers';

interface MonthNavigationProps {
  isLoading: boolean;
  currentYearMonth: string;
  currentMonthLabel: string;
  availableMonths: Array<{ month: string; label: string }>;
  viewingMonth: string | null;
  onMonthSelect: (yearMonth: string) => void;
}

export function MonthNavigation({
  isLoading,
  currentYearMonth,
  currentMonthLabel,
  availableMonths,
  viewingMonth,
  onMonthSelect,
}: MonthNavigationProps) {
  return (
    <aside className="w-48 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col flex-shrink-0">
      <div className="p-3 border-b border-slate-200 dark:border-slate-700">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Month</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-3 text-sm text-slate-400 dark:text-slate-500">Loading...</div>
        )}
        {/* Current month always first */}
        {!isLoading && (
          <button
            onClick={() => onMonthSelect(currentYearMonth)}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              viewingMonth === currentYearMonth
                ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <span className="block">{currentMonthLabel}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">Current</span>
          </button>
        )}
        {/* Past months */}
        {availableMonths
          .filter(m => m.month !== currentYearMonth)
          .map(m => (
            <button
              key={m.month}
              onClick={() => onMonthSelect(m.month)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                viewingMonth === m.month
                  ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {formatMonthShort(m.month)}
            </button>
          ))}
      </div>
    </aside>
  );
}
