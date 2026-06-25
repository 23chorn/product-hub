import type { BacklogData, BacklogFeature } from '@pap/shared';

// ── Checkpoint-review deletion (story_decomposition_F<n> artifacts only) ────────
//
// In the live checkpoint review path a backlog_F<n> artifact is always shaped around
// exactly one feature being refined — either `data.feature` (Tier 2) or `data.features[0]`
// (the Tier-3-shaped single-feature preview). The merged multi-feature 'backlog' artifact
// type never reaches these functions (it renders through BacklogStoriesTests instead,
// which has no single artifact id to save a deletion back to).

function getPreviewFeature(data: BacklogData): BacklogFeature | undefined {
  return data.features?.[0] ?? data.feature;
}

/** Remove one story from the previewed feature. Returns new BacklogData; no-op if there's no previewed feature. */
export function removeStoryFromBacklog(data: BacklogData, storyIndex: number): BacklogData {
  const feature = getPreviewFeature(data);
  if (!feature) return data;
  const stories = feature.stories.filter((_, si) => si !== storyIndex);
  if (data.features) return { ...data, features: [{ ...feature, stories }, ...data.features.slice(1)] };
  return { ...data, feature: { ...feature, stories } };
}

/** Remove one embedded test case from a story within the previewed feature. */
export function removeTestCaseFromStory(data: BacklogData, storyIndex: number, testCaseIndex: number): BacklogData {
  const feature = getPreviewFeature(data);
  const story = feature?.stories[storyIndex];
  if (!feature || !story?.test_cases) return data;
  const test_cases = story.test_cases.filter((_, ti) => ti !== testCaseIndex);
  const stories = feature.stories.map((s, si) => (si === storyIndex ? { ...s, test_cases } : s));
  if (data.features) return { ...data, features: [{ ...feature, stories }, ...data.features.slice(1)] };
  return { ...data, feature: { ...feature, stories } };
}
