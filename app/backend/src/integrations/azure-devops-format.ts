/**
 * azure-devops-format — pure formatting/serialization helpers for the Azure DevOps
 * client. These take plain data and return HTML/XML/tag strings used in ADO rich-text
 * fields and Test Plan step definitions. No network or client state, so they're
 * unit-testable in isolation. Consumed by integrations/azure-devops.ts.
 */

import type { WorkItemStateBucket } from '@pap/shared';
import Logger from '../utils/logger';

const logger = new Logger('ADO-FORMAT');

/** Extract the most useful message from a failed Azure DevOps API call. */
export function adoErrorMessage(error: any): string {
  return error?.response?.data?.message || error?.message || 'Unknown error';
}

/** Full Fibonacci scale used for general-purpose rounding (1–144). */
const FIBONACCI_SCALE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

/**
 * Fibonacci scale for the "AI Estimate Dev" relative complexity score pushed to
 * ADO's Custom.AIEstimateDev field. Capped at 8 — anything larger should be split
 * into smaller stories rather than carrying a bigger complexity number.
 */
export const DEV_COMPLEXITY_FIBONACCI = [1, 2, 3, 5, 8];

/** Round a number to the nearest value in a Fibonacci sequence (defaults to the full 1–144 scale). */
export function toNearestFibonacci(n: number, fibs: number[] = FIBONACCI_SCALE): number {
  if (n <= 0) return 1;
  return fibs.reduce((prev, curr) => (Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev));
}

/**
 * Derive the "AI Estimate Dev" value pushed to ADO's Custom.AIEstimateDev field from a
 * story's effort/story-point estimate. Effort is already estimated on roughly this scale
 * (see the story-decomposition prompt), so this just rounds/caps it to the 1–8 scale rather
 * than deriving from a separate hours estimate.
 */
export function deriveAiEstimateDev(effort: number | undefined | null): number | undefined {
  return effort !== undefined && effort !== null ? toNearestFibonacci(effort, DEV_COMPLEXITY_FIBONACCI) : undefined;
}

/** Sum a list of stories' point estimates, handling both the live (`estimated_points`) and legacy (`storyPoints`) field names. */
export function sumStoryPoints(stories: Array<{ estimated_points?: number; storyPoints?: number }>): number {
  return stories.reduce((total, s) => total + (s.estimated_points ?? s.storyPoints ?? 0), 0);
}

/** A single story's point estimate — the current schema's `estimated_points`, falling back to
 *  the legacy `effort` field name used by the older single-feature Quick Ticket flow. Single
 *  source of truth so the ADO push client doesn't keep its own copy of this fallback. */
export function resolveStoryEffort(story: { estimated_points?: number; effort?: number }): number | undefined {
  return story.estimated_points ?? story.effort;
}

/**
 * Build the "Estimated Effort" HTML block for a feature or epic description — a rough
 * scope signal (total story points, story count) so competing initiatives/features can be
 * compared for size without opening the backlog. Returns '' when there's nothing to show yet
 * (e.g. epic_feature_planner has just run and no stories exist).
 */
export function buildEffortRollupHtml(totalPoints: number, storyCount: number, featureCount?: number): string {
  if (storyCount === 0) return '';
  const scope = featureCount !== undefined
    ? `${totalPoints} point${totalPoints === 1 ? '' : 's'} across ${storyCount} stor${storyCount === 1 ? 'y' : 'ies'}, ${featureCount} feature${featureCount === 1 ? '' : 's'}`
    : `${totalPoints} point${totalPoints === 1 ? '' : 's'} across ${storyCount} stor${storyCount === 1 ? 'y' : 'ies'}`;
  return `<h4>Estimated Effort</h4><p>${scope}</p>`;
}

/** Strip leading user-story prefixes that the model may have included in the JSON fields. */
export function stripStoryPrefix(text: string, prefix: RegExp): string {
  return text.replace(prefix, '').trim();
}

