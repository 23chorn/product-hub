import type { RefObject } from 'react';
import { STATUS_FILTERS, PRIMARY_FILTER_KEYS, type StatusFilter } from './types';

interface HomeHeaderProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  myPendingCount: number;
  showMineFilter: boolean;
  showAssignedFilter: boolean;
  isAdmin: boolean;
  onCreateInitiative?: () => void;
}

/** Home screen search box and status filter chips — portaled into the shared
 * PageHeader's actions slot. (Product area filter removed for now — may return later.) */
export function HomeHeader({
  searchQuery,
  onSearchChange,
  searchInputRef,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  myPendingCount,
  showMineFilter,
  showAssignedFilter,
  isAdmin,
  onCreateInitiative,
}: HomeHeaderProps) {
  const primaryFilters = STATUS_FILTERS.filter(f => {
    if (!PRIMARY_FILTER_KEYS.includes(f.key)) return false;
    if (f.key === 'mine' && !showMineFilter) return false;
    if (f.key === 'assigned' && !showAssignedFilter) return false;
    if (f.adminOnly && !isAdmin) return false;
    return true;
  });

  const isSecondaryActive = !PRIMARY_FILTER_KEYS.includes(statusFilter);

  return (
    <div className="flex items-center gap-3 flex-nowrap">

      {onCreateInitiative && (
        <button
          onClick={onCreateInitiative}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-mono font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md transition-colors flex-shrink-0"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          new
        </button>
      )}

      <div className="relative flex-1 min-w-[160px] max-w-xs flex-shrink-0">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onSearchChange(''); }}
          placeholder="search initiatives…"
          className="w-full pl-8 pr-7 py-1.5 text-sm font-mono border border-surface-300 dark:border-surface-600 rounded-md bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 flex-nowrap flex-shrink-0">
        {/* Primary filter chips */}
        {primaryFilters.map(f => {
          const count = statusCounts[f.key];
          const isActive = statusFilter === f.key;
          const isMine = f.key === 'mine';
          const isAssigned = f.key === 'assigned';
          return (
            <button
              key={f.key}
              onClick={() => onStatusFilterChange(f.key)}
              className={`px-2 py-1.5 text-xs font-mono lowercase rounded-md border transition-colors ${
                isActive
                  ? isMine
                    ? 'bg-sky-600 border-sky-600 text-white font-medium'
                    : isAssigned
                    ? 'bg-violet-600 border-violet-600 text-white font-medium'
                    : 'bg-brand-600 border-brand-600 text-white font-medium'
                  : isMine && myPendingCount > 0
                    ? 'bg-white dark:bg-surface-800 border-sky-300 dark:border-sky-700 text-sky-600 dark:text-sky-400 hover:border-sky-400'
                    : isAssigned && count > 0
                    ? 'bg-white dark:bg-surface-800 border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:border-violet-400'
                    : 'bg-white dark:bg-surface-800 border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-400 dark:hover:border-surface-500'
              }`}
            >
              [{f.label}{(count > 0) && ` ${count}`}]
            </button>
          );
        })}

        {/* Dropdown for secondary filters — always shows "More filters" when a primary filter is active */}
        <select
          value={isSecondaryActive ? statusFilter : '_more'}
          onChange={e => onStatusFilterChange(e.target.value as StatusFilter)}
          className={`text-xs font-mono px-2.5 py-1.5 rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            isSecondaryActive
              ? statusFilter === 'review'
                ? 'bg-amber-600 border-amber-600 text-white font-medium'
                : 'bg-brand-600 border-brand-600 text-white font-medium'
              : 'bg-white dark:bg-surface-800 border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400'
          }`}
        >
          <option value="_more" disabled hidden>More filters</option>
          {STATUS_FILTERS
            .filter(f => !PRIMARY_FILTER_KEYS.includes(f.key))
            .filter(f => !f.adminOnly || isAdmin)
            .map(f => (
              <option key={f.key} value={f.key}>
                {f.label} {statusCounts[f.key] > 0 ? `(${statusCounts[f.key]})` : ''}
              </option>
            ))}
        </select>
      </div>

    </div>
  );
}
