import type React from 'react';
import type { EnrichedItem } from './AirtableItemList';

interface LocalInitiativeRowProps {
  item: EnrichedItem;
  isSelected: boolean;
  isDeleting: boolean;
  isConfirmingDelete: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  statusBadge: React.ReactNode;
}

export function LocalInitiativeRow({
  item,
  isSelected,
  isDeleting,
  isConfirmingDelete,
  onSelect,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  statusBadge,
}: LocalInitiativeRowProps) {
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
                {item.workflow?.summary || item.initiative}
              </h3>
            </div>
            {statusBadge}
          </div>
          {item.description && (
            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-1">
              {item.description}
            </p>
          )}
        </button>

        {/* Delete button */}
        {isConfirmingDelete ? (
          <div className="flex items-center gap-1 p-2 flex-shrink-0">
            <button
              onClick={onConfirmDelete}
              className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 font-medium"
            >
              Delete
            </button>
            <button
              onClick={onCancelDelete}
              className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
            disabled={isDeleting}
            className="p-2 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-500 transition-colors flex-shrink-0"
            title="Delete initiative"
          >
            {isDeleting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
