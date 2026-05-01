import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CriticQuestionFormProps {
  questions: string[];
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  loading: boolean;
}

const SUGGESTED_ANSWERS = [
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
            <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  <span className="text-slate-500 dark:text-slate-400 mr-1">Q{idx + 1}:</span>
                  <div className="inline prose prose-sm dark:prose-invert max-w-none [&_p]:my-0.5 [&_p:first-child]:inline">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{question}</ReactMarkdown>
                  </div>
                </div>
                <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipped.has(idx)}
                    onChange={() => toggleSkip(idx)}
                    className="rounded border-slate-300 dark:border-slate-600 text-slate-500"
                  />
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">Skip</span>
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
                            ? 'bg-teal-100 dark:bg-teal-900/40 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-700 dark:hover:text-slate-300'
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
                    className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Additional feedback */}
        <div>
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">
            Additional feedback (optional)
          </label>
          <textarea
            value={additionalFeedback}
            onChange={(e) => setAdditionalFeedback(e.target.value)}
            placeholder="Any other notes for the specialist..."
            rows={2}
            className="w-full text-sm resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Pinned actions */}
      <div className="flex gap-2 pt-3 flex-shrink-0 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={handleSubmit}
          disabled={!hasAnyAnswer || loading}
          className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? 'Sending...' : 'Send Revision'}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="py-2 px-3 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Issues panel content (rendered separately in ArtifactViewer) ─────────────

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  major: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  minor: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
};

export function CriticIssuesPanel({ issues }: { issues: Array<{ severity: string; description: string }> }) {
  return (
    <div className="space-y-2">
      {issues.map((issue, i) => (
        <div key={i} className={`text-sm px-3 py-2 rounded-lg border ${SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.minor}`}>
          <span className="font-semibold uppercase text-[11px] tracking-wide">{issue.severity}</span>
          <div className="mt-1 text-slate-800 dark:text-slate-200 prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.description}</ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
