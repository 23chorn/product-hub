import { describe, it, expect } from 'vitest';
import {
  validateAnalystJson,
  validatePrdJson,
  validateArchitectureJson,
  validateBacklogJson,
  validateEpicFeaturesJson,
  validateQaTestsJson,
} from '../../app/backend/src/agents/tool-validators';

type ValidatorResult = { valid: boolean; issues?: string[] };

/** Parse a validator's stringified result. Assumes web search was available, matching validAnalyst's fixture (real-looking references + inline citations). */
function run(json: unknown): ValidatorResult {
  return JSON.parse(validateAnalystJson({
    json: typeof json === 'string' ? json : JSON.stringify(json),
    web_search_enabled: true,
  }));
}

const validAnalyst = {
  title: 'Price Alerts Research',
  executive_summary: 'The market is large [1] and growing.',
  problem_space: 'Investors miss price moves.',
  conclusion: 'Build alerts.',
  market_size: { tam: '$5B', growth_cagr: '12%', key_driver: 'mobile trading' },
  target_users: [
    { segment: 'Retail', job_to_be_done: 'watch prices', current_workaround: 'limit orders', key_frustration: 'unintended fills' },
  ],
  competitive_landscape: [
    { player: 'Us', strength: 'native', gap: 'none' },
    { player: 'Rival', strength: 'reach', gap: 'no alerts' },
  ],
  constraints_and_risks: [{ risk: 'latency', mitigation: 'websocket' }],
  strategic_recommendations: ['Ship MVP', 'Measure latency'],
  references: [{ id: 1, title: 'Market report', url: 'https://reports.example-real.org/x' }],
};

describe('validateAnalystJson', () => {
  it('accepts a well-formed analyst brief', () => {
    const r = run(validAnalyst);
    expect(r.valid).toBe(true);
  });

  it('rejects non-string / empty json input', () => {
    expect(JSON.parse(validateAnalystJson({ json: '' })).valid).toBe(false);
    expect(JSON.parse(validateAnalystJson({} as any)).valid).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const r = JSON.parse(validateAnalystJson({ json: '{ not json' }));
    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/Invalid JSON/);
  });

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(validAnalyst) + '\n```';
    expect(JSON.parse(validateAnalystJson({ json: fenced, web_search_enabled: true })).valid).toBe(true);
  });

  it('flags missing required root fields', () => {
    const { title, ...rest } = validAnalyst;
    const r = run(rest);
    expect(r.valid).toBe(false);
    expect(r.issues).toContain('root: missing or empty "title"');
  });

  it('requires at least two competitive entries', () => {
    const r = run({ ...validAnalyst, competitive_landscape: [validAnalyst.competitive_landscape[0]] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('competitive_landscape'))).toBe(true);
  });

  it('flags placeholder reference URLs', () => {
    const r = run({
      ...validAnalyst,
      references: [{ id: 1, title: 'x', url: 'https://example.com/foo' }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('placeholder URL'))).toBe(true);
  });

  it('requires inline citations in the executive summary', () => {
    const r = run({ ...validAnalyst, executive_summary: 'No citations here.' });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('inline citations'))).toBe(true);
  });

  it('requires market_size sub-fields when web search is available', () => {
    const r = run({ ...validAnalyst, market_size: { tam: '$5B' } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('market_size'))).toBe(true);
  });

  it('accepts market_size: null when web search is unavailable', () => {
    const noSearch = { ...validAnalyst, market_size: null, references: [], executive_summary: 'No search available.' };
    const r = JSON.parse(validateAnalystJson({ json: JSON.stringify(noSearch), web_search_enabled: false }));
    expect(r.valid).toBe(true);
  });

  it('rejects a market_size object when web search is unavailable', () => {
    const noSearch = { ...validAnalyst, market_size: { tam: '$5B', growth_cagr: '10%', key_driver: 'mobile' }, references: [], executive_summary: 'No search.' };
    const r = JSON.parse(validateAnalystJson({ json: JSON.stringify(noSearch), web_search_enabled: false }));
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('market_size'))).toBe(true);
  });
});

// ── validate_prd_json ─────────────────────────────────────────────────────────

function runPrd(json: unknown): ValidatorResult {
  return JSON.parse(validatePrdJson({ json: typeof json === 'string' ? json : JSON.stringify(json) }));
}

