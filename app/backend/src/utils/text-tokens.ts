/**
 * Shared text tokenizer for keyword-overlap scoring (behaviour doc matching, backlog
 * overlap detection, etc.) — lowercase, split on non-alphanumerics, drop short/stop words.
 */

const BASE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'is', 'are', 'as',
  'this', 'that', 'we', 'our',
]);

export function tokenize(text: string, extraStopwords: string[] = []): Set<string> {
  const stopwords = extraStopwords.length
    ? new Set([...BASE_STOPWORDS, ...extraStopwords])
    : BASE_STOPWORDS;
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stopwords.has(w))
  );
}
