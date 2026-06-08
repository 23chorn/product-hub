import { useState, useEffect } from 'react';
import { api } from '../../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  title: string;
  type: 'happy_path' | 'bad_path' | 'edge_case' | string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  category?: string;
}

type PipelineStage = 'idle' | 'triggered' | 'cloning' | 'analyzing' | 'generating' | 'pr_created';
type SuiteState = 'idle' | 'running' | 'done';

const STAGE_ORDER: PipelineStage[] = ['triggered', 'cloning', 'analyzing', 'generating', 'pr_created'];

const STAGE_DELAYS: Record<PipelineStage, number> = {
  idle: 0, triggered: 800, cloning: 3500, analyzing: 7000, generating: 13000, pr_created: 22000,
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: '',
  triggered:  'Pipeline triggered',
  cloning:    'Cloning repositories…',
  analyzing:  'Claude Code reading ticket context…',
  generating: 'Writing implementation…',
  pr_created: 'PR created — ready for review',
};

// Check suite timings (ms after pr_created)
const SUITE_START: Record<string, number> = { ios: 300,  android: 900,  backend: 1600 };
const SUITE_DONE:  Record<string, number> = { ios: 4200, android: 5800, backend: 7200 };
// Test cases start revealing after all suites done
const TESTS_START_AFTER_PR = 7500;

// ── Mock fallback test cases ───────────────────────────────────────────────────

const MOCK_TEST_CASES: TestCase[] = [
  { id: 'TC-001', title: 'User can send a message in a chat room',           type: 'happy_path', priority: 'critical' },
  { id: 'TC-002', title: 'Ticker card renders with live price data',          type: 'happy_path', priority: 'critical' },
  { id: 'TC-003', title: 'Chat room loads within 2s on 4G',                   type: 'happy_path', priority: 'high'     },
  { id: 'TC-004', title: 'User receives push notification for new message',   type: 'happy_path', priority: 'high'     },
  { id: 'TC-005', title: 'Message fails gracefully on network drop',          type: 'bad_path',   priority: 'high'     },
  { id: 'TC-006', title: 'Invalid ticker symbol shows error state',           type: 'bad_path',   priority: 'medium'   },
  { id: 'TC-007', title: '500 concurrent users — latency under 500ms',        type: 'edge_case',  priority: 'critical' },
  { id: 'TC-008', title: 'Message history truncates at 1000 items',           type: 'edge_case',  priority: 'medium'   },
  { id: 'TC-009', title: 'Chat room with 0 members shows empty state',        type: 'edge_case',  priority: 'low'      },
  { id: 'TC-010', title: 'Content moderation flag blocks delivery',           type: 'bad_path',   priority: 'critical' },
  { id: 'TC-011', title: 'VoiceOver reads message content correctly',         type: 'edge_case',  priority: 'medium'   },
  { id: 'TC-012', title: 'Back gesture closes chat without data loss',        type: 'happy_path', priority: 'high'     },
  { id: 'TC-013', title: 'Message retention — 7-year archive query succeeds', type: 'edge_case',  priority: 'critical' },
  { id: 'TC-014', title: 'Room join link expires after 24 hours',             type: 'bad_path',   priority: 'medium'   },
];

// Assign test cases to suites by index mod 3
function suiteForTest(idx: number): string {
  return ['ios', 'android', 'backend'][idx % 3];
}

// Assign pass/fail: fail last ~13% (min 2), preferring non-critical happy paths
function assignResults(tests: TestCase[]): Map<string, boolean> {
  const results = new Map<string, boolean>();
  const failCount = Math.max(2, Math.floor(tests.length * 0.13));
  const failSet = new Set(
    [...tests]
      .filter(t => !(t.type === 'happy_path' && t.priority === 'critical'))
      .slice(-failCount)
      .map(t => t.id)
  );
  for (const t of tests) results.set(t.id, !failSet.has(t.id));
  return results;
}

function deriveNumbers(workflowId: string) {
  const hex = workflowId.replace(/-/g, '');
  const prNum    = (parseInt(hex.slice(0, 4), 16) % 850) + 100;
  const pipeNum  = (parseInt(hex.slice(4, 8), 16) % 850) + 100;
  return { prNum, pipeNum };
}

function slugify(text: string) {
  return 'feat/' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high:     'text-amber-600 dark:text-amber-400',
  medium:   'text-blue-600 dark:text-blue-400',
  low:      'text-slate-400 dark:text-slate-600',
};

const TYPE_LABEL: Record<string, string> = { happy_path: 'happy', bad_path: 'bad', edge_case: 'edge' };

// ── Subcomponents ─────────────────────────────────────────────────────────────

