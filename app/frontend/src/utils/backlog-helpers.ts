// ── Backlog JSON types ──────────────────────────────────────────────────────

export interface BacklogStory {
  title: string;
  persona?: string;
  goal?: string;
  benefit?: string;
  acceptanceCriteria?: string[];
  agentContext?: string;
  effort?: number;
  estimatedHours?: number;
}

export interface BacklogFeature {
  title: string;
  description?: string;
  phase?: string;
  stories: BacklogStory[];
}

export interface BacklogSprintMeta {
  totalEffort?: number;
  totalHours?: number;
  sprintsRequired?: number;
  effectiveVelocity?: number;
}

export interface BacklogData {
  // Tier 3: epic with features
  epic?: {
    title: string;
    description?: string;
    businessValue?: string;
    prdLink?: string;
    stories?: BacklogStory[];
  } & BacklogSprintMeta;
  features?: BacklogFeature[];
  // Tier 2: single feature
  feature?: BacklogFeature & BacklogSprintMeta;
  // Tier 1: single story
  story?: BacklogStory & BacklogSprintMeta;
}

// ── Utility functions ───────────────────────────────────────────────────────

/** Determine which backlog tier this data represents. */
export function backlogTier(data: BacklogData): 1 | 2 | 3 {
  if (data.features && data.features.length > 0) return 3;
  if (data.feature) return 2;
  return 1;
}

/** Extract sprint metadata from whichever tier is present. */
export function getSprintMeta(data: BacklogData): BacklogSprintMeta | null {
  const source = data.epic ?? data.feature ?? data.story;
  if (!source) return null;
  const { totalEffort, totalHours, sprintsRequired, effectiveVelocity } = source as BacklogSprintMeta;
  if (totalEffort == null) return null;
  return { totalEffort, totalHours, sprintsRequired, effectiveVelocity };
}

/** Collect all stories regardless of tier. */
export function getAllStories(data: BacklogData): BacklogStory[] {
  if (data.features) return data.features.flatMap(f => f.stories ?? []);
  if (data.feature) return data.feature.stories ?? [];
  if (data.epic?.stories) return data.epic.stories;
  if (data.story) return [data.story];
  return [];
}

/** Collect all features (Tier 3 only). */
export function getAllFeatures(data: BacklogData): BacklogFeature[] {
  return data.features ?? [];
}

/** Try to parse artifact content as backlog JSON. */
export function tryParseBacklog(content: string): BacklogData | null {
  try {
    // Strip markdown code fences if present
    const stripped = content
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim();
    const parsed = JSON.parse(stripped);
    // Must have at least one of the expected top-level keys
    if (parsed.epic || parsed.features || parsed.feature || parsed.story) {
      return parsed as BacklogData;
    }
    return null;
  } catch {
    return null;
  }
}
