import type React from 'react';
import type { EnrichedItem } from './AirtableItemList';

interface RoadmapItemRowProps {
  item: EnrichedItem;
  isSelected: boolean;
  onSelect: () => void;
  statusBadge: React.ReactNode;
}

export function RoadmapItemRow({
  item,
  isSelected,
  onSelect,
  statusBadge,
}: RoadmapItemRowProps) {
  return (
    <div
      className={`rounded-lg border-2 transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm ring-1 ring-blue-200 dark:ring-blue-800'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
      }`}
    >
      <button
        className="w-full text-left p-3 min-w-0"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            {isSelected && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />}
            <h3 className={`font-medium text-sm truncate ${isSelected ? 'text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>
              {item.initiative}
            </h3>
          </div>
          {statusBadge}
        </div>
        {item.description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
            {item.description}
          </p>
        )}
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
            <span className="text-xs text-gray-500 dark:text-gray-400">{item.businessValue}/10</span>
          )}
        </div>
      </button>
    </div>
  );
}
