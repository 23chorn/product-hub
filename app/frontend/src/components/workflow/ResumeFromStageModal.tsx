import { useState } from 'react';
import { FieldLabel } from '../common/FieldLabel';

interface ResumeFromStageModalProps {
  /** Stages the workflow has already reached, in pipeline order — the only valid re-entry points. */
  stages: Array<{ stage: string; label: string }>;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (fromStage: string, feedback: string) => void;
}

/** Lets the user re-enter a stopped/completed workflow at any stage it already reached,
 *  instead of restarting from scratch. Upstream artifacts and approvals are untouched —
 *  only the chosen stage and everything downstream of it are re-run. */
export function ResumeFromStageModal({ stages, loading, onCancel, onConfirm }: ResumeFromStageModalProps) {
  const [fromStage, setFromStage] = useState(stages.at(-1)?.stage ?? '');
  const [feedback, setFeedback] = useState('');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-lg space-y-3 bg-surface-50 dark:bg-surface-800 rounded-xl shadow-2xl p-6 mx-4">
        <div>
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Resume from a stage</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            Re-runs the chosen stage and everything after it. Upstream artifacts and approvals are kept.
          </p>
        </div>
        <div>
          <FieldLabel>stage</FieldLabel>
          <select
            value={fromStage}
            onChange={(e) => setFromStage(e.target.value)}
            className="w-full rounded-md border border-brand-300 dark:border-brand-700 bg-surface-50 dark:bg-surface-900 px-2 py-1.5 text-xs font-mono text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {stages.map(s => (
              <option key={s.stage} value={s.stage}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>instructions for the specialist</FieldLabel>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="what should change, or why you're re-entering here…"
            rows={3}
            className="w-full resize-none rounded-md border border-brand-300 dark:border-brand-700 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm font-mono text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 px-3 text-sm font-mono font-medium rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
          >
            go back
          </button>
          <button
            onClick={() => onConfirm(fromStage, feedback)}
            disabled={loading || !fromStage || !feedback.trim()}
            className="flex-1 py-2 px-3 bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-mono font-medium rounded-md transition-colors"
          >
            {loading ? 'resuming…' : 'resume →'}
          </button>
        </div>
      </div>
    </div>
  );
}