/** Escape special HTML characters to prevent injection in ADO rich-text fields */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a Given/When/Then acceptance criterion string into HTML with
 * each keyword on a new line and bolded.
 * Input:  "Given X When Y Then Z"
 * Output: "<b>Given</b> X<br><b>When</b> Y<br><b>Then</b> Z"
 */
export function formatGivenWhenThen(text: string): string {
  // Split on Given/When/Then/And keywords (case-insensitive, word boundary)
  // while preserving the keyword itself
  return text
    .replace(/\b(Given|When|Then|And|But)\b/gi, '\n$1')
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => line.trim().replace(/^(Given|When|Then|And|But)\b/i, '<b>$1</b>'))
    .join('<br>');
}

/**
 * Format the `technical` block from a backlog story into an HTML section.
 * Framed as suggestions because the architect's output is AI-generated and
 * must be validated by the engineering team before implementation.
 * Returns an empty string when no meaningful technical data is present.
 */
export function buildTechnicalSuggestions(technical: { constraints?: string[]; affectedComponents?: string[]; dataChanges?: string | null; apiChanges?: string | null } | undefined): string {
  if (!technical) return '';

  const parts: string[] = [];

  const components = (technical.affectedComponents ?? []).filter(Boolean);
  if (components.length) {
    parts.push(`<b>Affected Components:</b> ${escapeHtml(components.join(', '))}`);
  }

  const constraints = (technical.constraints ?? []).filter(Boolean);
  if (constraints.length) {
    parts.push(`<b>Constraints:</b><ul>${constraints.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`);
  }

  if (technical.dataChanges && technical.dataChanges !== 'null') {
    parts.push(`<b>Data Changes:</b> ${escapeHtml(technical.dataChanges)}`);
  }

  if (technical.apiChanges && technical.apiChanges !== 'null') {
    parts.push(`<b>API Changes:</b> ${escapeHtml(technical.apiChanges)}`);
  }

  if (!parts.length) return '';

  return [
    '<hr>',
    '<b>Technical Suggestions</b> <i>(AI-generated · pending engineering review)</i><br>',
    parts.join('<br>'),
  ].join('');
}

/**
 * Format per-platform technical notes from the multi-agent story refinement into an HTML section.
 * technical_notes: { ios, android, backend } — each is a free-text string.
 * Returns an empty string when no meaningful notes are present.
 */
export function buildPlatformNotes(notes: { ios?: string | null; android?: string | null; backend?: string | null; web?: string | null } | undefined): string {
  if (!notes) return '';

  const platforms = [
    { label: 'Backend', value: notes.backend },
    { label: 'Web', value: notes.web },
    { label: 'iOS', value: notes.ios },
    { label: 'Android', value: notes.android },
  ].filter(p => p.value && p.value !== 'null' && p.value.trim() !== '' && p.value.trim().toLowerCase() !== 'n/a');

  if (!platforms.length) return '';

  return [
    '<hr>',
    '<b>Technical Notes</b> <i>(AI-generated · pending engineering review)</i><br>',
    platforms.map(p => `<b>${p.label}:</b> ${escapeHtml(p.value!)}`).join('<br>'),
  ].join('');
}

/** Story fields consumed by the description / acceptance-criteria HTML builders below. */
export interface StoryHtmlInput {
  persona: string;
  goal: string;
  benefit: string;
  technical?: Parameters<typeof buildTechnicalSuggestions>[0];
  technical_notes?: Parameters<typeof buildPlatformNotes>[0];
}

/**
 * Build the "As a / I want / So that" story description HTML pushed to ADO,
 * including the technical-suggestions and platform-notes sections when present.
 * Leading prefixes the model may have duplicated into the fields ("As a...",
 * "I want to...") are stripped so the bold labels don't render twice.
 */
