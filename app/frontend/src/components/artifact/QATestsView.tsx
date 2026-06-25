import { useState } from 'react';
import { ExpandableText } from '../common/ExpandableText';
import { DeleteItemButton } from '../common/DeleteItemButton';

interface Scenario {
  given: string[];
  when: string[];
  then: string[];
}

export interface TestCase {
  id: string;
  title: string;
  description?: string;
  type: string;
  priority: string;
  category?: string;
  prd_ref?: string;
  story_ref?: string;
  linkedStory?: string;
  scenario?: Scenario;
  steps?: string[];
  expectedResult?: string;
  preconditions?: string[];
  test_data?: Record<string, unknown>;
  tags?: string[];
  automation_notes?: string;
}

interface Coverage {
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

interface QATestSuite {
  suite?: string;
  version?: string;
  metadata?: { notes?: string; prd_version?: string; source_documents?: string[] };
  coverage?: Coverage;
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
    let coverage: Coverage | undefined = parsed.coverage;
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

/** Remove one test case by its position in data.test_cases. The view groups/reorders
 *  cases by type or priority for display via .filter() (preserves object identity), so
 *  callers find `index` with data.test_cases.indexOf(tc) rather than matching by id —
 *  id uniqueness across cases isn't guaranteed. */
export function removeTestCase(data: QATestSuite, index: number): QATestSuite {
  return { ...data, test_cases: data.test_cases.filter((_, i) => i !== index) };
}

// Keys match VALID_TEST_TYPES in app/backend/src/agents/tool-validators.ts — keep in sync.
const TYPE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  happy_path:  { label: 'Happy Path',  color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',   dot: 'bg-green-400' },
  negative:    { label: 'Negative',    color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',           dot: 'bg-red-400' },
  edge:        { label: 'Edge Case',   color: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400', dot: 'bg-fuchsia-400' },
  boundary:    { label: 'Boundary',    color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',   dot: 'bg-amber-400' },
  security:    { label: 'Security',    color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400', dot: 'bg-cyan-400' },
  performance: { label: 'Performance', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', dot: 'bg-orange-400' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-semibold', dot: 'bg-red-400' },
  high:     { label: 'High',     color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400', dot: 'bg-amber-400' },
  medium:   { label: 'Medium',   color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', dot: 'bg-blue-400' },
  low:      { label: 'Low',      color: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400', dot: 'bg-surface-400' },
};

const TYPE_ORDER = ['happy_path', 'negative', 'edge', 'boundary', 'security', 'performance'];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

/** Resolve display metadata for a test type, with a generic fallback for types outside TYPE_ORDER
 *  (e.g. legacy fixtures) so every test case still gets a labeled, colored category. */
export function typeMeta(type: string): { label: string; color: string; dot: string } {
  return TYPE_CONFIG[type] ?? {
    label: type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    color: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
    dot: 'bg-surface-400',
  };
}

/** Resolve display metadata for a priority, with a generic fallback for values outside
 *  PRIORITY_CONFIG, mirroring typeMeta. */
function priorityMeta(priority: string): { label: string; color: string; dot: string } {
  return PRIORITY_CONFIG[priority] ?? {
    label: priority.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    color: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
    dot: 'bg-surface-400',
  };
}

/** Group test cases by their actual `type` value — known TYPE_ORDER types first (in that
 *  order), then any other types in first-seen order — so every category present in the data
 *  gets its own square and section instead of being lumped into a catch-all "Other" bucket. */
export function groupByType(testCases: TestCase[]): Array<[string, TestCase[]]> {
  const present = Array.from(new Set(testCases.map(tc => tc.type)));
  const ordered = [...TYPE_ORDER.filter(t => present.includes(t)), ...present.filter(t => !TYPE_ORDER.includes(t))];
  return ordered.map(type => [type, testCases.filter(tc => tc.type === type)]);
}

/** Group test cases by their actual `priority` value, mirroring groupByType — known
 *  PRIORITY_ORDER priorities first (in that order), then any other values in first-seen order. */
function groupByPriority(testCases: TestCase[]): Array<[string, TestCase[]]> {
  const present = Array.from(new Set(testCases.map(tc => tc.priority)));
  const ordered = [...PRIORITY_ORDER.filter(p => present.includes(p)), ...present.filter(p => !PRIORITY_ORDER.includes(p))];
  return ordered.map(priority => [priority, testCases.filter(tc => tc.priority === priority)]);
}

function TestCaseCard({ tc, onDelete }: { tc: TestCase; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const typeConf = typeMeta(tc.type);
  const prioConf = priorityMeta(tc.priority);

  const hasScenario = tc.scenario && (tc.scenario.given?.length || tc.scenario.when?.length || tc.scenario.then?.length);
  const hasSteps = tc.steps && tc.steps.length > 0;

  return (
    <div className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
      <div className="flex items-stretch hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-start gap-3"
      >
        <div className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${typeConf.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-surface-400 dark:text-surface-500">{tc.id}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${prioConf.color}`}>{prioConf.label}</span>
            {tc.prd_ref && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">{tc.prd_ref}</span>}
            {(tc.story_ref || tc.linkedStory) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">{tc.story_ref ?? tc.linkedStory}</span>}
          </div>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5 leading-snug">{tc.title}</p>
          {tc.category && <p className="text-[10px] text-surface-400 dark:text-surface-500 mt-0.5">{tc.category}</p>}
        </div>
        <svg className={`w-3.5 h-3.5 text-surface-400 flex-shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {onDelete && (
        <div className="flex items-center pr-2">
          <DeleteItemButton onDelete={onDelete} label="Delete test case" />
        </div>
      )}
      </div>

      {open && (
        <div className="border-t border-surface-100 dark:border-surface-700 px-3 py-3 space-y-3 bg-surface-50/50 dark:bg-surface-800/30 text-sm">
          {tc.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Description</p>
              <p className="text-xs text-surface-700 dark:text-surface-300">{tc.description}</p>
            </div>
          )}

          {tc.preconditions && tc.preconditions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Preconditions</p>
              {tc.preconditions.map((p, i) => (
                <p key={i} className="text-xs text-surface-600 dark:text-surface-400 ml-2">· {p}</p>
              ))}
            </div>
          )}

          {/* Gherkin scenario (old format) */}
          {hasScenario && (
            <div className="rounded bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5 font-mono text-xs">
              {tc.scenario!.given.map((s, i) => (
                <p key={i}><span className="font-bold text-fuchsia-600 dark:text-fuchsia-400">{i === 0 ? 'Given' : 'And'} </span><span className="text-surface-700 dark:text-surface-300">{s}</span></p>
              ))}
              {tc.scenario!.when.map((s, i) => (
                <p key={i}><span className="font-bold text-blue-600 dark:text-blue-400">{i === 0 ? 'When' : 'And'} </span><span className="text-surface-700 dark:text-surface-300">{s}</span></p>
              ))}
              {tc.scenario!.then.map((s, i) => (
                <p key={i}><span className="font-bold text-green-600 dark:text-green-400">{i === 0 ? 'Then' : 'And'} </span><span className="text-surface-700 dark:text-surface-300">{s}</span></p>
              ))}
            </div>
          )}

          {/* Steps + expected result (new format) */}
          {!hasScenario && hasSteps && (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Steps</p>
                <ol className="list-decimal list-inside space-y-1">
                  {tc.steps!.map((step, i) => (
                    <li key={i} className="text-xs text-surface-700 dark:text-surface-300">{step}</li>
                  ))}
                </ol>
              </div>
              {tc.expectedResult && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Expected Result</p>
                  <p className="text-xs text-surface-700 dark:text-surface-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-2.5 py-2">
                    {tc.expectedResult}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Test data */}
          {tc.test_data && Object.keys(tc.test_data).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Test data</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(tc.test_data).map(([k, v]) => (
                  <span key={k} className="text-[10px] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded px-1.5 py-0.5 font-mono text-surface-600 dark:text-surface-400">
                    {k}: <span className="text-brand-600 dark:text-brand-400">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags + automation notes */}
          {(tc.tags?.length || tc.automation_notes) && (
            <div className="flex items-start justify-between gap-4">
              {tc.tags && tc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tc.tags.map(tag => (
                    <span key={tag} className="text-[10px] bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 rounded px-1.5 py-0.5 font-mono">{tag}</span>
                  ))}
                </div>
              )}
              {tc.automation_notes && (
                <p className="text-[10px] text-surface-400 dark:text-surface-500 italic max-w-xs text-right">{tc.automation_notes}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QATestsView({ data, onDeleteTestCase }: { data: QATestSuite; onDeleteTestCase?: (index: number) => void }) {
  // Counts (and the test case groups below) are derived from the test cases themselves rather
  // than the artifact's separate `coverage` field — that field is frequently absent (current
  // multi-agent QA artifacts don't populate it) or stale (a merged/filtered test_cases list
  // doesn't recompute it), so test_cases is the only count that's always correct.
  const totalCount = data.test_cases.length;
  const [groupMode, setGroupMode] = useState<'type' | 'priority'>('type');
  const groupedCases = groupMode === 'type' ? groupByType(data.test_cases) : groupByPriority(data.test_cases);
  const groupMeta = groupMode === 'type' ? typeMeta : priorityMeta;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    // font-sans: this view can render inside the font-mono pipeline terminal subtree
    // (the per-refinement Stories/Tests overview); pin the app font so it never inherits monospace.
    <div className="space-y-5 font-sans">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">{data.suite ?? 'QA Test Suite'}</h2>
        {data.version && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">v{data.version}</p>}
        {data.metadata?.notes && (
          <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-2">
            <ExpandableText text={data.metadata.notes} className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed" />
          </div>
        )}
      </div>

      {/* Test counts — total on its own row, then a toggleable type/priority breakdown. Counts
          are derived from test_cases directly rather than the artifact's separate `coverage`
          field, which is frequently absent or stale. Switching the toggle also re-groups the
          test case list below. */}
      {totalCount > 0 && (
        <div className="space-y-3">
          <div className="bg-surface-50 dark:bg-surface-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">Total Test Cases</span>
            <span className="text-lg font-bold text-surface-900 dark:text-surface-100">{totalCount}</span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">
                By {groupMode === 'type' ? 'Type' : 'Priority'}
              </p>
              <div className="inline-flex rounded-md border border-surface-200 dark:border-surface-700 overflow-hidden">
                {(['type', 'priority'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                      groupMode === mode
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                    } ${mode === 'priority' ? 'border-l border-surface-200 dark:border-surface-700' : ''}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className={`grid gap-1.5 ${groupMode === 'type' ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {groupedCases.map(([key, cases]) => {
                const meta = groupMeta(key);
                return (
                  <div key={key} className={`${meta.color} rounded-md px-2 py-1.5 text-center`}>
                    <p className="text-sm font-bold">{cases.length}</p>
                    <p className="text-[9px] uppercase tracking-wide mt-0.5 opacity-80">{meta.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Test case groups — grouped by the same toggle above, collapsed by default. */}
      {groupedCases.map(([key, cases]) => {
        const meta = groupMeta(key);
        const isOpen = expandedGroups.has(key);
        return (
          <div key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="w-full flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2"
            >
              <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
              <span className="font-normal text-surface-400">({cases.length})</span>
            </button>
            {isOpen && (
              <div className="space-y-2">
                {cases.map(tc => (
                  <TestCaseCard
                    key={tc.id}
                    tc={tc}
                    onDelete={onDeleteTestCase ? () => onDeleteTestCase(data.test_cases.indexOf(tc)) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
