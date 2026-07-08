// ── Backlog JSON types ──────────────────────────────────────────────────────
// Shared between the backend (dev/QA ticket export route, completed-initiatives
// detail) and the frontend (artifact viewer, Progress Tracker detail page) so both
// runtimes parse and interpret the same backlog artifact JSON one way.

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
  prd_ref?: { functional_requirements?: string[]; non_functional_requirements?: string[] };
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
  // Feature-level conditions of done (distinct from each story's own acceptance criteria) —
  // the synthesis schema emits this, but it went unparsed until the merged Stories overview
  // needed it for parity with the epic/feature planning preview.
  acceptance_criteria?: string[];
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

// ── Platform breakdown (Progress Tracker detail page, dev/QA ticket export) ────

export type TicketPlatform = 'backend' | 'web' | 'ios' | 'android';

/** Every recognised stream value — single source of truth for validating a caller-supplied
 *  platform/stream filter (e.g. the dev/QA ticket export route's `stream` query param). */
export const TICKET_PLATFORMS: TicketPlatform[] = ['backend', 'web', 'ios', 'android'];

export const PLATFORM_LABELS: Record<TicketPlatform, string> = {
  backend: 'Backend',
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
};

function isPresentNote(v: string | null | undefined): boolean {
  return !!v && v !== 'null' && v.trim() !== '' && v.trim().toLowerCase() !== 'n/a';
}

/** Every platform a story touches — prefers the new multi-agent `platform` field, falling
 *  back to legacy `technical_notes` presence for older stories. `technical_notes` predates
 *  the web stream, so it can only ever yield backend/ios/android. */
export function getStoryPlatforms(story: BacklogStory): TicketPlatform[] {
  if (story.platform) {
    const values = (Array.isArray(story.platform) ? story.platform : [story.platform]).map(v => String(v).toLowerCase());
    return TICKET_PLATFORMS.filter(p => values.includes(p));
  }
  const notes = story.technical_notes;
  if (!notes) return [];
  const platforms: TicketPlatform[] = [];
  if (isPresentNote(notes.backend)) platforms.push('backend');
  if (isPresentNote(notes.ios)) platforms.push('ios');
  if (isPresentNote(notes.android)) platforms.push('android');
  return platforms;
}

export type TicketPlatformBreakdown = { total: number } & Record<TicketPlatform, number>;

/** Count tickets (stories) by platform — a story touching multiple platforms counts toward
 *  each one, mirroring how the ADO push stamps multiple team tags onto a single ticket
 *  (see deriveTeamTags in azure-devops-format.ts). */
export function countTicketsByPlatform(stories: BacklogStory[]): TicketPlatformBreakdown {
  const breakdown: TicketPlatformBreakdown = { total: stories.length, backend: 0, web: 0, ios: 0, android: 0 };
  for (const story of stories) {
    for (const platform of getStoryPlatforms(story)) breakdown[platform]++;
  }
  return breakdown;
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

// ── Initiative-level context aggregation ────────────────────────────────────

/** Parse research brief JSON (analyst stage output) to extract initiative context. */
export function tryParseResearchBrief(content: string): Record<string, any> | null {
  const stripped = content
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  const jsonStart = stripped.indexOf('{');
  if (jsonStart > 0) {
    try {
      return JSON.parse(stripped.slice(jsonStart));
    } catch {}
  }

  return null;
}

/** Parse PRD JSON to extract key initiative-level fields. */
export function tryParsePRD(content: string): Record<string, any> | null {
  const stripped = content
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  const jsonStart = stripped.indexOf('{');
  if (jsonStart > 0) {
    try {
      return JSON.parse(stripped.slice(jsonStart));
    } catch {}
  }

  return null;
}

/** Parse architecture JSON to extract tech stack and key decisions. */
export function tryParseArchitecture(content: string): Record<string, any> | null {
  const stripped = content
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  const jsonStart = stripped.indexOf('{');
  if (jsonStart > 0) {
    try {
      return JSON.parse(stripped.slice(jsonStart));
    } catch {}
  }

  return null;
}