export function buildStoryDescriptionHtml(story: StoryHtmlInput): string {
  return [
    `<b>As a</b> ${escapeHtml(stripStoryPrefix(story.persona, /^as an?\s+/i))}`,
    `<b>I want</b> ${escapeHtml(stripStoryPrefix(story.goal, /^i want\s+(to\s+)?/i))}`,
    `<b>So that</b> ${escapeHtml(stripStoryPrefix(story.benefit, /^so that\s+/i))}`,
  ].join('<br>') + buildTechnicalSuggestions(story.technical) + buildPlatformNotes(story.technical_notes);
}

/**
 * Build the numbered "AC n" acceptance-criteria HTML block for ADO's
 * AcceptanceCriteria field, followed by an optional bulleted "Technical
 * Acceptance Criteria" section. Returns undefined when there's nothing to
 * show so callers can pass the result straight through to createWorkItem/updateWorkItem.
 */
export function buildAcceptanceCriteriaHtml(
  acceptanceCriteria: string[] | undefined,
  technicalAcceptanceCriteria?: string[],
): string | undefined {
  const productHtml = (acceptanceCriteria ?? [])
    .map((ac, i) => `<b>AC ${i + 1}</b><br>${formatGivenWhenThen(escapeHtml(ac))}`)
    .join('<br><br>');

  const technical = (technicalAcceptanceCriteria ?? []).filter(Boolean);
  const technicalHtml = technical.length > 0
    ? `<hr><b>Technical Acceptance Criteria:</b><ul>${technical.map(tac => `<li>${escapeHtml(tac)}</li>`).join('')}</ul>`
    : '';

  if (!productHtml && !technicalHtml) return undefined;
  return productHtml + technicalHtml;
}

/**
 * Derive team tags from per-platform technical_notes.
 * A platform is tagged when its notes field is present and non-trivial.
 * Future streams (web) can be added here once the story refinement agents support them.
 * Returns a semicolon-separated ADO tag string, or undefined when no tags apply.
 */
export function deriveTeamTags(notes: { ios?: string | null; android?: string | null; backend?: string | null; web?: string | null } | undefined): string | undefined {
  if (!notes) return undefined;

  const isPresent = (v: string | null | undefined) =>
    !!v && v !== 'null' && v.trim() !== '' && v.trim().toLowerCase() !== 'n/a';

  const tags: string[] = [];
  if (isPresent(notes.backend)) tags.push('Backend');
  if (isPresent(notes.web))     tags.push('Web');
  if (isPresent(notes.ios))     tags.push('iOS');
  if (isPresent(notes.android)) tags.push('Android');

  return tags.length ? tags.join('; ') : undefined;
}

/**
 * Derive the ado_work_item_map local_key for a phase's Epic work item from its phase label.
 * MVP (or an unset/blank phase) is always the main 'epic'; every later phase (e.g. "Phase 2")
 * gets its own slugged key so createBacklog/updateBacklog and pushTestPlanToAdo all agree on
 * which Epic — and therefore which Test Plan — a phase's features/test cases belong to.
 */
