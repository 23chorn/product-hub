import type { RefObject } from 'react';
import { STATUS_FILTERS, type StatusFilter } from './types';

interface HomeHeaderProps {
  syncing: boolean;
  onSync: () => void;
  onNewInitiative: () => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  myPendingCount: number;
  showMineFilter: boolean;
  isAdmin: boolean;
}

/** Sticky Product Hub header: title, sync/new actions, search box, and status filter chips. */
export function HomeHeader({
  syncing,
  onSync,
  onNewInitiative,
  searchQuery,
  onSearchChange,
  searchInputRef,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  myPendingCount,
  showMineFilter,
  isAdmin,
}: HomeHeaderProps) {
  return (
    <div className="flex-shrink-0 bg-white/90 dark:bg-surface-900/80 backdrop-blur-sm border-b border-surface-200 dark:border-surface-700 py-4">
      <div className="max-w-4xl mx-auto px-6 space-y-3">

        {/* Title row */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">Welcome to Product Hub</h2>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1 max-w-xl leading-relaxed">
              {isAdmin
                ? 'Describe a new product initiative and a team of AI agents runs the full pipeline — research, PRD, architecture, backlog, and QA — ready for engineering.'
                : 'Review the research, PRDs, architecture, backlogs, and QA plans waiting on you, and approve or send back changes as initiatives move through the pipeline.'}
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={onSync}
                disabled={syncing}
                title="Sync Pipeline Ready initiatives from Airtable"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/50 hover:bg-surface-50 dark:hover:bg-surface-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? 'Syncing…' : 'Sync Airtable'}
              </button>
              <button
                onClick={onNewInitiative}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Initiative
              </button>
            </div>
          )}
        </div>

        {/* Search + status filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
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

          <div className="flex items-center gap-1 flex-wrap">
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
        </div>
      </div>
    </div>
  );
}
