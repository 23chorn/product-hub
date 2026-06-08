import { useState, useEffect, useRef, useCallback } from 'react';
import { IntegrationFlow } from './demo/IntegrationFlow';
import { ClaudeCodeWindow } from './demo/ClaudeCodeWindow';
import type { DemoEvent } from './demo/types';

const WS_URL = `ws://${window.location.hostname}:3001/ws/demo`;

interface Props {
  onClose: () => void;
}

export function DemoShowcasePanel({ onClose }: Props) {
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [codeLines, setCodeLines] = useState<string[]>([]);
  const [codeFile, setCodeFile] = useState('PriceAlertService.ts');
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setWsStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onerror = () => setWsStatus('disconnected');

    ws.onmessage = (evt) => {
      try {
        const event: DemoEvent = JSON.parse(evt.data);

        if (event.type === 'code_line') {
          setCodeLines(prev => [...prev, event.label]);
          return;
        }

        if (event.type === 'code_generation_start') {
          const file = (event.payload as any)?.file;
          if (file) setCodeFile(file.split('/').pop() ?? file);
          setCodeLines([]);
        }

        if (event.type === 'demo_complete') {
          setIsComplete(true);
          setIsRunning(false);
        }

        setEvents(prev => [...prev, event]);
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const handleRun = () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      connect();
      return;
    }
    setEvents([]);
    setCodeLines([]);
    setIsComplete(false);
    setIsRunning(true);
    wsRef.current.send(JSON.stringify({ action: 'trigger_demo' }));
  };

  const handleReset = () => {
    setEvents([]);
    setCodeLines([]);
    setIsComplete(false);
    setIsRunning(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 rounded-xl overflow-hidden border border-slate-700/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900/80 border-b border-slate-700/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🚀</span>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Integration Demo</h2>
              <p className="text-[10px] text-slate-500 mt-0">Airtable webhook → Product Hub → Azure DevOps + Claude Code</p>
            </div>
          </div>

          {/* WS status indicator */}
          <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
            wsStatus === 'connected'
              ? 'bg-green-900/30 border-green-700/40 text-green-400'
              : wsStatus === 'connecting'
              ? 'bg-yellow-900/30 border-yellow-700/40 text-yellow-400'
              : 'bg-red-900/30 border-red-700/40 text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              wsStatus === 'connected' ? 'bg-green-400 animate-pulse'
              : wsStatus === 'connecting' ? 'bg-yellow-400 animate-pulse'
              : 'bg-red-400'
            }`} />
            {wsStatus === 'connected' ? 'WS Connected' : wsStatus === 'connecting' ? 'Connecting…' : 'WS Disconnected'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isComplete && (
            <button
              onClick={handleReset}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300 transition-colors"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={isRunning && !isComplete}
            className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors shadow-sm"
          >
            {isRunning && !isComplete ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Running…
              </>
            ) : (
              <>▶ Run Demo</>
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
            title="Close demo"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scenario badge */}
      <div className="flex-shrink-0 bg-slate-900/40 border-b border-slate-700/40 px-5 py-2">
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="font-semibold text-slate-400">Scenario:</span>
          <span className="px-2 py-0.5 rounded bg-orange-900/30 text-orange-300 border border-orange-700/30">
            Airtable record.created
          </span>
          <span className="text-slate-600">→</span>
          <span className="px-2 py-0.5 rounded bg-teal-900/30 text-teal-300 border border-teal-700/30">
            Product Hub workflow
          </span>
          <span className="text-slate-600">→</span>
          <span className="px-2 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-700/30">
            ADO pipeline #4821
          </span>
          <span className="text-slate-600">+</span>
          <span className="px-2 py-0.5 rounded bg-purple-900/30 text-purple-300 border border-purple-700/30">
            Claude Code generation
          </span>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-3 min-h-0 overflow-hidden">
        {/* Left: Integration flow */}
        <IntegrationFlow
          events={events}
          isRunning={isRunning}
          isComplete={isComplete}
        />

        {/* Right: Claude Code window */}
        <ClaudeCodeWindow
          lines={codeLines}
          isComplete={isComplete || (codeLines.length > 0 && events.some(e => e.type === 'code_generation_complete'))}
          currentFile={codeFile}
        />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-5 py-2 bg-slate-900/60 border-t border-slate-700/40 flex items-center justify-between text-[10px] text-slate-600">
        <span>Mock demo — no live API calls made</span>
        <span className="flex items-center gap-1.5">
          <span>WebSocket</span>
          <span className="text-slate-700">·</span>
          <span>ws://localhost:3001/ws/demo</span>
        </span>
      </div>
    </div>
  );
}
