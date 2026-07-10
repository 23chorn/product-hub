import { MarkdownContent } from '../common/MarkdownContent';
import { CriticIssuesPanel } from './CriticQuestionForm';
import { PanelChromeHeader, QuestionSourceTag } from './ArtifactPrimitives';
import { buildUnifiedQuestions } from '../../utils/unified-questions';
import type { OpenQuestion } from '../../utils/artifact-to-markdown';

interface CriticReviewFlyoutProps {
  issues: any[];
  questions: string[];
  openQuestions?: OpenQuestion[];
  onClose: () => void;
}

/** Absolutely-positioned left flyout — read-only peek at Flint's issues plus every question
 *  awaiting an answer (Flint's own + the document's open questions, tagged by source via
 *  buildUnifiedQuestions) without entering the interactive review panel. */
export function CriticReviewFlyout({ issues, questions, openQuestions = [], onClose }: CriticReviewFlyoutProps) {
  const hasIssues = issues.length > 0;
  const items = buildUnifiedQuestions(questions, openQuestions);
  const hasQuestions = items.length > 0;

  return (
    <div className="w-full h-full overflow-y-auto border-r border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 shadow-lg flex flex-col">
      <PanelChromeHeader
        label="review"
        meta={
          <>
            {hasIssues && <>{issues.length} issue{issues.length !== 1 ? 's' : ''}</>}
            {hasIssues && hasQuestions && ' · '}
            {hasQuestions && <>{items.length} question{items.length !== 1 ? 's' : ''}</>}
          </>
        }
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {hasIssues && (
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-surface-500 dark:text-surface-400 mb-2">Issues</p>
            <CriticIssuesPanel issues={issues} />
          </div>
        )}
        {hasQuestions && (
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-surface-500 dark:text-surface-400 mb-2">Questions</p>
            <div className="space-y-2">
              {items.map((q, i) => (
                <div key={q.key} className="text-sm rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/30 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <QuestionSourceTag source={q.source} />
                    <span className="font-mono text-[10px] text-surface-400 dark:text-surface-500">Q{i + 1}</span>
                    {q.refId && <span className="font-mono text-[10px] text-surface-400 dark:text-surface-600">#{q.refId}</span>}
                  </div>
                  <MarkdownContent className="[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">{q.text}</MarkdownContent>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
