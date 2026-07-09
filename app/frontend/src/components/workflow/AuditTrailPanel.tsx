import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { STAGE_LABELS } from '../../constants/stage-labels';

interface AuditEntry {
  id: number;
  checkpoint_id: number;
  stage: string;
  user_name: string;
  user_email: string;
  action: string;
  notes: string | null;
  created_at: number;
}

interface AuditTrailPanelProps {
  workflowId: string;
  onClose: () => void;
}

/** Visual treatment per checkpoint action. */
const ACTION_META: Record<string, { verb: string; icon: string; cls: string }> = {
  approved: { verb: 'approved', icon: 'M5 13l4 4L19 7', cls: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30' },
  revised:  { verb: 'requested changes to', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', cls: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30' },
  rejected: { verb: 'rejected', icon: 'M6 18L18 6M6 6l12 12', cls: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30' },
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Modal listing the human approval history for a workflow — who approved, revised,
 * or rejected each stage, when, and any notes. Backed by GET /api/workflow/:id/audit.
 */
export function AuditTrailPanel({ workflowId, onClose }: AuditTrailPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api.getWorkflowAudit(workflowId)
      .then(({ audit }) => { if (!stale) setEntries(audit); })
      .catch(() => { if (!stale) setError('Failed to load audit trail'); });
    return () => { stale = true; };
  }, [workflowId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col bg-surface-50 dark:bg-surface-800 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Activity</h2>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Who reviewed each stage</p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : entries === null ? (
            <p className="text-sm text-surface-400 animate-pulse">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-surface-400 italic">No review actions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {entries.map((e) => {
                const meta = ACTION_META[e.action] ?? { verb: e.action, icon: 'M5 13l4 4L19 7', cls: 'text-surface-500 bg-surface-100 dark:bg-surface-700' };
                return (
                  <li key={e.id} className="flex items-start gap-3">
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${meta.cls}`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={meta.icon} />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-surface-800 dark:text-surface-200">
                        <span className="font-medium">{e.user_name}</span> {meta.verb}{' '}
                        <span className="font-medium">{STAGE_LABELS[e.stage] ?? e.stage}</span>
                      </p>
                      <p className="text-[11px] text-surface-400 dark:text-surface-500">{relativeTime(e.created_at)}</p>
                      {e.notes && (
                        <p className="mt-1 text-xs text-surface-600 dark:text-surface-400 border-l-2 border-surface-200 dark:border-surface-600 pl-2 italic">
                          {e.notes}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
