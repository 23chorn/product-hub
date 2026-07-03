// ── QA test-case JSON types ──────────────────────────────────────────────────
// Shared between the backend (dev/QA ticket export route, completed-initiatives
// detail) and the frontend (artifact viewer's Test Cases tab) so both runtimes
// parse the same qa_tests artifact JSON one way.

export interface QAScenario {
  given: string[];
  when: string[];
  then: string[];
}

export interface TestCaseEndpoint {
  method: string;
  path: string;
}

export interface TestCase {
  id: string;
  title: string;
  description?: string;
  type: string;
  priority: string;
  category?: string;
  /** Which surface this case exercises: a direct API/contract check, or a UI-driven user flow.
   *  Absent on older artifacts predating this field — treat as 'user_facing'. */
  layer?: 'technical' | 'user_facing';
  /** Endpoint this case targets — only present for layer: 'technical' cases. */
  endpoint?: TestCaseEndpoint;
  prd_ref?: string;
  story_ref?: string;
  linkedStory?: string;
  scenario?: QAScenario;
  steps?: string[];
  expectedResult?: string;
  preconditions?: string[];
  test_data?: Record<string, unknown>;
  tags?: string[];
  automation_notes?: string;
}

export interface TestCoverage {
  total?: number;
  happy_paths?: number;
  bad_paths?: number;
  edge_cases?: number;
  functional?: number;
  performance?: number;
  compliance?: number;
  by_priority?: Record<string, number>;
  by_fr?: Record<string, number>;
}

export interface QATestSuite {
  suite?: string;
  version?: string;
  metadata?: { notes?: string; prd_version?: string; source_documents?: string[] };
  coverage?: TestCoverage;
  test_cases: TestCase[];
}

export function tryParseQATests(content: string): QATestSuite | null {
  try {
    const stripped = content
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim();
    const parsed = JSON.parse(stripped);

    // Accept both test_cases (snake_case) and testCases (camelCase)
    const cases = parsed.test_cases ?? parsed.testCases;
    if (!Array.isArray(cases)) return null;

    // Normalize metadata from testSuite wrapper (alternate format from qa-tests.template.md)
    const ts = parsed.testSuite;
    const suite = parsed.suite ?? ts?.feature ?? ts?.suite;
    const version = parsed.version ?? ts?.version;

    // Normalize coverage
    let coverage: TestCoverage | undefined = parsed.coverage;
    if (!coverage && ts) {
      coverage = {
        total: ts.totalCases ?? cases.length,
        ...(ts.coverage ?? {}),
      };
    }

    return { ...parsed, suite, version, coverage, test_cases: cases } as QATestSuite;
  } catch {
    return null;
  }
}

/** Merge each feature's standalone QA suite into one combined test-case list.
 *  No `coverage` field is computed here — callers derive category counts directly
 *  from test_cases, so a separately merged coverage summary would just be a second, driftable
 *  source of truth for the same numbers. */
export function mergeQaTests(parsed: Array<{ num: number; data: QATestSuite }>): QATestSuite | null {
  if (parsed.length === 0) return null;
  const sorted = [...parsed].sort((a, b) => a.num - b.num);
  const test_cases = sorted.flatMap(p => p.data.test_cases ?? []);
  return { suite: 'Combined QA Test Suite', test_cases };
}
