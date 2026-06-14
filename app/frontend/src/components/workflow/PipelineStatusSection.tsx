import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import {
  type TestCase, type MediaItem, type RealTestResults, type PipelineRun, type PipelineStage, type SuiteState,
  STAGE_ORDER, STAGE_DELAYS, SUITE_START, SUITE_DONE, TESTS_START_AFTER_PR, MOCK_TEST_CASES,
  suiteForTest, assignResults, deriveNumbers, slugify,
} from './pipeline-status/shared';
import { StageIndicator } from './pipeline-status/StageIndicator';
import { CheckSuiteRow } from './pipeline-status/CheckSuiteRow';
import { CollapsiblePanel } from './pipeline-status/CollapsiblePanel';
import { TestDetailsModal } from './pipeline-status/TestDetailsModal';

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
