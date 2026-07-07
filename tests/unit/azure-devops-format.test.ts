import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  adoErrorMessage,
  toNearestFibonacci,
  stripStoryPrefix,
  escapeHtml,
  formatGivenWhenThen,
  buildTechnicalSuggestions,
  buildPlatformNotes,
  buildStoryDescriptionHtml,
  buildAcceptanceCriteriaHtml,
  deriveTeamTags,
  buildTestCaseDescription,
  buildTestStepsXml,
  parseStoryRefs,
  SUITE_TYPE_LABELS,
  TC_PRIORITY_MAP,
  getStateBucketMap,
  bucketWorkItemState,
  deriveEpicLocalKey,
  resolveEpicLocalKeyForTestCase,
  groupTestCasesByEpic,
} from '../../app/backend/src/integrations/azure-devops-format';

describe('adoErrorMessage', () => {
  it('prefers the ADO response message', () => {
    expect(adoErrorMessage({ response: { data: { message: 'boom' } }, message: 'other' })).toBe('boom');
  });
  it('falls back to error.message', () => {
    expect(adoErrorMessage({ message: 'network down' })).toBe('network down');
  });
  it('falls back to a default for empty errors', () => {
    expect(adoErrorMessage({})).toBe('Unknown error');
    expect(adoErrorMessage(null)).toBe('Unknown error');
  });
});

describe('toNearestFibonacci', () => {
  it('snaps to the nearest allowed point', () => {
    expect(toNearestFibonacci(4)).toBe(3); // 3 and 5 are equidistant — reduce keeps the first (3)
    expect(toNearestFibonacci(6)).toBe(5);
    expect(toNearestFibonacci(7)).toBe(8);
    expect(toNearestFibonacci(100)).toBe(89);
  });
  it('clamps non-positive input to 1', () => {
    expect(toNearestFibonacci(0)).toBe(1);
    expect(toNearestFibonacci(-5)).toBe(1);
  });
  it('returns exact Fibonacci values unchanged', () => {
    for (const n of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]) {
      expect(toNearestFibonacci(n)).toBe(n);
    }
  });
});

describe('stripStoryPrefix', () => {
  it('removes the matched prefix and trims', () => {
    expect(stripStoryPrefix('As a user I want X', /^As a user\s*/i)).toBe('I want X');
  });
  it('leaves unmatched text intact (trimmed)', () => {
    expect(stripStoryPrefix('  hello  ', /^Story:\s*/)).toBe('hello');
  });
});

