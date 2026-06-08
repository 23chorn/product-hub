import type React from 'react';
import type { EnrichedItem } from './AirtableItemList';

interface RoadmapItemRowProps {
  item: EnrichedItem;
  isSelected: boolean;
  isTriggeringId: string | null;
  onSelect: () => void;
  onTrigger?: () => void;
  statusBadge: React.ReactNode;
}

export function RoadmapItemRow({
  item,
  isSelected,
  isTriggeringId,
  onSelect,
  onTrigger,
  statusBadge,
}: RoadmapItemRowProps) {
  const isTriggering = isTriggeringId === item.id;
  const canTrigger = !!onTrigger && !item.workflow?.status?.match(/^(active|paused_at_checkpoint)$/);

  return (
    <div
      className={`rounded-lg border-2 transition-all ${
        isSelected
          ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 shadow-sm ring-1 ring-teal-200 dark:ring-teal-800'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-500'
      }`}
    >
      <div className="flex items-start">
      <button
        className="flex-1 text-left p-3 min-w-0"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            {isSelected && <div className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0" />}
            <h3 className={`font-medium text-sm truncate ${isSelected ? 'text-teal-900 dark:text-teal-300' : 'text-slate-900 dark:text-slate-100'}`}>
              {item.initiative}
            </h3>
          </div>
          {statusBadge}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {item.estimate && (
            <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
              item.estimate === 'XS' || item.estimate === 'S'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                : item.estimate === 'M'
                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
            }`}>
              {item.estimate}
            </span>
          )}
          {item.businessValue !== undefined && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{item.businessValue}/10</span>
          )}
        </div>
      </button>

      {/* Trigger button */}
      {canTrigger && (
        <button
          onClick={(e) => { e.stopPropagation(); onTrigger!(); }}
          disabled={isTriggering}
          title="Launch workflow from this brief"
          className="p-2 text-slate-300 dark:text-slate-600 hover:text-teal-500 dark:hover:text-teal-400 transition-colors flex-shrink-0 self-center"
        >
          {isTriggering ? (
            <svg className="w-3.5 h-3.5 animate-spin text-teal-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
        </button>
      )}
      </div>
    </div>
  );
}
