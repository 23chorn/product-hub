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
    <aside className="w-48 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Month</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Loading...</div>
        )}
        {/* Current month always first */}
        {!isLoading && (
          <button
            onClick={() => onMonthSelect(currentYearMonth)}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              viewingMonth === currentYearMonth
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <span className="block">{currentMonthLabel}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">Current</span>
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
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {formatMonthShort(m.month)}
            </button>
          ))}
      </div>
    </aside>
  );
}
