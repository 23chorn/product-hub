import { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import type { BacklogOverlapFlag, BacklogOverlapStory } from '../../../services/api/workflow';

interface Props {
  workflowId: string;
  onClose: () => void;
}

function StoryCard({ story, onKeep, keeping, keepLabel }: {
  story: BacklogOverlapStory;
  onKeep: () => void;
  keeping: boolean;
  keepLabel: string;
}) {
  return (
    <div className="flex-1 min-w-0 px-3 py-2 bg-surface-50 dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700 flex flex-col">
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
          {story.featureKey}
        </span>
        <span className="text-[10px] font-mono text-surface-500 dark:text-surface-400">{story.story_id}</span>
      </div>
      <p className="text-xs font-medium text-surface-900 dark:text-surface-100 mb-1">{story.title ?? '(untitled)'}</p>
      {story.i_want && (
        <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
          <span className="text-surface-400 dark:text-surface-500">wants to</span> {story.i_want}
        </p>
      )}
      <button
        onClick={onKeep}
        disabled={keeping}
        className="mt-2 self-start text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400 rounded transition-colors disabled:opacity-50"
      >
        {keeping ? '…' : keepLabel}
      </button>
    </div>
  );
}

/** Label + tone for a resolved flag's status, shown in the History tab. */
const HISTORY_STATUS_LABEL: Record<string, string> = {
  auto_resolved: 'Auto-removed',
  confirmed: 'Removed by reviewer',
  dismissed: 'Dismissed — kept',
};

function HistoryRow({ flag }: { flag: BacklogOverlapFlag }) {
  const isScopeViolation = flag.flagType === 'scope_violation';
  // scope_violation only ever removes side B (the UI always confirms with keep: 'A' there —
  // see the "Remove this ticket" handler below); a plain overlap can go either way, so it
  // relies on the persisted keptSide rather than guessing.
  const removed = flag.keptSide === 'A' ? flag.storyB : flag.keptSide === 'B' ? flag.storyA : null;
  const kept = flag.keptSide === 'A' ? flag.storyA : flag.keptSide === 'B' ? flag.storyB : null;

  return (
    <div className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-wrap gap-1">
        <span className="text-xs font-medium text-surface-700 dark:text-surface-300">
          {HISTORY_STATUS_LABEL[flag.status] ?? flag.status}
        </span>
        <span className="text-[10px] text-surface-400 dark:text-surface-500">
          {flag.resolvedAt ? new Date(flag.resolvedAt).toLocaleString() : ''}
        </span>
      </div>
      <div className="p-3 space-y-1.5 text-xs text-surface-600 dark:text-surface-400">
        {isScopeViolation ? (
          <p>
            <span className="font-mono font-medium text-surface-700 dark:text-surface-300">{flag.storyB.featureKey}/{flag.storyB.story_id}</span>
            {' '}({flag.storyB.title ?? '(untitled)'}) traced to <span className="font-medium">{flag.matchedTerms[0] ?? '(unknown FR)'}</span>, owned by <span className="font-mono font-medium">{flag.owningFeatureKey}</span>.
          </p>
        ) : (
          <p>
            <span className="font-mono font-medium text-surface-700 dark:text-surface-300">{flag.storyA.featureKey}/{flag.storyA.story_id}</span>
            {' '}vs{' '}
            <span className="font-mono font-medium text-surface-700 dark:text-surface-300">{flag.storyB.featureKey}/{flag.storyB.story_id}</span>
            {' '}— {Math.round(flag.score * 100)}% token overlap{flag.matchedTerms.length > 0 && ` (${flag.matchedTerms.join(', ')})`}.
          </p>
        )}
        {flag.status !== 'dismissed' && (
          <p className="text-surface-500 dark:text-surface-500">
            Removed: <span className="font-mono">{removed?.featureKey}/{removed?.story_id}</span>
            {kept && <> — kept <span className="font-mono">{kept.featureKey}/{kept.story_id}</span></>}
          </p>
        )}
        {flag.notes && <p className="italic text-surface-400 dark:text-surface-500">"{flag.notes}"</p>}
      </div>
    </div>
  );
}

export function BacklogOverlapPanel({ workflowId, onClose }: Props) {
  const [allFlags, setAllFlags] = useState<BacklogOverlapFlag[]>([]);
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flags = allFlags.filter(f => f.status === 'pending');
  const history = allFlags.filter(f => f.status !== 'pending').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));

  useEffect(() => {
    loadFlags();
  }, [workflowId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadFlags() {
    setLoading(true);
    try {
      const { flags: f } = await api.getBacklogOverlaps(workflowId);
      setAllFlags(f);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to load overlap candidates');
    } finally {
      setLoading(false);
    }
  }

  /** keep: which side survives — the other side's story (and its ADO ticket/test cases, if
   *  already pushed) is deleted. Omitted for a dismiss (not a real duplicate — nothing deleted).
   *  For a scope_violation flag, side A is always a placeholder (no real "other" story), so
   *  callers always pass 'A' there — it just means "remove side B". */
  async function resolve(id: number, status: 'confirmed' | 'dismissed', keep?: 'A' | 'B', successMessage?: string) {
    setActioning(id);
    setError(null);
    try {
      await api.resolveBacklogOverlap(id, status, { keep });
      // Re-fetch rather than patch locally — resolving updates resolvedAt/notes server-side
      // and the flag needs to reappear in the History tab with that data, not just vanish.
      await loadFlags();
      setToast(successMessage ?? (status === 'confirmed' ? 'Resolved.' : 'Dismissed as false positive.'));
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to update overlap flag');
    } finally {
      setActioning(null);
    }
  }

  const overlapCount = flags.filter(f => f.flagType !== 'scope_violation').length;
  const violationCount = flags.filter(f => f.flagType === 'scope_violation').length;

  return (
    <div className="bg-white dark:bg-surface-900 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 w-full max-w-3xl max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            Scope Overlaps
          </h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            {view === 'pending' ? (
              <>
                {overlapCount > 0 && `${overlapCount} overlapping pair${overlapCount !== 1 ? 's' : ''}`}
                {overlapCount > 0 && violationCount > 0 && ', '}
                {violationCount > 0 && `${violationCount} out-of-scope ticket${violationCount !== 1 ? 's' : ''}`}
                {overlapCount === 0 && violationCount === 0 && 'Nothing pending'}
                {' '}— keep/remove or dismiss each
              </>
            ) : (
              `${history.length} resolved — auto-removed, manually removed, or dismissed`
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
        {(['pending', 'history'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
              view === v
                ? 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
            }`}
          >
            {v === 'pending' ? `Pending${flags.length > 0 ? ` (${flags.length})` : ''}` : `History${history.length > 0 ? ` (${history.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div className="mx-5 mt-3 flex-shrink-0 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-xs text-green-700 dark:text-green-400">{toast}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 flex-shrink-0 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Overlap list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && (
          <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-8">Loading…</p>
        )}

        {!loading && view === 'pending' && flags.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-surface-500 dark:text-surface-400">No pending overlap candidates.</p>
            <button
              onClick={onClose}
              className="mt-3 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              Close
            </button>
          </div>
        )}

        {!loading && view === 'history' && history.length === 0 && (
          <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-12">
            No resolved overlaps yet.
          </p>
        )}

        {!loading && view === 'history' && history.map(flag => <HistoryRow key={flag.id} flag={flag} />)}

        {!loading && view === 'pending' && flags.map((flag) => {
          const busy = actioning === flag.id;

          if (flag.flagType === 'scope_violation') {
            const frId = flag.matchedTerms[0] ?? '(unknown FR)';
            return (
              <div
                key={flag.id}
                className="border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden"
              >
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between">
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    Traces to <span className="font-medium">{frId}</span>, which belongs to feature <span className="font-mono font-medium">{flag.owningFeatureKey}</span> — not this one
                  </span>
                  <button
                    onClick={() => resolve(flag.id, 'dismissed', undefined, 'Dismissed as not out of scope.')}
                    disabled={busy}
                    className="text-xs px-2 py-1 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 rounded transition-colors disabled:opacity-50 flex-shrink-0 ml-3"
                  >
                    Not out of scope
                  </button>
                </div>
                <div className="p-3">
                  <StoryCard
                    story={flag.storyB}
                    onKeep={() => resolve(flag.id, 'confirmed', 'A', `Removed from ${flag.storyB.featureKey} — belongs to ${flag.owningFeatureKey}.`)}
                    keeping={busy}
                    keepLabel="Remove this ticket"
                  />
                </div>
              </div>
            );
          }

          return (
            <div
              key={flag.id}
              className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden"
            >
              <div className="px-3 py-2 bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
                <span className="text-xs text-surface-500 dark:text-surface-400">
                  Token overlap: <span className="font-medium text-surface-700 dark:text-surface-300">{Math.round(flag.score * 100)}%</span>
                  {flag.matchedTerms.length > 0 && (
                    <span className="ml-2 text-surface-400 dark:text-surface-500">
                      ({flag.matchedTerms.join(', ')})
                    </span>
                  )}
                </span>
                <button
                  onClick={() => resolve(flag.id, 'dismissed')}
                  disabled={busy}
                  className="text-xs px-2 py-1 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 rounded transition-colors disabled:opacity-50"
                >
                  Not a duplicate
                </button>
              </div>

              <div className="p-3 flex items-stretch gap-3">
                <StoryCard
                  story={flag.storyA}
                  onKeep={() => resolve(flag.id, 'confirmed', 'A', 'Kept the first ticket, deleted the other.')}
                  keeping={busy}
                  keepLabel="Keep this, delete the other"
                />
                <div className="flex items-center text-surface-300 dark:text-surface-600 text-xs">vs</div>
                <StoryCard
                  story={flag.storyB}
                  onKeep={() => resolve(flag.id, 'confirmed', 'B', 'Kept the second ticket, deleted the other.')}
                  keeping={busy}
                  keepLabel="Keep this, delete the other"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
