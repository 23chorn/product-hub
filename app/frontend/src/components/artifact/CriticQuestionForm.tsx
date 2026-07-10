import { useState } from 'react';
import { MarkdownContent } from '../common/MarkdownContent';
import { DotLabel } from './ArtifactPrimitives';

interface CriticQuestionFormProps {
  questions: string[];
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  loading: boolean;
}

export const SUGGESTED_ANSWERS = [
  'Not applicable to this scope',
  'Will address in next iteration',
  'Already covered in the artifact',
  'Accepted as-is',
];

export function CriticQuestionForm({ questions, onSubmit, onCancel, loading }: CriticQuestionFormProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [additionalFeedback, setAdditionalFeedback] = useState('');

  function setAnswer(idx: number, value: string) {
    setAnswers(prev => ({ ...prev, [idx]: value }));
    setSkipped(prev => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }

  function toggleSkip(idx: number) {
    setSkipped(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function handleSubmit() {
    const lines: string[] = ['## Flint\'s Questions — Answers\n'];
    questions.forEach((q, i) => {
      lines.push(`**Q${i + 1}: ${q}**`);
      if (skipped.has(i)) {
        lines.push('A: Skipped\n');
      } else {
        lines.push(`A: ${answers[i]?.trim() || 'No answer provided'}\n`);
      }
    });
    if (additionalFeedback.trim()) {
      lines.push('## Additional Feedback');
      lines.push(additionalFeedback.trim());
    }
    onSubmit(lines.join('\n'));
  }

  const hasAnyAnswer = Object.values(answers).some(a => a.trim()) || skipped.size > 0 || additionalFeedback.trim();

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-3">
        {/* Questions */}
        <div className="space-y-3">
          {questions.map((question, idx) => (
            <div key={idx} className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-surface-900 dark:text-surface-100">
                  <span className="text-surface-500 dark:text-surface-400 mr-1">Q{idx + 1}:</span>
                  <MarkdownContent className="inline [&_p]:my-0.5 [&_p:first-child]:inline">{question}</MarkdownContent>
                </div>
                <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipped.has(idx)}
                    onChange={() => toggleSkip(idx)}
                    className="rounded border-surface-300 dark:border-surface-600 text-surface-500"
                  />
                  <span className="text-[10px] text-surface-400 dark:text-surface-500">Skip</span>
                </label>
              </div>
              {!skipped.has(idx) && (
                <>
                  <div className="flex flex-wrap gap-1">
                    {SUGGESTED_ANSWERS.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setAnswer(idx, suggestion)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                          answers[idx] === suggestion
                            ? 'bg-brand-100 dark:bg-brand-900/40 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                            : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600 hover:text-surface-700 dark:hover:text-surface-300'
                        }`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={answers[idx] ?? ''}
                    onChange={(e) => setAnswer(idx, e.target.value)}
                    placeholder="Type your answer..."
                    className="w-full text-sm rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-2.5 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Additional feedback */}
        <div>
          <label className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1 block">
            Additional feedback (optional)
          </label>
          <textarea
            value={additionalFeedback}
            onChange={(e) => setAdditionalFeedback(e.target.value)}
            placeholder="Any other notes for the specialist..."
            rows={2}
            className="w-full text-sm resize-none rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Pinned actions */}
      <div className="flex gap-2 pt-3 flex-shrink-0 border-t border-surface-200 dark:border-surface-700">
        <button
          onClick={handleSubmit}
          disabled={!hasAnyAnswer || loading}
          className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? 'Sending...' : 'Send Revision'}
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
  );
}

// ── Issues panel content (rendered separately in ArtifactViewer) ─────────────

const SEVERITY_STYLES: Record<string, { dot: string; text: string }> = {
  critical: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  major: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  minor: { dot: 'bg-surface-400 dark:bg-surface-500', text: 'text-surface-500 dark:text-surface-400' },
};

export function CriticIssuesPanel({ issues }: { issues: Array<{ severity: string; description: string }> }) {
  return (
    <div className="space-y-2">
      {issues.map((issue, i) => {
        const style = SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.minor;
        return (
          <div key={i} className="rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/30 px-3 py-2.5">
            <DotLabel dotClass={style.dot} textClass={`${style.text} font-semibold uppercase tracking-wide`} label={issue.severity} />
            <MarkdownContent className="mt-1.5 text-sm [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">{issue.description}</MarkdownContent>
          </div>
        );
      })}
    </div>
  );
}