export function deriveEpicLocalKey(phase: string | null | undefined): string {
  const normalized = (phase ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'mvp') return 'epic';
  return `epic-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** Canonical display labels for the single-platform `platform` field on story-decomposition stories. */
const PLATFORM_STREAM_LABELS: Record<string, string> = { backend: 'Backend', web: 'Web', ios: 'iOS', android: 'Android' };

/**
 * Stamp a story's platform stream tag (e.g. "[Backend]") onto its title. The
 * story-decomposition prompt asks the model to append this itself, but compliance
 * is inconsistent, so it's stamped here from the validated `platform` field instead
 * — every ADO ticket then reliably shows which stream it belongs to.
 */
export function ensureStreamPrefix(title: string, platform: string | string[] | undefined): string {
  const platformStr = Array.isArray(platform) ? platform[0] : platform;
  const label = platformStr ? PLATFORM_STREAM_LABELS[platformStr.toLowerCase()] : undefined;
  if (!label) return title;
  if (new RegExp(`\\[${label}\\]`, 'i').test(title)) return title;
  return `${title} [${label}]`;
}

// ── Test Plans constants ──────────────────────────────────────────────────────

export const SUITE_TYPE_LABELS: Record<string, string> = {
  happy_path: 'Happy Path',
  bad_path: 'Bad Path',
  edge_case: 'Edge Case',
  functional: 'Functional',
  performance: 'Performance',
  compliance: 'Compliance',
};

export const TC_PRIORITY_MAP: Record<string, number> = {
  critical: 1, high: 2, medium: 3, low: 4,
};

export interface TestCaseInput {
  id?: string;
  title: string;
  type?: string;
  priority?: string;
  story_ref?: string | string[] | null;
  linkedStory?: string | string[] | null;
  tags?: string[];
  scenario?: { given: string[]; when?: string[]; then: string[] };
  steps?: string[];
  expectedResult?: string;
  preconditions?: string[];
  description?: string;
}

/**
 * Resolve a test case's story_ref to every local story key it references.
 * Most refs are a single local_key (e.g. "F1.S3"), but QA agents sometimes write a
 * platform-split ref like "F1.S9 (iOS utility) / F1.S10 (Android utility)" — or hand
 * back a genuine array, e.g. ["iOS-CIRCUIT-1", "ANDROID-CIRCUIT-1"] — when one test
 * case covers both platforms' stories. Extract every F#.S# token from each ref instead
 * of only ever matching the first, and fall back to the raw ref (trimmed) per element
 * so exact-title/ad-hoc matches (fixtures or QA-agent refs that aren't local_keys)
 * still work.
 */
export function parseStoryRefs(storyRef: string | string[]): string[] {
  const refs = Array.isArray(storyRef) ? storyRef : [storyRef];
  return refs.flatMap(ref => ref.match(/F\d+\.S\d+/g) ?? [ref.trim()]);
}

/**
 * Resolve which Epic (phase) Test Plan a single test case belongs to, via its story_ref's
 * owning feature. Falls back to the main epic ('epic') when story_ref is missing/unresolvable,
 * or when the referenced stories span more than one epic (rare — phases are a broader grouping
 * than features) — the first resolved epic wins in that case. Either fallback returns a
 * `warning` string the caller should surface, so a coverage gap or a cross-phase case is never
 * silently dropped.
 */
export function resolveEpicLocalKeyForTestCase(
  tc: { id?: string; story_ref?: string | string[] | null; linkedStory?: string | string[] | null },
  featureKeyToEpicLocalKey: Map<string, string>,
): { epicLocalKey: string; warning?: string } {
  const ref = tc.story_ref ?? tc.linkedStory;
  const label = tc.id ?? '(no id)';
  if (!ref) {
    return { epicLocalKey: 'epic', warning: `test case ${label} has no story_ref — defaulting to the main epic's Test Plan` };
  }

  const storyKeys = parseStoryRefs(ref);
  const epicLocalKeys = [...new Set(
    storyKeys.map(key => featureKeyToEpicLocalKey.get(key.split('.')[0])).filter((k): k is string => !!k)
  )];

  if (epicLocalKeys.length === 0) {
    return { epicLocalKey: 'epic', warning: `test case ${label} references unresolvable stor(y/ies) "${storyKeys.join(', ')}" — defaulting to the main epic's Test Plan` };
  }
  if (epicLocalKeys.length > 1) {
    return { epicLocalKey: epicLocalKeys[0], warning: `test case ${label} spans multiple epics (${epicLocalKeys.join(', ')}) — assigned to ${epicLocalKeys[0]}` };
  }
  return { epicLocalKey: epicLocalKeys[0] };
}

/** Group test cases by resolved epicLocalKey (see resolveEpicLocalKeyForTestCase), collecting
 *  every warning raised along the way so the caller can log them without re-deriving them. */
