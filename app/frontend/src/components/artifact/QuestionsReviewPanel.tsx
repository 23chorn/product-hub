import { useState } from 'react';
import { MarkdownContent } from '../common/MarkdownContent';
import { QuestionSourceTag } from './ArtifactPrimitives';
import { SUGGESTED_ANSWERS } from './CriticQuestionForm';
import { buildUnifiedQuestions, type UnifiedQuestion } from '../../utils/unified-questions';
import type { OpenQuestion } from '../../utils/artifact-to-markdown';

interface QuestionsReviewPanelProps {
  criticQuestions: string[];
  openQuestions: OpenQuestion[];
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  loading: boolean;
}

const IMPACT_COLORS: Record<string, string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-surface-500 dark:text-surface-400',
};

/**
 * One combined review view for both Flint's critic questions and the document's own open
 * questions — replaces the separate critic-question form and open-questions panel so the
 * reviewer answers/skips everything in a single pass, tagged by source (see
 * buildUnifiedQuestions). Submits one revision feedback string built from whichever groups
 * actually got a response, preserving each group's own instructions to the revising agent.
 */
export function QuestionsReviewPanel({ criticQuestions, openQuestions, onSubmit, onCancel, loading }: QuestionsReviewPanelProps) {
  const items = buildUnifiedQuestions(criticQuestions, openQuestions);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unresolved, setUnresolved] = useState<Set<string>>(new Set());
  const [additionalFeedback, setAdditionalFeedback] = useState('');

  function setAnswer(key: string, value: string) {
    setAnswers(prev => ({ ...prev, [key]: value }));
    setUnresolved(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleUnresolved(key: string) {
    setUnresolved(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const acted = (q: UnifiedQuestion) => !!answers[q.key]?.trim() || unresolved.has(q.key);

  function handleSubmit() {
    const flintItems = items.filter(q => q.source === 'flint');
    const docItems = items.filter(q => q.source === 'document');
    const flintActed = flintItems.some(acted);
    const docActed = docItems.some(acted);
    const lines: string[] = [];

    // Each group is only included if the reviewer actually touched one of its questions —
    // a note-only or single-group submit shouldn't report every question in the other group
    // as "No answer provided".
    if (flintActed) {
      lines.push('## Flint\'s Questions — Answers\n');
      flintItems.forEach((q, i) => {
        lines.push(`**Q${i + 1}: ${q.text}**`);
        lines.push(unresolved.has(q.key) ? 'A: Skipped\n' : `A: ${answers[q.key]?.trim() || 'No answer provided'}\n`);
      });
    }

    if (docActed) {
      if (lines.length) lines.push('');
      lines.push('## Open Questions — Human Answers\n');
      docItems.forEach((q, i) => {
        lines.push(`**${q.refId || `Q${i + 1}`} (${q.type}): ${q.text}**`);
        if (q.impact) lines.push(`Impact: ${q.impact}${q.owner ? ` | Owner: ${q.owner}` : ''}`);
        if (unresolved.has(q.key)) {
          lines.push('Decision: Leave open — answer not yet available\n');
        } else {
          lines.push(`Answer: ${answers[q.key]?.trim() || 'No answer provided'}`);
          lines.push('Decision: Mark as Resolved\n');
        }
      });
      lines.push('');
      lines.push('## Revision Instructions for Open Questions\n');
      lines.push(
        '1. Update the open_questions array in your JSON output:\n' +
        '   - For each question marked "Mark as Resolved": set status to "Resolved" and add an "answer" field with the provided answer text\n' +
        '   - For questions marked "Leave open": keep status as "Open" and do not modify\n' +
        '\n' +
        '2. Incorporate resolved answers into the document:\n' +
        '   - If the answer adds a new requirement, add it to functional_requirements or non_functional_requirements\n' +
        '   - If the answer clarifies scope, update out_of_scope or the problem_statement\n' +
        '   - If the answer specifies a constraint, add it to non_functional_requirements or update relevant sections\n' +
        '   - Reference the resolved question ID (e.g., "per Q1 resolution") in the updated sections\n' +
        '\n' +
        '3. Do NOT remove resolved questions from open_questions — mark them as "Resolved" with the answer, so there is a record of what was decided.'
      );
    }

    if (additionalFeedback.trim()) {
      if (lines.length) lines.push('');
      lines.push('## Additional Feedback');
      lines.push(additionalFeedback.trim());
    }

    onSubmit(lines.join('\n'));
  }

  const hasAnyAction = items.some(acted) || additionalFeedback.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-3">
        {items.map((q, idx) => {
          const isUnresolved = unresolved.has(q.key);
          const answered = !!answers[q.key]?.trim();
          const unresolvedLabel = q.source === 'flint' ? 'Skip' : 'Leave open';
          return (
            <div
              key={q.key}
              className={`rounded border p-3 space-y-2 transition-colors ${
                isUnresolved
                  ? 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 opacity-60'
                  : answered
                  ? 'border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-900/10'
                  : 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <QuestionSourceTag source={q.source} />
                    {q.type && <span className="font-mono text-[10px] uppercase tracking-wide text-surface-400 dark:text-surface-500">· {q.type}</span>}
                    {q.impact && (
                      <span className={`font-mono text-[10px] uppercase tracking-wide ${IMPACT_COLORS[q.impact.toLowerCase()] ?? IMPACT_COLORS.low}`}>
                        · {q.impact} impact
                      </span>
                    )}
                    {q.refId && <span className="font-mono text-[10px] text-surface-400 dark:text-surface-600">#{q.refId}</span>}
                  </div>
                  <div className="text-sm text-surface-800 dark:text-surface-200 leading-snug">
                    <span className="text-surface-400 dark:text-surface-500 mr-1 font-mono text-[11px]">Q{idx + 1}:</span>
                    <MarkdownContent className="inline [&_p]:my-0.5 [&_p:first-child]:inline">{q.text}</MarkdownContent>
                  </div>
                  {q.owner && <p className="text-[11px] text-surface-400 dark:text-surface-500">Owner: {q.owner}</p>}
                </div>
                <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={isUnresolved}
                    onChange={() => toggleUnresolved(q.key)}
                    className="rounded border-surface-300 dark:border-surface-600 text-surface-500"
                  />
                  <span className="text-[10px] text-surface-400 dark:text-surface-500 whitespace-nowrap">{unresolvedLabel}</span>
                </label>
              </div>

              {!isUnresolved && (
                <>
                  <div className="flex flex-wrap gap-1">
                    {SUGGESTED_ANSWERS.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setAnswer(q.key, suggestion)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                          answers[q.key] === suggestion
                            ? 'bg-brand-100 dark:bg-brand-900/40 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300'
                            : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600 hover:text-surface-700 dark:hover:text-surface-300'
                        }`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswer(q.key, e.target.value)}
                    placeholder="Type your answer…"
                    rows={2}
                    className="w-full text-sm resize-none rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Additional feedback — sent together with the answers above */}
      <div className="flex-shrink-0 pt-3 border-t border-surface-200 dark:border-surface-700 space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wide text-surface-400 dark:text-surface-500">
          Additional feedback <span className="font-normal normal-case">(optional)</span>
        </label>
        <textarea
          value={additionalFeedback}
          onChange={(e) => setAdditionalFeedback(e.target.value)}
          placeholder="Any other notes for the specialist…"
          rows={2}
          className="w-full text-sm resize-none rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="flex gap-2 pt-3 flex-shrink-0">
        <button
          onClick={handleSubmit}
          disabled={!hasAnyAction || loading}
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
