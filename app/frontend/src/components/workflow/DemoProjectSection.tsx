import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';

interface RunLine { type: string; text: string; ts: number }

interface RunStatus {
  status: 'idle' | 'running' | 'passed' | 'failed';
  lines: RunLine[];
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
  configured: boolean;
}

interface Props { workflowId: string }

export function DemoProjectSection({ workflowId }: Props) {
  const [run, setRun] = useState<RunStatus>({ status: 'idle', lines: [], configured: false });
  const bottomRef    = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [run.lines.length]);

  const triggerRun = async () => {
    try {
      await api.triggerDemoRun(workflowId);
      setRun({ status: 'running', lines: [], configured: true });
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to start demo run');
    }
  };

  const isRunning = run.status === 'running';
  const isDone    = run.status === 'passed' || run.status === 'failed';
  const isPassed  = run.status === 'passed';

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
            Demo Pipeline
          </span>
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] text-teal-500 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" /> running
            </span>
          )}
          {isPassed && (
            <span className="flex items-center gap-1 text-[10px] text-green-500 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> passed
            </span>
          )}
          {run.status === 'failed' && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> failed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {run.configured && !isRunning && (
            <button onClick={triggerRun}
              className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-white bg-teal-700 hover:bg-teal-600 px-2.5 py-1 rounded transition-colors">
              ▶ {isDone ? 'Re-run' : 'Run demo'}
            </button>
          )}
          {!run.configured && (
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-600">
              set DEMO_PROJECT_PATH to enable
            </span>
          )}
        </div>
      </div>

      {/* Terminal */}
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
      ) : run.configured ? (
        <div className="px-4 py-4 text-[11px] font-mono text-slate-600 dark:text-slate-600">
          Press <span className="text-teal-500">Run demo</span> to create a feature branch, write the code with Claude, and run Playwright tests.
        </div>
      ) : (
        <div className="px-4 py-4 text-[11px] font-mono text-slate-600 dark:text-slate-600">
          Add <code className="text-amber-400">DEMO_PROJECT_PATH=/path/to/tradeeasy-demo</code> to <code>.env</code> to enable live code generation.
        </div>
      )}
    </div>
  );
}
