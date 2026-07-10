import type { OpenQuestion } from './artifact-to-markdown';

export type QuestionSource = 'flint' | 'document';

export interface UnifiedQuestion {
  key: string;
  source: QuestionSource;
  text: string;
  type?: string;
  impact?: string;
  owner?: string;
  refId?: string;
}

/**
 * Merges Flint's critic questions and a document's own open questions into one ordered list,
 * tagged by source, so the reviewer sees a single "questions to resolve" view instead of two
 * disconnected panels — used by both the interactive QuestionsReviewPanel and the read-only
 * CriticReviewFlyout.
 */
export function buildUnifiedQuestions(criticQuestions: string[], openQuestions: OpenQuestion[]): UnifiedQuestion[] {
  return [
    ...criticQuestions.map((text, i): UnifiedQuestion => ({ key: `flint-${i}`, source: 'flint', text })),
    ...openQuestions.map((q, i): UnifiedQuestion => ({
      key: `doc-${i}`,
      source: 'document',
      text: q.description,
      type: q.type,
      impact: q.impact,
      owner: q.owner,
      refId: q.id,
    })),
  ];
}
