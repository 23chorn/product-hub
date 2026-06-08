import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';

interface ProjectStatus {
  phase: 'idle' | 'queued' | 'generating' | 'writing' | 'done' | 'error';
  message: string;
  projectPath?: string;
  error?: string;
}

interface RunLine { type: string; text: string; ts: number }

interface RunStatus {
  status: 'idle' | 'running' | 'passed' | 'failed';
  lines: RunLine[];
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
  configured: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  idle:       'Waiting for workflow…',
  queued:     'Queued…',
  generating: 'Generating…',
  writing:    'Writing files…',
  done:       'Project ready',
  error:      'Generation failed',
};

interface Props { workflowId: string }

export function DemoProjectSection({ workflowId }: Props) {
  const [genStatus, setGenStatus] = useState<ProjectStatus>({ phase: 'idle', message: '' });
  const [run, setRun]             = useState<RunStatus>({ status: 'idle', lines: [], configured: false });
  const [tab, setTab]             = useState<'project' | 'terminal'>('terminal');
  const [files, setFiles]         = useState<string[]>([]);
  const [viewingFile, setViewing] = useState<string | null>(null);
  const [fileContent, setContent] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Poll generation status
  useEffect(() => {
    if (genStatus.phase === 'done' || genStatus.phase === 'error') return;
    const t = setInterval(async () => {
      try {
        const s = await api.getDemoProjectStatus(workflowId);
        setGenStatus(s as ProjectStatus);
        if (s.phase === 'done') {
          const { files: f } = await api.getDemoProjectFiles(workflowId);
          setFiles(f);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [workflowId, genStatus.phase]);

  // Poll run status
  useEffect(() => {
    if (run.status === 'passed' || run.status === 'failed') return;
    const t = setInterval(async () => {
      try {
        const s = await api.getDemoRunStatus(workflowId);
        setRun(s);
      } catch { /* ignore */ }
    }, 1000);
    return () => clearInterval(t);
  }, [workflowId, run.status]);

  // Auto-scroll terminal
  useEffect(() => {
    if (tab === 'terminal') bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [run.lines.length, tab]);

  // Auto-switch to terminal when run starts
  useEffect(() => {
    if (run.status === 'running') setTab('terminal');
  }, [run.status]);

  // Load file content
  useEffect(() => {
    if (!viewingFile) return;
    api.getDemoProjectFile(workflowId, viewingFile)
      .then(({ content }) => setContent(content))
      .catch(() => setContent('// could not load file'));
  }, [viewingFile, workflowId]);

  const triggerRun = async () => {
    try {
      await api.triggerDemoRun(workflowId);
      setRun({ status: 'running', lines: [], configured: true });
      setTab('terminal');
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to start demo run');
    }
  };

  const isRunning = run.status === 'running';
  const isDone    = run.status === 'passed' || run.status === 'failed';
  const isPassed  = run.status === 'passed';

  const KEY_FILES = ['src/App.tsx', 'e2e/feature.spec.ts', 'package.json', 'README.md'];

  const lineColor = (type: string) => {
    if (type === 'stderr') return 'text-amber-400/80';
    if (type === 'exit') return isPassed ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold';
    return 'text-slate-300';
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-[#0d1117]">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#161b22]">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">
            Demo Project
          </span>

          {/* Status badge */}
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] text-teal-500 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" /> running
            </span>
          )}
          {isPassed && (
            <span className="flex items-center gap-1 text-[10px] text-green-500 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> all tests passed
            </span>
          )}
          {run.status === 'failed' && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> tests failed
            </span>
          )}

          {/* Tabs — only show when there's something to switch between */}
          {(isDone || isRunning) && genStatus.phase === 'done' && (
            <div className="flex gap-0.5 ml-1">
              {(['terminal', 'project'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${tab === t ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Run button — shown when configured and not already running */}
          {run.configured && !isRunning && (
            <button onClick={triggerRun}
              className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-white bg-teal-700 hover:bg-teal-600 px-2.5 py-1 rounded transition-colors">
              ▶ {isDone ? 'Re-run' : 'Run demo'}
            </button>
          )}
          {!run.configured && (
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-600">set DEMO_PROJECT_PATH to enable</span>
          )}
          {genStatus.phase === 'done' && (
            <a href={`/api/workflow/${workflowId}/demo-project/download`}
              className="flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-600 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
              ↓ zip
            </a>
          )}
        </div>
      </div>

      {/* Terminal output */}
      {(tab === 'terminal' || genStatus.phase !== 'done') && (
        <div>
          {/* Generation progress (when not yet done) */}
          {genStatus.phase !== 'done' && genStatus.phase !== 'idle' && (
            <div className="px-4 py-2.5 flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-500 border-b border-slate-800/40">
              <svg className="w-3 h-3 text-teal-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {genStatus.message || PHASE_LABEL[genStatus.phase]}
            </div>
          )}

          {/* Terminal lines */}
          {run.lines.length > 0 ? (
            <div className="px-4 py-3 max-h-72 overflow-y-auto">
              <div className="space-y-px">
                {run.lines.map((l, i) => (
                  <p key={i} className={`text-[11px] font-mono leading-relaxed ${lineColor(l.type)}`}>
                    {l.text}
                  </p>
                ))}
              </div>
              <div ref={bottomRef} />
            </div>
          ) : run.status === 'idle' && run.configured ? (
            <div className="px-4 py-4 text-[11px] font-mono text-slate-600 dark:text-slate-600">
              Press <span className="text-teal-500">Run demo</span> to create a feature branch, write the code, and run Playwright tests.
            </div>
          ) : run.status === 'idle' && !run.configured ? (
            <div className="px-4 py-4 text-[11px] font-mono text-slate-600 dark:text-slate-600">
              Add <code className="text-amber-400">DEMO_PROJECT_PATH=/path/to/tradeeasy-demo</code> to <code>.env</code> to enable live code generation.
            </div>
          ) : null}
        </div>
      )}

      {/* File browser (project tab) */}
      {tab === 'project' && genStatus.phase === 'done' && files.length > 0 && !viewingFile && (
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-600 font-mono mb-2">Files</div>
          <div className="space-y-px">
            {files.filter(f => KEY_FILES.includes(f)).map(f => (
              <button key={f} onClick={() => setViewing(f)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors group">
                <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate">{f}</span>
                <span className="ml-auto text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 font-mono">view →</span>
              </button>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-500 dark:text-slate-600">
            <span className="font-semibold">Run it:</span> npm install && npm run dev
          </div>
        </div>
      )}

      {/* Single file view */}
      {tab === 'project' && viewingFile && (
        <div>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#161b22]">
            <button onClick={() => setViewing(null)} className="text-[10px] font-mono text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">← files</button>
            <span className="text-slate-300 dark:text-slate-700 text-xs">│</span>
            <span className="text-[11px] font-mono text-slate-500">{viewingFile}</span>
          </div>
          <pre className="px-4 py-3 text-[10px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-80 leading-relaxed whitespace-pre-wrap break-all">
            {fileContent}
          </pre>
        </div>
      )}
    </div>
  );
}
