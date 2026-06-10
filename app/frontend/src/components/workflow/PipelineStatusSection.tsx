import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  title: string;
  type: 'happy_path' | 'bad_path' | 'edge_case' | string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  category?: string;
}

interface TestResult {
  id: string;
  title: string;
  passed: boolean;
  type: string;
  priority: string;
}

interface MediaItem {
  type: 'video' | 'screenshot';
  url: string;
  name: string;
}

interface RealTestResults {
  passed: number;
  failed: number;
  total: number;
  cases: TestResult[];
  media?: MediaItem[];
}

interface PipelineRun {
  id: number;
  stage: string;
  status: 'running' | 'complete' | 'failed';
  pr_url: string | null;
  branch: string | null;
  pipeline_id: string | null;
  test_results: string | null;
}

type PipelineStage = 'idle' | 'triggered' | 'cloning' | 'analyzing' | 'generating' | 'pr_created';
type SuiteState = 'idle' | 'running' | 'done';

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_ORDER: PipelineStage[] = ['triggered', 'cloning', 'analyzing', 'generating', 'pr_created'];

const STAGE_DELAYS: Record<PipelineStage, number> = {
  idle: 0, triggered: 800, cloning: 3500, analyzing: 7000, generating: 13000, pr_created: 22000,
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle:       '',
  triggered:  'Pipeline triggered',
  cloning:    'Cloning repository…',
  analyzing:  'Reading ticket context…',
  generating: 'Writing implementation…',
  pr_created: 'PR created — ready for review',
};

const SUITE_START: Record<string, number> = { ios: 300, android: 900, backend: 1600 };
const SUITE_DONE:  Record<string, number> = { ios: 4200, android: 5800, backend: 7200 };
const TESTS_START_AFTER_PR = 7500;

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

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high:     'text-amber-600 dark:text-amber-400',
  medium:   'text-blue-600 dark:text-blue-400',
  low:      'text-slate-400 dark:text-slate-500',
};

const TYPE_LABEL: Record<string, string> = { happy_path: 'happy', bad_path: 'bad', edge_case: 'edge' };

const TYPE_COLOR: Record<string, string> = {
  happy_path: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  bad_path:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  edge_case:  'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function suiteForTest(idx: number): string {
  return ['ios', 'android', 'backend'][idx % 3];
}

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
  const pipeNum = (parseInt(hex.slice(4, 8), 16) % 850) + 100;
  return { pipeNum };
}

