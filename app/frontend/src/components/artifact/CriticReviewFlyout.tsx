import { MarkdownContent } from '../common/MarkdownContent';
import { CriticIssuesPanel } from './CriticQuestionForm';

interface CriticReviewFlyoutProps {
  issues: any[];
  questions: string[];
  onClose: () => void;
}

/** Absolutely-positioned left flyout summarising Flint's issues and questions for the current artifact. */
export function CriticReviewFlyout({ issues, questions, onClose }: CriticReviewFlyoutProps) {
  const hasIssues = issues.length > 0;
  const hasQuestions = questions.length > 0;

  return (
    <div className="absolute top-0 left-0 w-[380px] h-full overflow-y-auto border-r border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 shadow-lg flex flex-col z-10">
      <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Flint's Review</h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            {hasIssues && <>{issues.length} issue{issues.length !== 1 ? 's' : ''}</>}
            {hasIssues && hasQuestions && ' · '}
            {hasQuestions && <>{questions.length} question{questions.length !== 1 ? 's' : ''}</>}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {hasIssues && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Issues</p>
            <CriticIssuesPanel issues={issues} />
          </div>
        )}
        {hasQuestions && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">Questions</p>
            <div className="space-y-2">
              {questions.map((q: string, i: number) => (
                <div key={i} className="text-sm rounded-lg border border-surface-200 dark:border-surface-700 p-3">
                  <span className="text-xs font-medium text-surface-400 dark:text-surface-500 mr-1">Q{i + 1}:</span>
                  <MarkdownContent className="mt-1 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">{q}</MarkdownContent>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