describe('escapeHtml', () => {
  it('escapes the five sensitive characters', () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>'))
      .toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });
  it('escapes ampersands before other entities (no double-escaping)', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('formatGivenWhenThen', () => {
  it('bolds keywords and joins with <br>', () => {
    expect(formatGivenWhenThen('Given X When Y Then Z'))
      .toBe('<b>Given</b> X<br><b>When</b> Y<br><b>Then</b> Z');
  });
  it('handles And/But clauses', () => {
    expect(formatGivenWhenThen('Given A And B Then C'))
      .toBe('<b>Given</b> A<br><b>And</b> B<br><b>Then</b> C');
  });
});

describe('buildTechnicalSuggestions', () => {
  it('returns empty string when no technical data', () => {
    expect(buildTechnicalSuggestions(undefined)).toBe('');
    expect(buildTechnicalSuggestions({})).toBe('');
  });
  it('renders components, constraints, and changes, escaping content', () => {
    const html = buildTechnicalSuggestions({
      affectedComponents: ['Auth & API'],
      constraints: ['must be <fast>'],
      dataChanges: 'add column',
      apiChanges: 'null', // treated as absent
    });
    expect(html).toContain('<b>Affected Components:</b> Auth &amp; API');
    expect(html).toContain('<li>must be &lt;fast&gt;</li>');
    expect(html).toContain('<b>Data Changes:</b> add column');
    expect(html).not.toContain('API Changes');
    expect(html.startsWith('<hr>')).toBe(true);
  });
});

describe('buildPlatformNotes / deriveTeamTags', () => {
  const notes = { ios: 'use SwiftUI', android: 'n/a', backend: '  ' };

  it('includes only meaningful platforms', () => {
    const html = buildPlatformNotes(notes);
    expect(html).toContain('<b>iOS:</b> use SwiftUI');
    expect(html).not.toContain('Android');
    expect(html).not.toContain('Backend');
  });
  it('returns empty string when nothing meaningful', () => {
    expect(buildPlatformNotes({ ios: 'null', android: '', backend: undefined })).toBe('');
  });
  it('derives tags in a stable order (Backend, iOS, Android)', () => {
    expect(deriveTeamTags({ ios: 'x', android: 'y', backend: 'z' })).toBe('Backend; iOS; Android');
    expect(deriveTeamTags(notes)).toBe('iOS');
    expect(deriveTeamTags(undefined)).toBeUndefined();
    expect(deriveTeamTags({ ios: 'n/a' })).toBeUndefined();
  });
});

describe('buildStoryDescriptionHtml', () => {
  it('renders the As a / I want / So that lines with bold labels', () => {
    expect(buildStoryDescriptionHtml({ persona: 'power user', goal: 'filter results', benefit: 'I find things faster' }))
      .toBe('<b>As a</b> power user<br><b>I want</b> filter results<br><b>So that</b> I find things faster');
  });
  it('strips duplicated prefixes the model left in the fields', () => {
    const html = buildStoryDescriptionHtml({
      persona: 'As a power user',
      goal: 'I want to filter results',
      benefit: 'so that I find things faster',
    });
    expect(html).toBe('<b>As a</b> power user<br><b>I want</b> filter results<br><b>So that</b> I find things faster');
  });
  it('escapes HTML and appends technical sections when present', () => {
    const html = buildStoryDescriptionHtml({
      persona: 'user <b>',
      goal: 'x',
      benefit: 'y',
      technical: { dataChanges: 'add column' },
      technical_notes: { ios: 'use SwiftUI' },
    });
    expect(html).toContain('<b>As a</b> user &lt;b&gt;');
    expect(html).toContain('<b>Data Changes:</b> add column');
    expect(html).toContain('<b>iOS:</b> use SwiftUI');
  });
});

describe('buildAcceptanceCriteriaHtml', () => {
  it('returns undefined for missing or empty criteria', () => {
    expect(buildAcceptanceCriteriaHtml(undefined)).toBeUndefined();
    expect(buildAcceptanceCriteriaHtml([])).toBeUndefined();
  });
  it('numbers each AC and formats Given/When/Then', () => {
    const html = buildAcceptanceCriteriaHtml(['Given X When Y Then Z', 'Given A Then B'])!;
    expect(html).toContain('<b>AC 1</b><br><b>Given</b> X<br><b>When</b> Y<br><b>Then</b> Z');
    expect(html).toContain('<b>AC 2</b><br><b>Given</b> A<br><b>Then</b> B');
    expect(html.split('<br><br>').length).toBe(2);
  });
  it('appends a bulleted Technical Acceptance Criteria section when provided', () => {
    const html = buildAcceptanceCriteriaHtml(['Given X Then Y'], ['Room entity: Foo', 'Retrofit interface: Bar'])!;
    expect(html).toContain('<hr><b>Technical Acceptance Criteria:</b><ul><li>Room entity: Foo</li><li>Retrofit interface: Bar</li></ul>');
  });
  it('omits the technical section when no technical criteria are given', () => {
    const html = buildAcceptanceCriteriaHtml(['Given X Then Y'], [])!;
    expect(html).not.toContain('Technical Acceptance Criteria');
  });
  it('returns undefined when both product and technical criteria are empty', () => {
    expect(buildAcceptanceCriteriaHtml([], [])).toBeUndefined();
  });
});

describe('Test Plans constants', () => {
  it('maps suite labels and priorities', () => {
    expect(SUITE_TYPE_LABELS.happy_path).toBe('Happy Path');
    expect(TC_PRIORITY_MAP.critical).toBe(1);
    expect(TC_PRIORITY_MAP.low).toBe(4);
  });
});

describe('parseStoryRefs', () => {
  it('returns a single local_key ref as-is', () => {
    expect(parseStoryRefs('F1.S3')).toEqual(['F1.S3']);
  });
  it('extracts every local_key from a platform-split ref', () => {
    expect(parseStoryRefs('F1.S9 (iOS utility) / F1.S10 (Android utility)')).toEqual(['F1.S9', 'F1.S10']);
  });
  it('falls back to the trimmed raw ref when no local_key pattern matches (e.g. a story title)', () => {
    expect(parseStoryRefs(' Some Story Title ')).toEqual(['Some Story Title']);
  });
  it('handles a genuine array of refs, not just a slash-joined string', () => {
    expect(parseStoryRefs(['iOS-CIRCUIT-1', 'ANDROID-CIRCUIT-1'])).toEqual(['iOS-CIRCUIT-1', 'ANDROID-CIRCUIT-1']);
    expect(parseStoryRefs(['F2.S1', 'F2.S2'])).toEqual(['F2.S1', 'F2.S2']);
  });
});

describe('buildTestCaseDescription', () => {
  it('returns empty string for a bare test case', () => {
    expect(buildTestCaseDescription({ title: 'x' })).toBe('');
  });
  it('renders type, linked story, preconditions, and scenario', () => {
    const html = buildTestCaseDescription({
      title: 'Login',
      type: 'happy_path',
      story_ref: 'F1.S1',
      preconditions: ['user exists'],
      scenario: { given: ['on login'], when: ['submit'], then: ['see home'] },
    });
    expect(html).toContain('<b>Type:</b> Happy Path');
    expect(html).toContain('<b>Linked Story:</b> F1.S1');
    expect(html).toContain('<li>user exists</li>');
    expect(html).toContain('<b>Given</b> on login');
    expect(html).toContain('<b>Then</b> see home');
  });
  it('renders an array story_ref without crashing (regression: QA agents sometimes emit an array, not a string)', () => {
    const html = buildTestCaseDescription({
      title: 'Cross-platform check',
      story_ref: ['iOS-CIRCUIT-1', 'ANDROID-CIRCUIT-1'],
    });
    expect(html).toContain('<b>Linked Story:</b> iOS-CIRCUIT-1, ANDROID-CIRCUIT-1');
  });
  it('uses expectedResult only for procedural (non-scenario) cases', () => {
    expect(buildTestCaseDescription({ title: 'x', expectedResult: 'works' }))
      .toContain('<b>Expected Result:</b> works');
    expect(buildTestCaseDescription({ title: 'x', expectedResult: 'works', scenario: { given: ['a'], then: ['b'] } }))
      .not.toContain('Expected Result');
  });
});

describe('buildTestStepsXml', () => {
  it('maps Gherkin given/when to ActionStep and then to ValidateStep', () => {
    const xml = buildTestStepsXml({ title: 'x', scenario: { given: ['g'], when: ['w'], then: ['t'] } });
    expect(xml).toContain('<steps id="0" last="3">');
    expect(xml).toContain('type="ActionStep"');
    expect(xml).toContain('type="ValidateStep"');
    // exactly 3 steps
    expect((xml.match(/<step /g) || []).length).toBe(3);
  });
  it('attaches the expected result to the last procedural step rather than adding a synthetic one', () => {
    const xml = buildTestStepsXml({ title: 'x', steps: ['a', 'b'], expectedResult: 'done' });
    expect((xml.match(/<step /g) || []).length).toBe(2);
    expect(xml).toContain('<steps id="0" last="2">');
    expect(xml).toContain('type="ValidateStep"');
    // The last step's action is still "b", and "done" appears as its expected result — not duplicated as an action.
    const lastStep = xml.match(/<step id="2"[^>]*>.*?<\/step>/)![0];
    expect(lastStep).toContain('type="ValidateStep"');
    expect(lastStep).toContain('<parameterizedString isformatted="true">b</parameterizedString>');
    expect(lastStep).toContain('<parameterizedString isformatted="true">done</parameterizedString>');
  });
  it('synthesises steps when neither scenario nor steps provided', () => {
    const xml = buildTestStepsXml({ title: 'Run <it>' });
    expect((xml.match(/<step /g) || []).length).toBe(2);
    expect(xml).toContain('Execute: Run &lt;it&gt;');
  });
});

describe('getStateBucketMap / bucketWorkItemState', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('maps the default xCube workflow states to their buckets', () => {
    delete process.env.AZURE_DEVOPS_STATE_BUCKETS_JSON;
    expect(bucketWorkItemState('New')).toBe('not_started');
    expect(bucketWorkItemState('In Dev')).toBe('in_progress');
    expect(bucketWorkItemState('Done')).toBe('done');
    expect(bucketWorkItemState('Removed')).toBe('removed');
  });

  it('defaults an unrecognized state to in_progress, not done', () => {
    delete process.env.AZURE_DEVOPS_STATE_BUCKETS_JSON;
    expect(bucketWorkItemState('Some Custom State')).toBe('in_progress');
  });

  it('honors an AZURE_DEVOPS_STATE_BUCKETS_JSON override', () => {
    process.env.AZURE_DEVOPS_STATE_BUCKETS_JSON = JSON.stringify({ Backlog: 'not_started', Shipped: 'done' });
    expect(getStateBucketMap()).toEqual({ Backlog: 'not_started', Shipped: 'done' });
    expect(bucketWorkItemState('Shipped')).toBe('done');
  });

  it('falls back to the default map and logs a warning when the override JSON is malformed', () => {
    process.env.AZURE_DEVOPS_STATE_BUCKETS_JSON = '{not valid json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(bucketWorkItemState('New')).toBe('not_started');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('deriveEpicLocalKey', () => {
  it('maps MVP, and unset/blank phase, to the main epic', () => {
    expect(deriveEpicLocalKey('MVP')).toBe('epic');
    expect(deriveEpicLocalKey('mvp')).toBe('epic');
    expect(deriveEpicLocalKey(undefined)).toBe('epic');
    expect(deriveEpicLocalKey(null)).toBe('epic');
    expect(deriveEpicLocalKey('  ')).toBe('epic');
  });

  it('slugs later phases into a distinct, stable key', () => {
    expect(deriveEpicLocalKey('Phase 2')).toBe('epic-phase-2');
    expect(deriveEpicLocalKey('Phase 3')).toBe('epic-phase-3');
  });
});

describe('resolveEpicLocalKeyForTestCase / groupTestCasesByEpic', () => {
  const featureKeyToEpicLocalKey = new Map([
    ['F1', 'epic'],
    ['F2', 'epic'],
    ['F3', 'epic-phase-2'],
  ]);

  it('resolves a single-story test case to its feature\'s epic', () => {
    expect(resolveEpicLocalKeyForTestCase({ id: 'TC-UI-001', story_ref: 'F3.S1' }, featureKeyToEpicLocalKey))
      .toEqual({ epicLocalKey: 'epic-phase-2' });
  });

  it('resolves a multi-story test case within one epic without a warning', () => {
    expect(resolveEpicLocalKeyForTestCase({ id: 'TC-UI-002', story_ref: ['F1.S1', 'F2.S1'] }, featureKeyToEpicLocalKey))
      .toEqual({ epicLocalKey: 'epic' });
  });

  it('falls back to the main epic with a warning when story_ref is missing', () => {
    const result = resolveEpicLocalKeyForTestCase({ id: 'TC-API-001' }, featureKeyToEpicLocalKey);
    expect(result.epicLocalKey).toBe('epic');
    expect(result.warning).toMatch(/no story_ref/);
  });

  it('falls back to the main epic with a warning when the story is unresolvable', () => {
    const result = resolveEpicLocalKeyForTestCase({ id: 'TC-UI-003', story_ref: 'F9.S1' }, featureKeyToEpicLocalKey);
    expect(result.epicLocalKey).toBe('epic');
    expect(result.warning).toMatch(/unresolvable/);
  });

  it('assigns the first resolved epic with a warning when a case spans multiple epics', () => {
    const result = resolveEpicLocalKeyForTestCase({ id: 'TC-UI-004', story_ref: ['F1.S1', 'F3.S1'] }, featureKeyToEpicLocalKey);
    expect(result.epicLocalKey).toBe('epic');
    expect(result.warning).toMatch(/spans multiple epics/);
  });

  it('groups test cases by resolved epic and collects every warning', () => {
    const { groups, warnings } = groupTestCasesByEpic([
      { id: 'TC-UI-001', story_ref: 'F1.S1' },
      { id: 'TC-UI-002', story_ref: 'F3.S1' },
      { id: 'TC-API-001' },
    ], featureKeyToEpicLocalKey);

    expect([...groups.keys()].sort()).toEqual(['epic', 'epic-phase-2']);
    expect(groups.get('epic')!.map(tc => tc.id)).toEqual(['TC-UI-001', 'TC-API-001']);
    expect(groups.get('epic-phase-2')!.map(tc => tc.id)).toEqual(['TC-UI-002']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no story_ref/);
  });
});