const validPrd = {
  title: 'Price Alerts PRD',
  status: 'Draft',
  problem_statement: 'Investors miss price moves while away from the app.',
  personas: [
    { name: 'Retail Trader', description: 'Active trader checking prices throughout the day', goal: 'never miss a threshold crossing', pain: 'has to keep the app open to watch prices' },
  ],
  user_journeys: [
    { id: 'UJ-1', name: 'Set a price alert', steps: ['Open the alert screen', 'Enter symbol and threshold', 'Save the alert'] },
  ],
  success_metrics: {
    primary: { metric: 'Alert engagement rate', baseline: '0%', target: '25%', timeframe: 'Q3', measurement: 'Analytics dashboard' },
    secondary: [],
    counter: [{ metric: 'Notification opt-out rate', acceptable_floor: '<5%', measurement: 'Settings analytics' }],
  },
  non_functional_requirements: [
    { id: 'NFR1', category: 'Performance', requirement: 'P95 alert delivery latency under 200ms', priority: 'Must' },
    { id: 'NFR2', category: 'Security', requirement: 'Alert payloads are encrypted in transit and at rest', priority: 'Should' },
  ],
  functional_requirements: Array.from({ length: 10 }, (_, i) => ({ id: `FR-${i + 1}`, requirement: `System must support requirement ${i + 1}` })),
  out_of_scope: ['Desktop app support'],
  open_questions: [],
};

describe('validatePrdJson', () => {
  it('accepts a well-formed PRD', () => {
    expect(runPrd(validPrd).valid).toBe(true);
  });

  it('flags missing required root fields', () => {
    const { title, ...rest } = validPrd;
    const r = runPrd(rest);
    expect(r.valid).toBe(false);
    expect(r.issues).toContain('root: missing or empty "title"');
  });

  it('requires at least 2 steps in each user journey', () => {
    const r = runPrd({ ...validPrd, user_journeys: [{ id: 'UJ-1', name: 'Set alert', steps: ['Open screen'] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('at least 2 steps'))).toBe(true);
  });

  it('flags vague NFR language', () => {
    const r = runPrd({
      ...validPrd,
      non_functional_requirements: [{ id: 'NFR1', category: 'Performance', requirement: 'The system should feel fast under load.', priority: 'Should' }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('vague NFR language'))).toBe(true);
  });

  it('requires a measurable threshold for Must-priority NFRs', () => {
    const r = runPrd({
      ...validPrd,
      non_functional_requirements: [{ id: 'NFR1', category: 'Performance', requirement: 'The system must be highly performant during peak hours.', priority: 'Must' }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('no measurable threshold'))).toBe(true);
  });

  it('flags too few functional requirements', () => {
    const r = runPrd({ ...validPrd, functional_requirements: validPrd.functional_requirements.slice(0, 5) });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('only 5 requirements'))).toBe(true);
  });

  it('flags too many functional requirements', () => {
    const r = runPrd({ ...validPrd, functional_requirements: Array.from({ length: 21 }, (_, i) => ({ id: `FR-${i + 1}`, requirement: 'x' })) });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('exceeds 20'))).toBe(true);
  });

  it('requires out_of_scope to be non-empty', () => {
    const r = runPrd({ ...validPrd, out_of_scope: [] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('out_of_scope'))).toBe(true);
  });

  it('requires open_questions to be an array', () => {
    const r = runPrd({ ...validPrd, open_questions: 'none' });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('open_questions'))).toBe(true);
  });
});

// ── validate_architecture_json ────────────────────────────────────────────────

function runArch(json: unknown): ValidatorResult {
  return JSON.parse(validateArchitectureJson({ json: typeof json === 'string' ? json : JSON.stringify(json) }));
}

const validArchitecture = {
  title: 'Price Alerts Architecture',
  overview: 'Real-time alert pipeline using a WebSocket push channel.',
  technology_decisions: {
    backend: [
      { decision: 'Real-time transport', choice: 'WebSocket', rationale: 'Lowest latency for price pushes', alternatives: 'Evaluated polling — ruled out due to latency' },
    ],
  },
  new_dependencies: [],
  data_model: {
    entity_relationship_diagram: 'Alert belongs_to User',
    entities: [{ name: 'Alert', primary_key: 'id', key_fields: 'price_threshold, symbol', relationships: 'belongs_to User' }],
  },
  api_surface: [
    { service: 'alerts-api', endpoints: [{ method: 'POST', path: '/alerts', purpose: 'create alert', request: '{symbol, threshold}', response: '{id}' }] },
  ],
  repository_impact: [{ repo: 'backend', changes_required: 'Add alerts module' }],
  security_considerations: ['Rate-limit alert creation per user'],
};

