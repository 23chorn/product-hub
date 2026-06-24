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

/** Round a number to the nearest value in the Fibonacci sequence (1–144). */
export function toNearestFibonacci(n: number): number {
  const fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  if (n <= 0) return 1;
  return fibs.reduce((prev, curr) => (Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev));
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
 * Format per-platform technical notes from tech_refinement into an HTML section.
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

/**
 * Derive team tags from per-platform technical_notes.
 * A platform is tagged when its notes field is present and non-trivial.
 * Future streams (web) can be added here once the tech_refinement agent supports them.
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
    for (let i = 0; i < then.length; i++) {
      stepItems.push({
        type: 'ValidateStep',
        action: then[i],
        expected: i === then.length - 1 ? then[i] : '',
      });
    }
  } else if (tc.steps && tc.steps.length > 0) {
    for (const s of tc.steps) stepItems.push({ type: 'ActionStep', action: s, expected: '' });
    const expected = tc.expectedResult ?? 'Verify expected behaviour';
    stepItems.push({ type: 'ValidateStep', action: expected, expected });
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
  'New': 'not_started', 'To Do': 'not_started', 'Approved': 'not_started',
  'Active': 'in_progress', 'Committed': 'in_progress', 'In Progress': 'in_progress', 'Resolved': 'in_progress',
  'Closed': 'done', 'Done': 'done',
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
