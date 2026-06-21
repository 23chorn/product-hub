// ── Backlog JSON types ──────────────────────────────────────────────────────

export interface BacklogStory {
  // Old format (story decomposition)
  title: string;
  persona?: string;
  goal?: string;
  benefit?: string;
  acceptanceCriteria?: string[];
  agentContext?: string;
  effort?: number;
  estimatedHours?: number;
  traditionalHours?: number;
  aiEstimatedHours?: number;
  technical_notes?: { ios?: string | null; android?: string | null; backend?: string | null };

  // New format (multi-agent refinement)
  story_id?: string;
  as_a?: string;
  i_want?: string;
  so_that?: string;
  acceptance_criteria?: string[];
  technical_acceptance_criteria?: string[];
  platform?: string | string[]; // Can be a single string or array
  estimated_points?: number;
  depends_on?: string[];
  test_cases?: Array<{
    id: string;
    scenario: { given: string[]; when: string[]; then: string[] };
    type: 'happy_path' | 'bad_path' | 'edge_case';
    priority: 'critical' | 'high' | 'medium' | 'low';
    prd_ref?: string;
    story_ref?: string;
  }>;
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
  aiAssisted?: boolean;
  totalTraditionalHours?: number;
  totalAiHours?: number;
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
  const { totalEffort, totalHours, sprintsRequired, effectiveVelocity, aiAssisted, totalTraditionalHours, totalAiHours } = source as BacklogSprintMeta;
  if (totalEffort == null) return null;
  return { totalEffort, totalHours, sprintsRequired, effectiveVelocity, aiAssisted, totalTraditionalHours, totalAiHours };
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
  const stripped = content
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  const tryParse = (text: string): BacklogData | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed.epic || parsed.features || parsed.feature || parsed.story) {
        return parsed as BacklogData;
      }
    } catch {}
    return null;
  };

  // Direct parse first
  const direct = tryParse(stripped);
  if (direct) return direct;

  // If LLM prefixed a preamble before the JSON, extract from first '{'
  const jsonStart = stripped.indexOf('{');
  if (jsonStart > 0) return tryParse(stripped.slice(jsonStart));

  return null;
}

// Per-feature isolated backlog artifacts are saved as backlog_F1, backlog_F2, ... (see
// saveLocalArtifact in artifact-helpers.ts) — the merged final backlog is plain 'backlog'.
export function isBacklogArtifactType(artifactType: string): boolean {
  return artifactType === 'backlog' || /^backlog_F\d+$/.test(artifactType);
}