describe('validateArchitectureJson', () => {
  it('accepts a well-formed architecture document', () => {
    expect(runArch(validArchitecture).valid).toBe(true);
  });

  it('flags an unresolved TBD anywhere in the document', () => {
    const r = runArch({ ...validArchitecture, overview: 'Hosting choice is TBD.' });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('TBD'))).toBe(true);
  });

  it('requires at least one platform in technology_decisions', () => {
    const r = runArch({ ...validArchitecture, technology_decisions: {} });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('technology_decisions'))).toBe(true);
  });

  it('requires a substantive justification for new dependencies', () => {
    const r = runArch({
      ...validArchitecture,
      new_dependencies: [{ name: 'Redis', type: 'cache', not_solvable_with_existing_stack_because: 'needed it', existing_alternatives_evaluated: 'none', cost_or_risk: 'low' }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('too vague'))).toBe(true);
  });

  it('requires at least one data model entity', () => {
    const r = runArch({ ...validArchitecture, data_model: { ...validArchitecture.data_model, entities: [] } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('entities'))).toBe(true);
  });

  it('requires non-empty endpoints per API surface service', () => {
    const r = runArch({ ...validArchitecture, api_surface: [{ service: 'alerts-api', endpoints: [] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('endpoints'))).toBe(true);
  });

});

// ── validate_backlog_json ─────────────────────────────────────────────────────

function runBacklog(json: unknown): ValidatorResult {
  return JSON.parse(validateBacklogJson({ json: typeof json === 'string' ? json : JSON.stringify(json) }));
}

function makeStory(storyId: string, overrides: Record<string, any> = {}) {
  return {
    story_id: storyId,
    title: 'Create price alert',
    as_a: 'retail trader',
    i_want: 'to set a price alert',
    so_that: 'I am notified when the price crosses my threshold',
    acceptance_criteria: [
      'Given I am logged in, When I set a valid threshold, Then the alert is saved',
      'Given an invalid threshold, When I submit, Then I see a validation error',
    ],
    technical_acceptance_criteria: ['API returns 201 on success'],
    prd_ref: { functional_requirements: ['FR-01'], non_functional_requirements: [] },
    platform: 'backend',
    estimated_points: 3,
    ...overrides,
  };
}

const validBacklogFeature = {
  title: 'Price Alerts',
  stories: [makeStory('F1.S1'), makeStory('F1.S2', { depends_on: ['F1.S1'] })],
};

describe('validateBacklogJson', () => {
  it('accepts a well-formed feature with stories', () => {
    expect(runBacklog({ feature: validBacklogFeature }).valid).toBe(true);
  });

  it('rejects a story_id that does not match F?.S? format', () => {
    const r = runBacklog({ feature: { title: 'X', stories: [makeStory('S1')] } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('must follow F?.S? format'))).toBe(true);
  });

  it('enforces 2-5 acceptance criteria bounds', () => {
    const tooFew = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { acceptance_criteria: ['Given x, Then y'] })] } });
    expect(tooFew.issues!.some(i => i.includes('too few acceptance criteria'))).toBe(true);

    const tooMany = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { acceptance_criteria: Array(6).fill('Given x, Then y') })] } });
    expect(tooMany.issues!.some(i => i.includes('too many acceptance criteria'))).toBe(true);
  });

  it('requires acceptance criteria to start with Given/When/Then', () => {
    const r = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { acceptance_criteria: ['User can create an alert', 'User sees a confirmation'] })] } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('must start with Given / When / Then'))).toBe(true);
  });

  it('requires prd_ref traceability to a PRD functional requirement', () => {
    const missing = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { prd_ref: undefined })] } });
    expect(missing.issues!.some(i => i.includes('missing prd_ref'))).toBe(true);

    const badFormat = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { prd_ref: { functional_requirements: ['feature-1'], non_functional_requirements: [] } })] } });
    expect(badFormat.issues!.some(i => i.includes('must match FR-XX format'))).toBe(true);
  });

  it('requires platform to be exactly one stream', () => {
    const r = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { platform: ['backend', 'web'] })] } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('must be a single stream'))).toBe(true);
  });

  it('rejects unknown platform values', () => {
    const r = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1', { platform: 'desktop' })] } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('invalid platform'))).toBe(true);
  });

  it('detects duplicate story_id across features', () => {
    const r = runBacklog({
      epic: { title: 'Epic' },
      features: [{ title: 'A', stories: [makeStory('F1.S1')] }, { title: 'B', stories: [makeStory('F1.S1')] }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('Duplicate story_id'))).toBe(true);
  });

  it('flags depends_on references to an unknown story_id', () => {
    const r = runBacklog({ feature: { title: 'X', stories: [makeStory('F1.S1'), makeStory('F1.S2', { depends_on: ['F9.S9'] })] } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('depends_on references unknown story_id "F9.S9"'))).toBe(true);
  });

  it('rejects an unrecognized root shape', () => {
    const r = runBacklog({});
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('Root must be one of'))).toBe(true);
  });
});

