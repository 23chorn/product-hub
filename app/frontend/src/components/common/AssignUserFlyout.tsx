import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api';
import type { CurrentUser } from '../../stores/authStore';
import type { EnrichedItem } from '../home/types';

interface Props {
  item: EnrichedItem;
  onClose: () => void;
  onToggle: (userId: number, assign: boolean) => void;
}

export function AssignUserFlyout({ item, onClose, onToggle }: Props) {
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const assignedIds = new Set((item.assignedUsers ?? []).map(u => u.id));

  useEffect(() => {
    api.listUsers()
      .then(data => { setUsers(data.users); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/30" onClick={onClose} />
      <div className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
          <h3 className="text-sm font-medium text-surface-900 dark:text-surface-100">Assign users</h3>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {loading && (
            <div className="px-4 py-3 text-sm text-surface-400">Loading…</div>
          )}
          {!loading && users.length === 0 && (
            <div className="px-4 py-3 text-sm text-surface-400">No users found</div>
          )}
          {users.map(u => {
            const isAssigned = assignedIds.has(u.id);
            return (
              <button
                key={u.id}
                onClick={() => onToggle(u.id, !isAssigned)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isAssigned
                    ? 'bg-brand-500 border-brand-500'
                    : 'border-surface-300 dark:border-surface-600'
                }`}>
                  {isAssigned && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-surface-800 dark:text-surface-200 text-left flex-1">{u.name}</span>
                <span className="text-xs font-mono text-surface-400">@{u.username}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}
