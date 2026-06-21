import { useState } from 'react';
import type { OpenQuestion } from '../../utils/artifact-to-markdown';

interface OpenQuestionsPanelProps {
  questions: OpenQuestion[];
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  loading: boolean;
}

const IMPACT_COLORS: Record<string, string> = {
  high:   'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low:    'text-surface-500 dark:text-surface-400',
};

export function OpenQuestionsPanel({ questions, onSubmit, onCancel, loading }: OpenQuestionsPanelProps) {
  const [answers, setAnswers]   = useState<Record<number, string>>({});
  const [leftOpen, setLeftOpen] = useState<Set<number>>(new Set());

  function setAnswer(idx: number, value: string) {
    setAnswers(prev => ({ ...prev, [idx]: value }));
  }

  function toggleLeaveOpen(idx: number) {
    setLeftOpen(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function handleSubmit() {
    const lines: string[] = ['## Open Questions — Human Answers\n'];

    questions.forEach((q, i) => {
      lines.push(`**${q.id || `Q${i + 1}`} (${q.type}): ${q.description}**`);
      if (q.impact) lines.push(`Impact: ${q.impact}${q.owner ? ` | Owner: ${q.owner}` : ''}`);
      if (leftOpen.has(i)) {
        lines.push('Decision: Leave open — answer not yet available\n');
      } else {
        lines.push(`Answer: ${answers[i]?.trim() || 'No answer provided'}`);
        lines.push('Decision: Mark as Resolved\n');
      }
    });

    lines.push('');
    lines.push(
      'Instructions: Update the open_questions section. ' +
      'For each question marked "Mark as Resolved", set status to "Resolved" and incorporate ' +
      'the answer into the relevant functional requirements, constraints, or notes. ' +
      'Leave questions marked "Leave open" with status "Open" unchanged.'
    );

    onSubmit(lines.join('\n'));
  }

  const answeredCount  = Object.values(answers).filter(a => a.trim()).length;
  const leftOpenCount  = leftOpen.size;
  const hasAnyAction   = answeredCount + leftOpenCount > 0;
  const pendingCount   = questions.length - answeredCount - leftOpenCount;

  return (
    <div className="flex flex-col h-full">
      {/* Question cards */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-3">
        {questions.map((q, idx) => {
          const isOpen  = !leftOpen.has(idx);
          const answered = !!(answers[idx]?.trim());
          return (
            <div
              key={idx}
              className={`rounded-lg border p-3 space-y-2 transition-colors ${
                leftOpen.has(idx)
                  ? 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 opacity-60'
                  : answered
                  ? 'border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-900/10'
                  : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">
                      {q.type}
                    </span>
                    {q.impact && (
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${IMPACT_COLORS[q.impact.toLowerCase()] ?? IMPACT_COLORS.low}`}>
                        {q.impact} impact
                      </span>
                    )}
                    {q.id && (
                      <span className="text-[10px] text-surface-400 dark:text-surface-600">#{q.id}</span>
                    )}
                  </div>
                  <p className="text-sm text-surface-800 dark:text-surface-200 leading-snug">{q.description}</p>
                  {q.owner && (
                    <p className="text-[11px] text-surface-400 dark:text-surface-500">Owner: {q.owner}</p>
                  )}
                </div>

                {/* Leave open toggle */}
                <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={leftOpen.has(idx)}
                    onChange={() => toggleLeaveOpen(idx)}
                    className="rounded border-surface-300 dark:border-surface-600 text-surface-500"
                  />
                  <span className="text-[10px] text-surface-400 dark:text-surface-500 whitespace-nowrap">Leave open</span>
                </label>
              </div>

              {/* Answer input */}
              {isOpen && (
                <textarea
                  value={answers[idx] ?? ''}
                  onChange={(e) => setAnswer(idx, e.target.value)}
                  placeholder="Enter your answer…"
                  rows={2}
                  className="w-full text-sm resize-none rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress summary + actions */}
      <div className="flex-shrink-0 pt-3 border-t border-surface-200 dark:border-surface-700 space-y-2">
        {hasAnyAction && (
          <p className="text-[11px] text-surface-400 dark:text-surface-500">
            {answeredCount > 0 && <span>{answeredCount} answered</span>}
            {answeredCount > 0 && leftOpenCount > 0 && <span> · </span>}
            {leftOpenCount > 0 && <span>{leftOpenCount} left open</span>}
            {pendingCount > 0 && <span className="ml-1 text-surface-300 dark:text-surface-600">· {pendingCount} pending</span>}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!hasAnyAction || loading}
            className="flex-1 py-2 px-3 bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Sending…' : 'Submit Answers'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="py-2 px-3 text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