function slugify(text: string) {
  return 'feat/' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// ── Stage indicator (code pipeline) ───────────────────────────────────────────

function StageIndicator({ stage, current }: { stage: PipelineStage; current: PipelineStage }) {
  const si = STAGE_ORDER.indexOf(stage);
  const ci = STAGE_ORDER.indexOf(current);
  const done = ci > si, active = ci === si;

  return (
    <div className="flex items-center gap-2">
      {done && (
        <span className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center">
          <svg className="w-1.5 h-1.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {active && (
        <span className="w-3 h-3 rounded-full bg-teal-500 flex-shrink-0 flex items-center justify-center animate-pulse">
          <span className="w-1 h-1 rounded-full bg-white" />
        </span>
      )}
      {!done && !active && (
        <span className="w-3 h-3 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
      )}
      <span className={`text-[10px] font-mono leading-tight ${
        done ? 'text-green-600 dark:text-green-400'
             : active ? 'text-teal-600 dark:text-teal-300'
             : 'text-slate-400 dark:text-slate-600'
      }`}>
        {STAGE_LABELS[stage]}
      </span>
    </div>
  );
}

// ── Suite row (tests panel) ───────────────────────────────────────────────────

function CheckSuiteRow({
  platform, icon, state, tests, results,
}: {
  platform: string; icon: string; state: SuiteState;
  tests: TestCase[]; results: Map<string, boolean>;
}) {
  const passCount = tests.filter(t => results.get(t.id) ?? true).length;
  const failCount = tests.length - passCount;

  return (
    <div className="flex items-center gap-2.5 py-1">
      {state === 'idle' && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
      )}
      {state === 'running' && (
        <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
          <svg className="w-3 h-3 text-teal-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      )}
      {state === 'done' && failCount === 0 && (
        <span className="w-3.5 h-3.5 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center">
          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {state === 'done' && failCount > 0 && (
        <span className="w-3.5 h-3.5 rounded-full bg-amber-500 flex-shrink-0 flex items-center justify-center">
          <span className="text-[8px] font-bold text-white leading-none">{failCount}</span>
        </span>
      )}
      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 flex-shrink-0">{icon} {platform}</span>
      <span className="text-[10px] font-mono flex-shrink-0">
        {state === 'idle' && <span className="text-slate-400 dark:text-slate-600">queued</span>}
        {state === 'running' && <span className="text-teal-600 dark:text-teal-400 animate-pulse">running…</span>}
        {state === 'done' && (
          <span className={failCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
            {passCount}/{tests.length}
          </span>
        )}
      </span>
    </div>
  );
}

// ── Collapsible section wrapper ────────────────────────────────────────────────

function CollapsiblePanel({
  title, badge, badgeVariant, pipeNum, open, onToggle, children,
}: {
  title: string;
  badge?: string;
  badgeVariant?: 'success' | 'warning' | 'running' | 'neutral';
  pipeNum?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const badgeCls =
    badgeVariant === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
    badgeVariant === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
    badgeVariant === 'running' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' :
    'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {title}
          </span>
          {pipeNum !== undefined && (
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">#{pipeNum}</span>
          )}
          {badge && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${badgeCls}`}>{badge}</span>
          )}
        </div>
        <svg
          className={`w-3 h-3 text-slate-400 transition-transform duration-200 flex-shrink-0 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Test Details Modal ─────────────────────────────────────────────────────────

function TestDetailsModal({
  testCases, results, media, isReal, onClose,
}: {
  testCases: TestCase[];
  results: Map<string, boolean>;
  media: MediaItem[];
  isReal: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail'>('all');
  const [activeVideo, setActiveVideo] = useState<string | null>(
    media.find(m => m.type === 'video')?.url ?? null
  );

  const totalPass = testCases.filter(t => results.get(t.id) ?? true).length;
  const totalFail = testCases.length - totalPass;

  const filtered = testCases.filter(tc => {
    const pass = results.get(tc.id) ?? true;
    if (filter === 'pass') return pass;
    if (filter === 'fail') return !pass;
    return true;
  });

  const screenshots = media.filter(m => m.type === 'screenshot');
  const videos = media.filter(m => m.type === 'video');

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-[#0d1117] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl font-mono">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Test Results</span>
            <span className={`text-[11px] px-2 py-0.5 rounded ${
              totalFail > 0
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            }`}>
              {totalFail > 0 ? `${totalPass}/${testCases.length} passed · ${totalFail} failing` : `${testCases.length}/${testCases.length} passed`}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-600">{isReal ? 'Playwright' : 'Vera'}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <div className="h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${totalFail > 0 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${testCases.length > 0 ? Math.round((totalPass / testCases.length) * 100) : 0}%` }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-5 py-2 flex-shrink-0">
          {(['all', 'pass', 'fail'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-3 py-1 rounded-full transition-colors ${
                filter === f
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {f === 'all' ? `All (${testCases.length})` : f === 'pass' ? `Passing (${totalPass})` : `Failing (${totalFail})`}
            </button>
          ))}
        </div>

        {/* Test case list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pb-2 space-y-px">
            {filtered.map(tc => {
              const pass = results.get(tc.id) ?? true;
              return (
                <div
                  key={tc.id}
                  className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${
                    pass
                      ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      : 'bg-red-50/60 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20'
                  }`}
                >
                  {/* Pass/fail icon */}
                  {pass ? (
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                      <svg className="w-2 h-2 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                      <svg className="w-2 h-2 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                  {/* ID */}
                  <span className="flex-shrink-0 w-14 text-[10px] text-slate-400 dark:text-slate-600">{tc.id}</span>
                  {/* Title */}
                  <span className={`flex-1 text-[11px] leading-snug ${
                    pass ? 'text-slate-700 dark:text-slate-300' : 'text-red-700 dark:text-red-300'
                  }`}>
                    {tc.title}
                  </span>
                  {/* Badges */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${TYPE_COLOR[tc.type] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {TYPE_LABEL[tc.type] ?? tc.type}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 ${PRIORITY_COLOR[tc.priority] ?? 'text-slate-500'}`}>
                      {tc.priority}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Media section */}
          {media.length > 0 && (
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Media
              </span>

              {/* Video player */}
              {videos.length > 0 && (
                <div className="space-y-2">
                  {videos.length > 1 && (
                    <div className="flex gap-1.5">
                      {videos.map((v, i) => (
                        <button
                          key={v.url}
                          onClick={() => setActiveVideo(v.url)}
                          className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                            activeVideo === v.url
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          Video {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeVideo && (
                    <video
                      key={activeVideo}
                      src={activeVideo}
                      controls
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-black"
                      style={{ maxHeight: 280 }}
                    />
                  )}
                </div>
              )}

              {/* Screenshots grid */}
              {screenshots.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Screenshots ({screenshots.length})
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {screenshots.map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-video rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden hover:border-blue-400 dark:hover:border-blue-600 transition-colors bg-slate-900"
                        title={s.name}
                      >
                        <img
                          src={s.url}
                          alt={s.name}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { workflowId: string }

export function PipelineStatusSection({ workflowId }: Props) {
  const [realRun, setRealRun]             = useState<PipelineRun | null>(null);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('idle');
  const [testCases, setTestCases]         = useState<TestCase[]>([]);
  const [results, setResults]             = useState<Map<string, boolean>>(new Map());
  const [visibleTests, setVisibleTests]   = useState(0);
  const [summary, setSummary]             = useState('');
  const [media, setMedia]                 = useState<MediaItem[]>([]);
  const [suites, setSuites]               = useState<Record<string, SuiteState>>({
    ios: 'idle', android: 'idle', backend: 'idle',
  });

  // Panel / modal state
  const [codePanelOpen, setCodePanelOpen] = useState(true);
  const [testPanelOpen, setTestPanelOpen] = useState(true);
  const [showModal, setShowModal]         = useState(false);

  const animationStarted = useRef(false);
  const pollRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const prCreatedRef     = useRef(false);

  const { pipeNum } = deriveNumbers(workflowId);

  // ── Derived display values ────────────────────────────────────────────────
  const isReal    = realRun !== null;
  const prCreated = isReal ? realRun.stage === 'pr_created' : pipelineStage === 'pr_created';
  const branch    = isReal && realRun.branch ? realRun.branch : (summary ? slugify(summary) : 'feat/implementation');
  const displayPipelineStage: PipelineStage = isReal ? (realRun.stage as PipelineStage) : pipelineStage;

  const allDone = isReal
    ? suites.backend === 'done'
    : suites.ios === 'done' && suites.android === 'done' && suites.backend === 'done';

  const totalTests = testCases.length;
  const totalPass  = testCases.filter(t => results.get(t.id) ?? true).length;
  const totalFail  = totalTests - totalPass;

  // Real mode: web suite only; demo mode: all three
  const SUITE_CFG = isReal
    ? [{ key: 'backend', icon: '⚙', label: 'Web / Playwright' }]
    : [
        { key: 'ios',     icon: '📱', label: 'iOS Simulator'   },
        { key: 'android', icon: '🤖', label: 'Android Emulator' },
        { key: 'backend', icon: '⚙',  label: 'Backend API'      },
      ];

  const suiteTests: Record<string, TestCase[]> = { ios: [], android: [], backend: [] };
  testCases.forEach((tc, i) => suiteTests[suiteForTest(i)].push(tc));

  // ── Auto-collapse code panel when tests phase starts ──────────────────────
  useEffect(() => {
    if (prCreated && !prCreatedRef.current) {
      prCreatedRef.current = true;
      setCodePanelOpen(false);
    }
  }, [prCreated]);

  // ── Poll for real pipeline run ────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const run = await api.getPipelineRun(workflowId);
      if (!run) return;
      setRealRun(run as PipelineRun);
      if (run.status === 'complete' || run.status === 'failed') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    };
    check();
    pollRef.current = setInterval(check, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [workflowId]);

  // ── When real run arrives and is complete: populate test data ─────────────
  useEffect(() => {
    if (!realRun) return;

    if (realRun.test_results) {
      try {
        const parsed: RealTestResults = JSON.parse(realRun.test_results);
        const cases = parsed.cases ?? [];
        const asTestCases: TestCase[] = cases.map(c => ({
          id: c.id, title: c.title, type: c.type, priority: c.priority,
        }));
        setTestCases(asTestCases.length > 0 ? asTestCases : MOCK_TEST_CASES);
        const resultMap = new Map<string, boolean>(
          cases.length > 0 ? cases.map(c => [c.id, c.passed]) : []
        );
        setResults(resultMap.size > 0 ? resultMap : assignResults(asTestCases));
        setVisibleTests(asTestCases.length > 0 ? asTestCases.length : MOCK_TEST_CASES.length);
        setSuites({ ios: 'idle', android: 'idle', backend: 'done' });
        const mediaFromResults: MediaItem[] = parsed.media ?? [];
        api.getPipelineMedia(workflowId).then(diskMedia => {
          const seen = new Set(mediaFromResults.map(m => m.url));
          const merged = [...mediaFromResults, ...diskMedia.filter(m => !seen.has(m.url))];
          if (merged.length) setMedia(merged);
        });
        return;
      } catch { /* fall through */ }
    }

    api.getPipelineDemoData(workflowId)
      .then(({ summary: s, testCases: tc }) => {
        setSummary(s);
        const tests = tc.length > 0 ? tc : MOCK_TEST_CASES;
        setTestCases(tests);
        setResults(assignResults(tests));
        if (realRun.status === 'complete') {
          setVisibleTests(tests.length);
          setSuites({ ios: 'idle', android: 'idle', backend: 'done' });
        }
      })
      .catch(() => {
        setTestCases(MOCK_TEST_CASES);
        setResults(assignResults(MOCK_TEST_CASES));
      });

    if (realRun.status === 'complete') {
      api.getPipelineMedia(workflowId).then(diskMedia => {
        if (diskMedia.length) {
          setMedia(prev => {
            const seen = new Set(prev.map(m => m.url));
            return [...prev, ...diskMedia.filter(m => !seen.has(m.url))];
          });
        }
      });
    }
  }, [realRun?.id, realRun?.status, workflowId]);

  // ── Demo animation (only when no real run) ────────────────────────────────
  useEffect(() => {
    if (realRun || animationStarted.current) return;
    animationStarted.current = true;

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
  }, [realRun, workflowId]);

  // ── Demo: test suite cascade after pr_created ─────────────────────────────
  useEffect(() => {
    if (isReal || pipelineStage !== 'pr_created') return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const suite of ['ios', 'android', 'backend']) {
      timers.push(setTimeout(() => setSuites(s => ({ ...s, [suite]: 'running' })), SUITE_START[suite]));
      timers.push(setTimeout(() => setSuites(s => ({ ...s, [suite]: 'done' })),    SUITE_DONE[suite]));
    }

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
  }, [isReal, pipelineStage, testCases.length]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Nothing to show yet
  if (displayPipelineStage === 'idle' && !isReal) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-[10px] text-slate-400 dark:text-slate-600 font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 animate-pulse" />
        Azure pipeline queued…
      </div>
    );
  }

  const codeBadge = prCreated ? 'PR ready' : displayPipelineStage !== 'idle' ? 'running' : undefined;
  const codeBadgeVariant = prCreated ? 'success' : 'running';

  const testBadge = allDone
    ? totalFail > 0 ? `${totalPass}/${totalTests}` : `${totalTests} passed`
    : 'running';
  const testBadgeVariant = allDone
    ? totalFail > 0 ? 'warning' : 'success'
    : 'running';

  return (
    <div className="space-y-2">

      {/* ── Code Pipeline panel ──────────────────────────────── */}
      <CollapsiblePanel
        title={isReal ? 'Pipeline' : 'Azure Pipeline'}
        badge={codeBadge}
        badgeVariant={codeBadgeVariant}
        pipeNum={isReal && realRun.pipeline_id ? parseInt(realRun.pipeline_id) : pipeNum}
        open={codePanelOpen}
        onToggle={() => setCodePanelOpen(o => !o)}
      >
        <div className="px-3 py-2.5 space-y-1.5">
          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-600 truncate pb-0.5">{branch}</div>
          {STAGE_ORDER.map(s => <StageIndicator key={s} stage={s} current={displayPipelineStage} />)}
        </div>
      </CollapsiblePanel>

      {/* ── Tests panel (visible once PR created) ───────────── */}
      {(prCreated || isReal) && (
        <CollapsiblePanel
          title="Tests"
          badge={testBadge}
          badgeVariant={testBadgeVariant as any}
          open={testPanelOpen}
          onToggle={() => setTestPanelOpen(o => !o)}
        >
          <div className="px-3 py-2.5 space-y-2">
            {/* Suite rows */}
            <div className="space-y-0.5">
              {SUITE_CFG.map(({ key, icon, label }) => (
                <CheckSuiteRow
                  key={key} platform={label} icon={icon}
                  state={suites[key]} tests={suiteTests[key]} results={results}
                />
              ))}
            </div>

            {/* Progress bar + view details when done */}
            {allDone && totalTests > 0 && (
              <>
                <div className="h-0.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${totalFail > 0 ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.round((totalPass / totalTests) * 100)}%` }}
                  />
                </div>
                <button
                  onClick={() => setShowModal(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-mono border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:border-teal-300 dark:hover:border-teal-700 bg-white dark:bg-slate-900/60 hover:bg-teal-50 dark:hover:bg-teal-900/10 transition-colors"
                >
                  <span>View {totalTests} test results</span>
                  {media.length > 0 && (
                    <span className="text-[9px] opacity-50">· {media.length} media</span>
                  )}
                  <span className="opacity-60">↗</span>
                </button>
              </>
            )}
          </div>
        </CollapsiblePanel>
      )}

      {/* ── Test details modal ──────────────────────────────── */}
      {showModal && (
        <TestDetailsModal
          testCases={testCases.slice(0, visibleTests)}
          results={results}
          media={media}
          isReal={isReal}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
