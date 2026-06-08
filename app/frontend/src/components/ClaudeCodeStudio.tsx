import { useState, useEffect, useRef } from 'react';
import { useWorkflowStore } from '../stores/workflowStore';

interface Props {
  workflowId: string;
  onClose: () => void;
}

interface WsEvent {
  type: string;
  label?: string;
  line?: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export function ClaudeCodeStudio({ workflowId, onClose }: Props) {
  const { studioOutput, appendStudioLines, clearStudioOutput } = useWorkflowStore();
  const outputLines = studioOutput[workflowId] ?? [];
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [backlogSummary, setBacklogSummary] = useState('');
  const [adoTickets, setAdoTickets] = useState('');
  const [cwd, setCwd] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [outputLines.length]);

  // WS connection — auto-start coding on connect
  useEffect(() => {
    const wsUrl = `ws://${window.location.hostname}:3001/ws/ai-coding?workflowId=${encodeURIComponent(workflowId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      // Only start if no output yet — if returning to a completed session, just reload context
      const existing = useWorkflowStore.getState().studioOutput[workflowId];
      if (!existing || existing.length === 0) {
        ws.send(JSON.stringify({ action: 'start_coding', workflowId }));
      }
    };

    ws.onerror = () => setWsStatus('error');
    ws.onclose = () => {
      if (!isRunning && !isComplete) setWsStatus('error');
    };

    ws.onmessage = (e) => {
      try {
        const event: WsEvent = JSON.parse(e.data);

        if (event.type === 'connected' && event.payload) {
          const p = event.payload;
          if (p.title) setTitle(p.title as string);
          if (p.goal) setGoal(p.goal as string);
          if (p.backlogSummary) setBacklogSummary(p.backlogSummary as string);
          if (p.adoTickets) setAdoTickets(p.adoTickets as string);
          if (p.cwd) setCwd(p.cwd as string);
          return;
        }

        if (event.type === 'session_started') {
          setIsRunning(true);
          const sessionCwd = (event.payload?.cwd as string | undefined) || cwd;
          const shortCwd = sessionCwd ? sessionCwd.split('/').slice(-2).join('/') : '';
          clearStudioOutput(workflowId);
          appendStudioLines(workflowId, [
            `${shortCwd ? shortCwd + ' ' : ''}$ claude --print --allowedTools Read,Bash,Glob,Grep`,
            '',
          ]);
          return;
        }

        if (event.type === 'output' && event.line !== undefined) {
          appendStudioLines(workflowId, [event.line!]);
          return;
        }

        if (event.type === 'session_complete') {
          setIsRunning(false);
          setIsComplete(true);
          appendStudioLines(workflowId, ['', '─── session complete ───']);
          return;
        }
      } catch { /* ignore */ }
    };

    return () => { ws.close(); };
  }, [workflowId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d1117] font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-slate-700/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-slate-300 tracking-wide">Claude Code Studio</span>
          {cwd && (
            <span className="text-[10px] text-slate-600 font-mono">
              {cwd.split('/').slice(-3).join('/')}
            </span>
          )}
          {wsStatus === 'connecting' && (
            <span className="text-[10px] text-slate-600">connecting…</span>
          )}
          {wsStatus === 'connected' && isRunning && (
            <span className="flex items-center gap-1.5 text-[10px] text-teal-400">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
              running
            </span>
          )}
          {isComplete && (
            <span className="flex items-center gap-1.5 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              complete
            </span>
          )}
          {wsStatus === 'error' && (
            <span className="text-[10px] text-red-400">connection error</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[11px] text-slate-600 hover:text-slate-300 transition-colors px-2 py-1"
        >
          ✕ close
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left pane: ticket context */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-slate-800/60 bg-[#0d1117]">
          <div className="px-3 py-2 border-b border-slate-800/40">
            <span className="text-[9px] uppercase tracking-widest text-slate-600">ticket context</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 text-[11px]">
            {title ? (
              <>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">feature</p>
                  <p className="text-slate-300 font-semibold leading-snug">{title}</p>
                </div>

                {adoTickets && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">azure tickets</p>
                    <pre className="text-[10px] leading-relaxed text-slate-400 whitespace-pre-wrap font-mono">
                      {adoTickets}
                    </pre>
                  </div>
                )}

                {goal && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">brief</p>
                    <p className="text-slate-500 leading-relaxed whitespace-pre-wrap text-[10px]">
                      {goal.slice(0, 400)}{goal.length > 400 ? '…' : ''}
                    </p>
                  </div>
                )}

                {backlogSummary && (
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-1">stories</p>
                    <pre className="text-slate-500 text-[10px] leading-relaxed whitespace-pre-wrap">
                      {backlogSummary}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-24">
                <span className="text-slate-700 text-[10px]">loading context…</span>
              </div>
            )}
          </div>
        </div>

        {/* Right pane: terminal */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#0d1117]">
          <div className="px-3 py-2 border-b border-slate-800/40 flex-shrink-0">
            <span className="text-[9px] uppercase tracking-widest text-slate-600">terminal</span>
          </div>
          <div
            ref={terminalRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-0"
          >
            {outputLines.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-700 text-[11px] mt-4">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-700 animate-pulse" />
                {wsStatus === 'connecting' ? 'connecting to Claude Code…' : 'starting session…'}
              </div>
            ) : (
              outputLines.map((line, i) => (
                <div
                  key={i}
                  className={`text-[11px] leading-relaxed font-mono whitespace-pre-wrap ${
                    line.startsWith('$') || line.startsWith('>')
                      ? 'text-teal-400'
                      : line.startsWith('[')
                      ? 'text-slate-600'
                      : line.startsWith('─')
                      ? 'text-slate-700'
                      : 'text-slate-300'
                  }`}
                >
                  {line || ' '}
                </div>
              ))
            )}
            {isRunning && (
              <div className="flex items-center gap-1 text-teal-400 text-[11px] mt-1">
                <span className="animate-pulse">█</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