export function groupTestCasesByEpic<T extends { id?: string; story_ref?: string | string[] | null; linkedStory?: string | string[] | null }>(
  testCases: T[],
  featureKeyToEpicLocalKey: Map<string, string>,
): { groups: Map<string, T[]>; warnings: string[] } {
  const groups = new Map<string, T[]>();
  const warnings: string[] = [];
  for (const tc of testCases) {
    const { epicLocalKey, warning } = resolveEpicLocalKeyForTestCase(tc, featureKeyToEpicLocalKey);
    if (warning) warnings.push(warning);
    if (!groups.has(epicLocalKey)) groups.set(epicLocalKey, []);
    groups.get(epicLocalKey)!.push(tc);
  }
  return { groups, warnings };
}

/**
 * Build a human-readable test case description summarizing what is being tested.
 * Includes test type, linked story, preconditions, and scenario/expected result.
 */
export function buildTestCaseDescription(tc: TestCaseInput): string {
  const parts: string[] = [];

  // Use explicit description if provided
  if (tc.description) {
    parts.push(escapeHtml(tc.description));
  }

  // Test type and linked story
  const metadata: string[] = [];
  if (tc.type) {
    const typeLabel = SUITE_TYPE_LABELS[tc.type] ?? tc.type;
    metadata.push(`<b>Type:</b> ${escapeHtml(typeLabel)}`);
  }
  if (tc.story_ref || tc.linkedStory) {
    const refDisplay = parseStoryRefs(tc.story_ref ?? tc.linkedStory!).join(', ');
    metadata.push(`<b>Linked Story:</b> ${escapeHtml(refDisplay)}`);
  }
  if (metadata.length) {
    parts.push(metadata.join(' | '));
  }

  // Preconditions
  if (tc.preconditions && tc.preconditions.length > 0) {
    parts.push('<b>Preconditions:</b>');
    parts.push('<ul>' + tc.preconditions.map(p => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>');
  }

  // Scenario summary (Gherkin)
  if (tc.scenario) {
    parts.push('<b>Scenario:</b>');
    const scenarioParts: string[] = [];
    if (tc.scenario.given && tc.scenario.given.length > 0) {
      scenarioParts.push(`<b>Given</b> ${escapeHtml(tc.scenario.given.join(', '))}`);
    }
    if (tc.scenario.when && tc.scenario.when.length > 0) {
      scenarioParts.push(`<b>When</b> ${escapeHtml(tc.scenario.when.join(', '))}`);
    }
    if (tc.scenario.then && tc.scenario.then.length > 0) {
      scenarioParts.push(`<b>Then</b> ${escapeHtml(tc.scenario.then.join(', '))}`);
    }
    parts.push(scenarioParts.join('<br>'));
  }

  // Expected result (procedural tests)
  if (tc.expectedResult && !tc.scenario) {
    parts.push(`<b>Expected Result:</b> ${escapeHtml(tc.expectedResult)}`);
  }

  return parts.length > 0 ? parts.join('<br><br>') : '';
}

/**
 * Convert a TestCase's Gherkin scenario or procedural steps into ADO step XML.
 * Gherkin: Given/When → ActionStep; Then → ValidateStep (last Then = expected result).
 * Procedural: each step → ActionStep + final ValidateStep for expectedResult.
 */
export function buildTestStepsXml(tc: TestCaseInput): string {
  type StepEntry = { type: 'ActionStep' | 'ValidateStep'; action: string; expected: string };
  const stepItems: StepEntry[] = [];

  if (tc.scenario) {
    const given = tc.scenario.given ?? [];
    const when = tc.scenario.when ?? [];
    const then = tc.scenario.then ?? [];
    for (const s of given) stepItems.push({ type: 'ActionStep', action: s, expected: '' });
    for (const s of when)  stepItems.push({ type: 'ActionStep', action: s, expected: '' });
    // Every Then is itself an expected outcome, not just the last one — put each in
    // both columns so the Expected Result column is populated for every assertion.
    for (const s of then) stepItems.push({ type: 'ValidateStep', action: s, expected: s });
  } else if (tc.steps && tc.steps.length > 0) {
    // Attach the overall expected result to the last real step rather than appending
    // a synthetic extra step whose Action column would just repeat the Expected Result text.
    const expected = tc.expectedResult ?? 'Verify expected behaviour';
    tc.steps.forEach((s, i) => {
      const isLast = i === tc.steps!.length - 1;
      stepItems.push(isLast ? { type: 'ValidateStep', action: s, expected } : { type: 'ActionStep', action: s, expected: '' });
    });
  } else {
    const expected = tc.expectedResult ?? 'Verify expected behaviour';
    // `action` is escaped by the step renderer below — don't pre-escape here or the title double-escapes.
    stepItems.push({ type: 'ActionStep', action: `Execute: ${tc.title}`, expected: '' });
    stepItems.push({ type: 'ValidateStep', action: expected, expected });
  }

  const stepXml = stepItems.map((step, i) => {
    const n = i + 1;
    return `<step id="${n}" type="${step.type}"><parameterizedString isformatted="true">${escapeHtml(step.action)}</parameterizedString><parameterizedString isformatted="true">${escapeHtml(step.expected)}</parameterizedString><description/></step>`;
  }).join('');

  return `<steps id="0" last="${stepItems.length}">${stepXml}</steps>`;
}

// ── Work item state bucketing (Completed Initiatives page) ───────────────────

const DEFAULT_STATE_BUCKETS: Record<string, WorkItemStateBucket> = {
  // xCube workflow
  'New': 'not_started', 'Ready for Dev': 'not_started',
  'In Dev': 'in_progress', 'Ready for QA': 'in_progress', 'In Testing': 'in_progress',
  'Done': 'done',
  'Removed': 'removed',
};

/** ADO `System.State` → bucket map. Overridable via `AZURE_DEVOPS_STATE_BUCKETS_JSON`. */
export function getStateBucketMap(): Record<string, WorkItemStateBucket> {
  const raw = process.env.AZURE_DEVOPS_STATE_BUCKETS_JSON;
  if (!raw) return DEFAULT_STATE_BUCKETS;
  try {
    return JSON.parse(raw);
  } catch {
    logger.warn('Invalid AZURE_DEVOPS_STATE_BUCKETS_JSON — falling back to the default Agile state-bucket map');
    return DEFAULT_STATE_BUCKETS;
  }
}

/** Bucket a raw ADO work item state. Unmapped states default to 'in_progress' rather than silently "done". */
export function bucketWorkItemState(state: string): WorkItemStateBucket {
  return getStateBucketMap()[state] ?? 'in_progress';
}

const DEFAULT_STATE_PERCENTS: Record<string, number> = {
  // xCube workflow: New → Ready for Dev → In Dev → Ready for QA → In Testing → Done
  'New': 0, 'Ready for Dev': 10,
  'In Dev': 33, 'Ready for QA': 60, 'In Testing': 80,
  'Done': 100,
  'Removed': 100,
};

/** ADO `System.State` → percent-complete map. Overridable via `AZURE_DEVOPS_STATE_PERCENT_JSON`
 *  so a team's actual workflow states (e.g. "In Development" = 33%) can be supplied without a
 *  code change. */
export function getStatePercentMap(): Record<string, number> {
  const raw = process.env.AZURE_DEVOPS_STATE_PERCENT_JSON;
  if (!raw) return DEFAULT_STATE_PERCENTS;
  try {
    return JSON.parse(raw);
  } catch {
    logger.warn('Invalid AZURE_DEVOPS_STATE_PERCENT_JSON — falling back to the default state-percent map');
    return DEFAULT_STATE_PERCENTS;
  }
}

/** Percent complete for a raw ADO work item state. Unmapped states fall back to their bucket's
 *  midpoint (0 / 50 / 100) rather than silently reading as 0% complete. */
export function workItemStatePercent(state: string): number {
  const map = getStatePercentMap();
  if (state in map) return map[state];
  const bucket = bucketWorkItemState(state);
  return bucket === 'not_started' ? 0 : bucket === 'in_progress' ? 50 : 100;
}
