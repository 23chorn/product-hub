import { useState } from 'react';
import type { DiscoveryOpportunity, DiscoveryOpportunityStatus } from '@pap/shared';
import { OpportunityCard } from './OpportunityCard';

interface OpportunityFeedProps {
  opportunities: DiscoveryOpportunity[];
  loading: boolean;
  canMutate: boolean;
  canPromote: boolean;
  onDismiss: (id: number) => void;
  onPromoteClick: (opportunity: DiscoveryOpportunity) => void;
}

const FILTERS: Array<{ key: DiscoveryOpportunityStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'promoted', label: 'Promoted' },
  { key: 'dismissed', label: 'Dismissed' },
];

export function OpportunityFeed({ opportunities, loading, canMutate, canPromote, onDismiss, onPromoteClick }: OpportunityFeedProps) {
  const [filter, setFilter] = useState<DiscoveryOpportunityStatus | 'all'>('new');

  const filtered = filter === 'all' ? opportunities : opportunities.filter(o => o.status === filter);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-surface-200 dark:border-surface-700">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              filter === f.key
                ? 'bg-brand-600 text-white'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="text-center text-sm text-surface-400 py-8">Loading opportunities...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-surface-400 py-8">
            No {filter === 'all' ? '' : filter} opportunities yet. Select sources and run discovery.
          </div>
        ) : (
          filtered.map(opportunity => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              canMutate={canMutate}
              canPromote={canPromote}
              onDismiss={onDismiss}
              onPromoteClick={onPromoteClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
