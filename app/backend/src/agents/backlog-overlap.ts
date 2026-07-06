/**
 * Deterministic cross-feature scope-overlap detection, run at the backlog_merge stage
 * (see runBacklogMerge in feature-stage-runner.ts). Each story_decomposition_F* stage
 * refines its feature in isolation — nothing stops two features from independently
 * producing stories that cover the same capability. This does a cheap token-overlap
 * pass across every cross-feature story pair and flags candidates for human review;
 * it never blocks the merge or auto-removes anything.
 */
import { tokenize } from '../utils/text-tokens';

const OVERLAP_THRESHOLD = 0.35;
const MAX_MATCHED_TERMS = 8;

// Gherkin/story scaffolding words that would otherwise dominate token overlap across
// unrelated stories (every acceptance criterion starts with these).
const EXTRA_STOPWORDS = ['given', 'when', 'then', 'and', 'app', 'system', 'able'];

interface StoryLike {
  story_id?: string;
  title?: string;
  as_a?: string;
  i_want?: string;
  so_that?: string;
  acceptance_criteria?: string[];
}

interface FeatureLike {
  key?: string;
  title?: string;
  stories?: StoryLike[];
}

export interface OverlapCandidate {
  featureKeyA: string;
  storyIdA: string;
  featureKeyB: string;
  storyIdB: string;
  score: number;
  matchedTerms: string[];
}

function storyText(story: StoryLike): string {
  return [story.title, story.i_want, story.so_that, ...(story.acceptance_criteria ?? [])]
    .filter(Boolean)
    .join(' ');
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; matched: string[] } {
  const matched: string[] = [];
  for (const t of a) if (b.has(t)) matched.push(t);
  const unionSize = a.size + b.size - matched.length;
  return { score: unionSize === 0 ? 0 : matched.length / unionSize, matched };
}

/**
 * Compare every story pair across different features (same-feature pairs are ignored —
 * this is about cross-feature scope bleed, not intra-feature duplicates) and return
 * candidates whose token overlap clears OVERLAP_THRESHOLD, highest score first.
 */
export function detectBacklogOverlaps(features: FeatureLike[]): OverlapCandidate[] {
  const entries = features.flatMap((f, i) => {
    const featureKey = f.key || `F${i + 1}`;
    return (f.stories ?? []).map(story => ({
      featureKey,
      story,
      tokens: tokenize(storyText(story), EXTRA_STOPWORDS),
    }));
  });

  const candidates: OverlapCandidate[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.featureKey === b.featureKey) continue;
      if (a.tokens.size === 0 || b.tokens.size === 0) continue;

      const { score, matched } = jaccard(a.tokens, b.tokens);
      if (score >= OVERLAP_THRESHOLD) {
        candidates.push({
          featureKeyA: a.featureKey,
          storyIdA: a.story.story_id ?? '',
          featureKeyB: b.featureKey,
          storyIdB: b.story.story_id ?? '',
          score,
          matchedTerms: matched.slice(0, MAX_MATCHED_TERMS),
        });
      }
    }
  }

  return candidates.sort((x, y) => y.score - x.score);
}