// ── validate_epic_features_json ───────────────────────────────────────────────

function runEpicFeatures(json: unknown): ValidatorResult {
  return JSON.parse(validateEpicFeaturesJson({ json: typeof json === 'string' ? json : JSON.stringify(json) }));
}

function makeEpicFeature(overrides: Record<string, any> = {}) {
  return {
    title: 'Create Price Alert',
    description: 'Allows a retail trader to configure a price threshold for a given symbol and receive a push notification the moment the market price crosses that threshold, removing the need to manually watch charts throughout the day.',
    rationale: 'Core value proposition for the MVP — without alerting, users must manually monitor prices, which is the primary problem this initiative solves.',
    acceptanceCriteria: [
      'Alert is persisted and visible in the alert list within 1 second of creation',
      'Push notification is delivered within 5 seconds of the threshold being crossed',
      'Invalid thresholds (non-numeric, negative) are rejected with a clear error message',
    ],
    prdRef: { functionalRequirements: ['FR-01'], nonFunctionalRequirements: ['NFR1'] },
    stories: [],
    ...overrides,
  };
}

const validEpicFeatures = {
  epic: { title: 'Price Alerts', description: 'Notify traders of threshold crossings', businessValue: 'Improves retention and engagement', prdLink: 'PRD-123' },
  phases: [
    { label: 'MVP', epicTitle: 'Price Alerts', deliverable: 'Basic alert creation and push notification', features: [makeEpicFeature()] },
  ],
  outOfScope: ['SMS notifications'],
};

describe('validateEpicFeaturesJson', () => {
  it('accepts a well-formed epic/phases document', () => {
    expect(runEpicFeatures(validEpicFeatures).valid).toBe(true);
  });

  it('rejects an epic title over 6 words', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, epic: { ...validEpicFeatures.epic, title: 'Price Alerts For Active Traders Across All Platforms Today' } });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('3-6 words'))).toBe(true);
  });

  it('requires at least one MVP phase', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ label: 'Phase 1', epicTitle: 'Price Alerts', deliverable: 'x', features: [makeEpicFeature()] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('no MVP phase found'))).toBe(true);
  });

  it('rejects an unrecognized phase label', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ label: 'Beta', epicTitle: 'Price Alerts', deliverable: 'x', features: [makeEpicFeature()] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('must be exactly "MVP"'))).toBe(true);
  });

  it('requires feature descriptions to be substantive', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ ...validEpicFeatures.phases[0], features: [makeEpicFeature({ description: 'Too short.' })] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('too brief'))).toBe(true);
  });

  it('flags acceptance criteria written as user stories instead of outcomes', () => {
    const r = runEpicFeatures({
      ...validEpicFeatures,
      phases: [{ ...validEpicFeatures.phases[0], features: [makeEpicFeature({ acceptanceCriteria: ['As a user, I want alerts so that I am notified of price moves', ...makeEpicFeature().acceptanceCriteria.slice(0, 2)] })] }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('looks like a user story'))).toBe(true);
  });

  it('requires at least 3 feature-level acceptance criteria', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ ...validEpicFeatures.phases[0], features: [makeEpicFeature({ acceptanceCriteria: makeEpicFeature().acceptanceCriteria.slice(0, 2) })] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('minimum 3 feature-level ACs required'))).toBe(true);
  });

  it('requires prdRef.functionalRequirements to reference FR-XX', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ ...validEpicFeatures.phases[0], features: [makeEpicFeature({ prdRef: { functionalRequirements: ['1'], nonFunctionalRequirements: [] } })] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('must match FR-XX format'))).toBe(true);
  });

  it('rejects non-empty stories at this feature-planning stage', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ ...validEpicFeatures.phases[0], features: [makeEpicFeature({ stories: [{ story_id: 'F1.S1' }] })] }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('stories" must be empty'))).toBe(true);
  });

  it('flags an unresolved TBD in a phase', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ ...validEpicFeatures.phases[0], deliverable: 'TBD' }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('TBD'))).toBe(true);
  });

  it('caps features per phase and flags cramming everything into MVP', () => {
    const r = runEpicFeatures({ ...validEpicFeatures, phases: [{ ...validEpicFeatures.phases[0], features: Array.from({ length: 6 }, () => makeEpicFeature()) }] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('5-per-phase limit'))).toBe(true);
    expect(r.issues!.some(i => i.includes('apply phase discipline'))).toBe(true);
  });

});

// ── validate_qa_tests_json ────────────────────────────────────────────────────

