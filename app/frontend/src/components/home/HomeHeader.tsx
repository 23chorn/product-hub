import type { RefObject } from 'react';
import { STATUS_FILTERS, type StatusFilter } from './types';

interface HomeHeaderProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  myPendingCount: number;
  showMineFilter: boolean;
  productAreas: string[];
  productAreaFilter: string;
  onProductAreaFilterChange: (v: string) => void;
  themes: string[];
  themeFilter: string;
  onThemeFilterChange: (v: string) => void;
  onCreateInitiative?: () => void;
}

/** Home screen search box, status filter chips, and product area/theme filters —
 * portaled into the shared PageHeader's actions slot. */
export function HomeHeader({
  searchQuery,
  onSearchChange,
  searchInputRef,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  myPendingCount,
  showMineFilter,
  productAreas,
  productAreaFilter,
  onProductAreaFilterChange,
  themes,
  themeFilter,
  onThemeFilterChange,
  onCreateInitiative,
}: HomeHeaderProps) {
  return (
    <div className="flex items-center gap-3 flex-nowrap">

      {onCreateInitiative && (
        <button
          onClick={onCreateInitiative}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg transition-colors flex-shrink-0"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New
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
          placeholder="Search initiatives…"
          className="w-full pl-8 pr-7 py-1.5 text-sm border border-surface-200 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
        {STATUS_FILTERS.filter(f => f.key !== 'mine' || showMineFilter).map(f => {
          const count = statusCounts[f.key];
          const isActive = statusFilter === f.key;
          const isReview = f.key === 'review';
          const isMine = f.key === 'mine';
          return (
            <button
              key={f.key}
              onClick={() => onStatusFilterChange(f.key)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                isActive
                  ? isMine
                    ? 'bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-600 text-sky-800 dark:text-sky-200 font-medium'
                    : isReview
                      ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-200 font-medium'
                      : 'bg-brand-50 dark:bg-brand-900/40 border-brand-300 dark:border-brand-600 text-brand-800 dark:text-brand-200 font-medium'
                  : isMine && myPendingCount > 0
                    ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-700 text-sky-600 dark:text-sky-400 hover:border-sky-300'
                    : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-500'
              }`}
            >
              {f.label}
              {count > 0 && f.key !== 'all' && (
                <span className={`ml-1 ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                  {count}
                </span>
              )}
              {f.key === 'all' && (
                <span className={`ml-1 ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Product area + theme filters */}
      {productAreas.length > 0 && (
        <select
          value={productAreaFilter}
          onChange={e => onProductAreaFilterChange(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All product areas</option>
          {productAreas.map(area => <option key={area} value={area}>{area}</option>)}
        </select>
      )}
      {themes.length > 0 && (
        <select
          value={themeFilter}
          onChange={e => onThemeFilterChange(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All themes</option>
          {themes.map(theme => <option key={theme} value={theme}>{theme}</option>)}
        </select>
      )}

    </div>
  );
}
