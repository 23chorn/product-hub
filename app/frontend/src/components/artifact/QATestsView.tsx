import { useState } from 'react';

interface Scenario {
  given: string[];
  when: string[];
  then: string[];
}

interface TestCase {
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

// Keys match VALID_TEST_TYPES in app/backend/src/agents/tool-validators.ts — keep in sync.
const TYPE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  happy_path:  { label: 'Happy Path',  color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',   dot: 'bg-green-400' },
  negative:    { label: 'Negative',    color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',           dot: 'bg-red-400' },
  edge:        { label: 'Edge Case',   color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', dot: 'bg-purple-400' },
  boundary:    { label: 'Boundary',    color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',   dot: 'bg-amber-400' },
  security:    { label: 'Security',    color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400', dot: 'bg-indigo-400' },
  performance: { label: 'Performance', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', dot: 'bg-orange-400' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-semibold' },
  high:     { label: 'High',     color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  medium:   { label: 'Medium',   color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  low:      { label: 'Low',      color: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' },
};

const TYPE_ORDER = ['happy_path', 'negative', 'edge', 'boundary', 'security', 'performance'];

function TestCaseCard({ tc }: { tc: TestCase }) {
  const [open, setOpen] = useState(false);
  const typeConf = TYPE_CONFIG[tc.type] ?? { label: tc.type, color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
  const prioConf = PRIORITY_CONFIG[tc.priority] ?? { label: tc.priority, color: 'bg-slate-100 text-slate-500' };

  const hasScenario = tc.scenario && (tc.scenario.given?.length || tc.scenario.when?.length || tc.scenario.then?.length);
  const hasSteps = tc.steps && tc.steps.length > 0;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
      >
        <div className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${typeConf.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{tc.id}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${prioConf.color}`}>{prioConf.label}</span>
            {tc.prd_ref && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">{tc.prd_ref}</span>}
            {(tc.story_ref || tc.linkedStory) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">{tc.story_ref ?? tc.linkedStory}</span>}
          </div>
          <p className="text-sm text-slate-800 dark:text-slate-200 mt-0.5 leading-snug">{tc.title}</p>
          {tc.category && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{tc.category}</p>}
        </div>
        <svg className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30 text-sm">
          {tc.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Description</p>
              <p className="text-xs text-slate-700 dark:text-slate-300">{tc.description}</p>
            </div>
          )}

          {tc.preconditions && tc.preconditions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Preconditions</p>
              {tc.preconditions.map((p, i) => (
                <p key={i} className="text-xs text-slate-600 dark:text-slate-400 ml-2">· {p}</p>
              ))}
            </div>
          )}

          {/* Gherkin scenario (old format) */}
          {hasScenario && (
            <div className="rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5 font-mono text-xs">
              {tc.scenario!.given.map((s, i) => (
                <p key={i}><span className="font-bold text-purple-600 dark:text-purple-400">{i === 0 ? 'Given' : 'And'} </span><span className="text-slate-700 dark:text-slate-300">{s}</span></p>
              ))}
              {tc.scenario!.when.map((s, i) => (
                <p key={i}><span className="font-bold text-blue-600 dark:text-blue-400">{i === 0 ? 'When' : 'And'} </span><span className="text-slate-700 dark:text-slate-300">{s}</span></p>
              ))}
              {tc.scenario!.then.map((s, i) => (
                <p key={i}><span className="font-bold text-green-600 dark:text-green-400">{i === 0 ? 'Then' : 'And'} </span><span className="text-slate-700 dark:text-slate-300">{s}</span></p>
              ))}
            </div>
          )}

          {/* Steps + expected result (new format) */}
          {!hasScenario && hasSteps && (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Steps</p>
                <ol className="list-decimal list-inside space-y-1">
                  {tc.steps!.map((step, i) => (
                    <li key={i} className="text-xs text-slate-700 dark:text-slate-300">{step}</li>
                  ))}
                </ol>
              </div>
              {tc.expectedResult && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Expected Result</p>
                  <p className="text-xs text-slate-700 dark:text-slate-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-2.5 py-2">
                    {tc.expectedResult}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Test data */}
          {tc.test_data && Object.keys(tc.test_data).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Test data</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(tc.test_data).map(([k, v]) => (
                  <span key={k} className="text-[10px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-600 dark:text-slate-400">
                    {k}: <span className="text-teal-600 dark:text-teal-400">{String(v)}</span>
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
                    <span key={tag} className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5 font-mono">{tag}</span>
                  ))}
                </div>
              )}
              {tc.automation_notes && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 italic max-w-xs text-right">{tc.automation_notes}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QATestsView({ data }: { data: QATestSuite }) {
  const cov = data.coverage;
  const grouped = TYPE_ORDER.reduce<Record<string, TestCase[]>>((acc, type) => {
    acc[type] = data.test_cases.filter(tc => tc.type === type);
    return acc;
  }, {});
  const other = data.test_cases.filter(tc => !TYPE_ORDER.includes(tc.type));

  // Build coverage breakdown: any numeric key besides 'total'
  const coverageBreakdown = cov
    ? Object.entries(cov).filter(([k, v]) => k !== 'total' && k !== 'by_priority' && k !== 'by_fr' && typeof v === 'number') as [string, number][]
    : [];

  const totalCount = cov?.total ?? data.test_cases.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{data.suite ?? 'QA Test Suite'}</h2>
        {data.version && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">v{data.version}</p>}
        {data.metadata?.notes && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-2 leading-relaxed">
            {data.metadata.notes}
          </p>
        )}
      </div>

      {/* Coverage summary */}
      {cov && (
        <div className={`grid gap-2 ${coverageBreakdown.length > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2.5 text-center">
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{totalCount}</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide mt-0.5">Total</p>
          </div>
          {/* Old format breakdown */}
          {cov.happy_paths !== undefined && (
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2.5 text-center">
              <p className="text-xl font-bold text-green-700 dark:text-green-400">{cov.happy_paths}</p>
              <p className="text-[10px] text-green-600 dark:text-green-500 uppercase tracking-wide mt-0.5">Happy paths</p>
            </div>
          )}
          {cov.bad_paths !== undefined && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2.5 text-center">
              <p className="text-xl font-bold text-red-700 dark:text-red-400">{cov.bad_paths}</p>
              <p className="text-[10px] text-red-600 dark:text-red-500 uppercase tracking-wide mt-0.5">Bad paths</p>
            </div>
          )}
          {cov.edge_cases !== undefined && (
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2.5 text-center">
              <p className="text-xl font-bold text-purple-700 dark:text-purple-400">{cov.edge_cases}</p>
              <p className="text-[10px] text-purple-600 dark:text-purple-500 uppercase tracking-wide mt-0.5">Edge cases</p>
            </div>
          )}
          {/* New format breakdown (functional/performance/compliance) */}
          {coverageBreakdown.filter(([k]) => !['happy_paths','bad_paths','edge_cases'].includes(k)).map(([k, v]) => {
            const conf = TYPE_CONFIG[k];
            return (
              <div key={k} className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2.5 text-center">
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{v}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide mt-0.5">{conf?.label ?? k}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Priority breakdown */}
      {cov?.by_priority && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(cov.by_priority).map(([p, count]) => {
            const conf = PRIORITY_CONFIG[p];
            return (
              <span key={p} className={`text-xs px-2 py-0.5 rounded ${conf?.color ?? 'bg-slate-100 text-slate-500'}`}>
                {count} {conf?.label ?? p}
              </span>
            );
          })}
        </div>
      )}

      {/* Test case groups */}
      {TYPE_ORDER.map(type => {
        const cases = grouped[type];
        if (!cases || cases.length === 0) return null;
        const conf = TYPE_CONFIG[type];
        return (
          <div key={type}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
              {conf.label}s
              <span className="font-normal text-slate-400">({cases.length})</span>
            </h3>
            <div className="space-y-2">
              {cases.map(tc => <TestCaseCard key={tc.id} tc={tc} />)}
            </div>
          </div>
        );
      })}

      {other.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Other ({other.length})</h3>
          <div className="space-y-2">
            {other.map(tc => <TestCaseCard key={tc.id} tc={tc} />)}
          </div>
        </div>
      )}
    </div>
  );
}