function runQa(json: unknown): ValidatorResult {
  return JSON.parse(validateQaTestsJson({ json: typeof json === 'string' ? json : JSON.stringify(json) }));
}

function makeTestCase(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    title: 'Create alert happy path',
    description: 'Verifies an alert is created with a valid threshold',
    category: 'Alerts',
    prd_ref: 'FR-01',
    type: 'happy_path',
    priority: 'critical',
    scenario: {
      given: ['the user is logged in'],
      when: ['a valid threshold is submitted'],
      then: ['the alert is created and visible in the alert list'],
    },
    tags: ['@smoke', '@regression'],
    ...overrides,
  };
}

const validQaSuite = {
  suite: 'Price Alerts',
  version: '1.0',
  test_cases: [
    makeTestCase('TC-F1-001'),
    makeTestCase('TC-F1-002', {
      type: 'negative', priority: 'high', tags: ['@negative'],
      scenario: { given: ['the user is logged in'], when: ['an invalid threshold is submitted'], then: ['a validation error is shown'] },
    }),
    makeTestCase('TC-F1-003', { type: 'edge', priority: 'medium', tags: ['@edge'] }),
    makeTestCase('TC-F1-004', { type: 'boundary', priority: 'low', tags: ['@regression'] }),
    makeTestCase('TC-F1-005', { type: 'security', priority: 'critical', tags: ['@security', '@smoke'] }),
  ],
};

describe('validateQaTestsJson', () => {
  it('accepts a well-formed QA suite', () => {
    expect(runQa(validQaSuite).valid).toBe(true);
  });

  it('requires at least 5 test cases', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('TC-F1-001')] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('test_cases'))).toBe(true);
  });

  it('rejects a test case id that does not match TC-F?-### format', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('F1-001'), ...validQaSuite.test_cases.slice(1)] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('must follow TC-F?-??? format'))).toBe(true);
  });

  it('flags duplicate test case ids', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('TC-F1-001'), makeTestCase('TC-F1-001'), ...validQaSuite.test_cases.slice(2)] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('duplicate test case id'))).toBe(true);
  });

  it('rejects an unknown test type', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('TC-F1-001', { type: 'smoke' }), ...validQaSuite.test_cases.slice(1)] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('invalid type'))).toBe(true);
  });

  it('rejects an unknown priority', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('TC-F1-001', { priority: 'urgent' }), ...validQaSuite.test_cases.slice(1)] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('invalid priority'))).toBe(true);
  });

  it('requires given/when/then to each be non-empty arrays', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('TC-F1-001', { scenario: { given: ['x'], when: ['y'], then: [] } }), ...validQaSuite.test_cases.slice(1)] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('"then" must be a non-empty array'))).toBe(true);
  });

  it('flags a vague Then assertion', () => {
    const r = runQa({
      ...validQaSuite,
      test_cases: [makeTestCase('TC-F1-001', { scenario: { given: ['x'], when: ['y'], then: ['It should work correctly'] } }), ...validQaSuite.test_cases.slice(1)],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('vague assertion'))).toBe(true);
  });

  it('requires at least one @smoke-tagged critical test', () => {
    const r = runQa({
      ...validQaSuite,
      test_cases: [
        makeTestCase('TC-F1-001', { tags: ['@regression'] }),
        validQaSuite.test_cases[1],
        validQaSuite.test_cases[2],
        validQaSuite.test_cases[3],
        makeTestCase('TC-F1-005', { type: 'security', priority: 'critical', tags: ['@security'] }),
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('No @smoke tests found'))).toBe(true);
  });

  it('requires at least one negative-type test case', () => {
    const r = runQa({ ...validQaSuite, test_cases: validQaSuite.test_cases.map(tc => tc.type === 'negative' ? { ...tc, type: 'edge', tags: ['@edge'] } : tc) });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('No negative test cases found'))).toBe(true);
  });

  it('flags insufficient negative coverage below 20%', () => {
    const cases = Array.from({ length: 10 }, (_, i) => makeTestCase(`TC-F1-${String(i + 1).padStart(3, '0')}`, i === 0 ? { type: 'negative', tags: ['@negative'] } : {}));
    const r = runQa({ ...validQaSuite, test_cases: cases });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('negative/edge coverage'))).toBe(true);
  });

  it('rejects unknown tags', () => {
    const r = runQa({ ...validQaSuite, test_cases: [makeTestCase('TC-F1-001', { tags: ['@foo'] }), ...validQaSuite.test_cases.slice(1)] });
    expect(r.valid).toBe(false);
    expect(r.issues!.some(i => i.includes('unknown tag'))).toBe(true);
  });
});