function StageIndicator({ stage, current }: { stage: PipelineStage; current: PipelineStage }) {
  const si = STAGE_ORDER.indexOf(stage);
  const ci = STAGE_ORDER.indexOf(current);
  const done = ci > si, active = ci === si;

  return (
    <div className="flex items-center gap-2.5">
      {done && (
        <span className="w-3.5 h-3.5 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center">
          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {active && (
        <span className="w-3.5 h-3.5 rounded-full bg-teal-500 flex-shrink-0 flex items-center justify-center animate-pulse">
          <span className="w-1 h-1 rounded-full bg-white" />
        </span>
      )}
      {!done && !active && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
      )}
      <span className={`text-[11px] font-mono ${
        done ? 'text-green-600 dark:text-green-400' : active ? 'text-teal-700 dark:text-teal-300' : 'text-slate-400 dark:text-slate-600'
      }`}>
        {STAGE_LABELS[stage]}
      </span>
    </div>
  );
}

function CheckSuiteRow({
  platform, icon, state, tests, results,
}: {
  platform: string;
  icon: string;
  state: SuiteState;
  tests: TestCase[];
  results: Map<string, boolean>;
}) {
  const passCount = tests.filter(t => results.get(t.id)).length;
  const failCount = tests.length - passCount;

  return (
    <div className="flex items-center gap-3 py-1.5 px-1">
      {/* State icon */}
      {state === 'idle' && (
        <span className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
      )}
      {state === 'running' && (
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-teal-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      )}
      {state === 'done' && failCount === 0 && (
        <span className="w-4 h-4 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {state === 'done' && failCount > 0 && (
        <span className="w-4 h-4 rounded-full bg-amber-500 flex-shrink-0 flex items-center justify-center">
          <span className="text-[9px] font-bold text-white leading-none">{failCount}</span>
        </span>
      )}

      {/* Platform */}
      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 flex-shrink-0">
        {icon} {platform}
      </span>

      {/* Running label / results */}
      {state === 'idle' && (
        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">queued</span>
      )}
      {state === 'running' && (
        <span className="text-[10px] font-mono text-teal-600 dark:text-teal-400 animate-pulse">running {tests.length} tests…</span>
      )}
      {state === 'done' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-green-600 dark:text-green-400">{passCount} passed</span>
          {failCount > 0 && (
            <span className="text-[10px] font-mono text-red-600 dark:text-red-400">{failCount} failed</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { workflowId: string }

export function PipelineStatusSection({ workflowId }: Props) {
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('idle');
  const [testCases, setTestCases]         = useState<TestCase[]>([]);
  const [results, setResults]             = useState<Map<string, boolean>>(new Map());
  const [visibleTests, setVisibleTests]   = useState(0);
  const [summary, setSummary]             = useState('');
  const [expanded, setExpanded]           = useState(false);
  const [suites, setSuites]               = useState<Record<string, SuiteState>>({
    ios: 'idle', android: 'idle', backend: 'idle',
  });

  const { prNum, pipeNum } = deriveNumbers(workflowId);
  const branch = summary ? slugify(summary) : 'feat/implementation';

  // Load QA data + start pipeline animation
  useEffect(() => {
    api.getPipelineDemoData(workflowId)
      .then(({ summary: s, testCases: tc }) => {
        setSummary(s);
        const tests = tc.length > 0 ? tc : MOCK_TEST_CASES;
        setTestCases(tests);
        setResults(assignResults(tests));
      })
      .catch(() => {
        setTestCases(MOCK_TEST_CASES);
        setResults(assignResults(MOCK_TEST_CASES));
      });

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const s of STAGE_ORDER) {
      timers.push(setTimeout(() => setPipelineStage(s), STAGE_DELAYS[s]));
    }
    return () => timers.forEach(clearTimeout);
  }, [workflowId]);

  // After pr_created: animate check suites then reveal test cases
  useEffect(() => {
    if (pipelineStage !== 'pr_created') return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const suite of ['ios', 'android', 'backend']) {
      timers.push(setTimeout(() => setSuites(s => ({ ...s, [suite]: 'running' })), SUITE_START[suite]));
      timers.push(setTimeout(() => setSuites(s => ({ ...s, [suite]: 'done' })),    SUITE_DONE[suite]));
    }

    // Reveal test cases one by one after all suites finish
    timers.push(setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setVisibleTests(i);
        if (i >= testCases.length) clearInterval(interval);
      }, 55);
      timers.push(interval as any);
    }, TESTS_START_AFTER_PR));

    return () => timers.forEach(t => { try { clearTimeout(t); clearInterval(t as any); } catch {} });
  }, [pipelineStage, testCases.length]);

  const prCreated   = pipelineStage === 'pr_created';
  const allDone     = suites.ios === 'done' && suites.android === 'done' && suites.backend === 'done';
  const totalTests  = testCases.length;
  const passCount   = testCases.slice(0, visibleTests).filter(t => results.get(t.id)).length;
  const visible     = Math.min(visibleTests, totalTests);
  const pct         = visible > 0 ? Math.round((passCount / visible) * 100) : 0;
  const totalPass   = testCases.filter(t => results.get(t.id)).length;
  const totalFail   = totalTests - totalPass;

  const PREVIEW = 6;
  const displayedTests = allDone
    ? (expanded ? testCases.slice(0, visibleTests) : testCases.slice(0, Math.min(PREVIEW, visibleTests)))
    : [];
  const hasMore = visibleTests > PREVIEW && !expanded;

  // Per-suite test assignment
  const suiteTests: Record<string, TestCase[]> = { ios: [], android: [], backend: [] };
  testCases.forEach((tc, i) => suiteTests[suiteForTest(i)].push(tc));

  const SUITE_CFG = [
    { key: 'ios',     icon: '📱', label: 'iOS Simulator'    },
    { key: 'android', icon: '🤖', label: 'Android Emulator' },
    { key: 'backend', icon: '⚙',  label: 'Backend API'      },
  ];

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Azure Pipeline</span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">#{pipeNum}</span>
          {pipelineStage !== 'idle' && !prCreated && (
            <span className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" /> running
            </span>
          )}
          {prCreated && (
            <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> complete
            </span>
          )}
        </div>
        {prCreated && (
          <a href="#" onClick={e => e.preventDefault()}
            className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-white bg-blue-600 hover:bg-blue-500 px-2.5 py-1 rounded transition-colors">
            Open PR #{prNum} ↗
          </a>
        )}
      </div>

      {/* ── Pipeline stages ─────────────────────────────────── */}
      {pipelineStage !== 'idle' && (
        <div className="px-4 py-3 space-y-2 border-b border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-600 mb-1.5 truncate">{branch}</div>
          {STAGE_ORDER.map(s => <StageIndicator key={s} stage={s} current={pipelineStage} />)}
        </div>
      )}

      {/* ── Check suites ─────────────────────────────────────── */}
      {prCreated && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 mb-2">
            PR Checks
          </div>
          <div className="space-y-0.5">
            {SUITE_CFG.map(({ key, icon, label }) => (
              <CheckSuiteRow
                key={key}
                platform={label}
                icon={icon}
                state={suites[key]}
                tests={suiteTests[key]}
                results={results}
              />
            ))}
          </div>
          {allDone && (
            <div className={`mt-2 text-[10px] font-mono font-semibold ${totalFail > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
              {totalFail > 0
                ? `⚠ ${totalPass}/${totalTests} tests passed — ${totalFail} failing`
                : `✓ All ${totalTests} tests passed`}
            </div>
          )}
        </div>
      )}

      {/* ── Test case breakdown ──────────────────────────────── */}
      {allDone && totalTests > 0 && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600">Test Results</span>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">Vera · {totalTests} cases</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold font-mono ${pct >= 80 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {visible > 0 ? pct : 0}%
              </span>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">
                {passCount}/{visible} passing
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mb-2.5">
            <div
              className={`h-full rounded-full transition-all duration-200 ${pct >= 80 ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${visible > 0 ? pct : 0}%` }}
            />
          </div>

          {/* Test rows */}
          <div className="space-y-px">
            {displayedTests.map(tc => {
              const pass = results.get(tc.id) ?? true;
              return (
                <div key={tc.id}
                  className="flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors">
                  {pass ? (
                    <span className="flex-shrink-0 w-3 h-3 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                      <svg className="w-1.5 h-1.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="flex-shrink-0 w-3 h-3 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                      <svg className="w-1.5 h-1.5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                  <span className="flex-shrink-0 w-12 text-[10px] font-mono text-slate-400 dark:text-slate-600">{tc.id}</span>
                  <span className={`flex-1 text-[11px] font-mono truncate ${pass ? 'text-slate-700 dark:text-slate-300' : 'text-red-700 dark:text-red-400'}`}>
                    {tc.title}
                  </span>
                  <span className="flex-shrink-0 text-[9px] font-mono text-slate-400 dark:text-slate-600">
                    {TYPE_LABEL[tc.type] ?? tc.type}
                  </span>
                  <span className={`flex-shrink-0 text-[9px] font-mono ${PRIORITY_COLOR[tc.priority] ?? 'text-slate-400'}`}>
                    {tc.priority}
                  </span>
                </div>
              );
            })}
          </div>

          {(hasMore || expanded) && (
            <button onClick={() => setExpanded(e => !e)}
              className="mt-1.5 text-[10px] font-mono text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              {expanded ? '▲ show less' : `▼ ${totalTests - PREVIEW} more tests`}
            </button>
          )}
        </div>
      )}

      {/* Idle state */}
      {pipelineStage === 'idle' && (
        <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-600 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 animate-pulse" />
          Azure pipeline queued…
        </div>
      )}
    </div>
  );
}
