import { useEffect, useRef } from 'react';

interface Props {
  lines: string[];
  isComplete: boolean;
  currentFile: string;
}

const KEYWORD_COLORS: [RegExp, string][] = [
  [/\b(import|export|from|class|extends|implements|interface|type|const|let|var|async|await|return|new|this|private|public|protected|readonly|override)\b/g, 'text-purple-400'],
  [/\b(true|false|null|undefined|void)\b/g, 'text-orange-400'],
  [/\b(string|number|boolean|Promise|Map|Date|EventEmitter)\b/g, 'text-cyan-400'],
  [/(`[^`]*`|'[^']*'|"[^"]*")/g, 'text-green-400'],
  [/(\/\/.*)/g, 'text-slate-500 italic'],
];

function highlightLine(raw: string): React.ReactNode {
  if (!raw.trim()) return <>&nbsp;</>;

  const parts: Array<{ text: string; color?: string }> = [{ text: raw }];

  // simple single-pass highlight: apply first matching rule per segment
  for (const [re, color] of KEYWORD_COLORS) {
    const next: typeof parts = [];
    for (const part of parts) {
      if (part.color) { next.push(part); continue; }
      const segments = part.text.split(re);
      const matches = part.text.match(re) ?? [];
      segments.forEach((seg, i) => {
        if (seg) next.push({ text: seg });
        if (matches[i]) next.push({ text: matches[i], color });
      });
    }
    parts.splice(0, parts.length, ...next);
  }

  return (
    <>
      {parts.map((p, i) =>
        p.color
          ? <span key={i} className={p.color}>{p.text}</span>
          : <span key={i} className="text-slate-200">{p.text}</span>
      )}
    </>
  );
}

export function ClaudeCodeWindow({ lines, isComplete, currentFile }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-xl overflow-hidden border border-slate-700/60 shadow-2xl font-mono text-xs">
      {/* Title bar */}
      <div className="flex items-center justify-center px-4 py-2.5 bg-[#161b22] border-b border-slate-700/60">
        <span className="text-slate-400 text-[10px]">Claude Code</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center bg-[#0d1117] border-b border-slate-700/40 px-3 pt-1">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#161b22] border border-b-0 border-slate-600/40 rounded-t text-[10px] text-slate-300">
          <svg className="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {currentFile || 'PriceAlertService.ts'}
          {!isComplete && (
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse ml-1" />
          )}
        </div>
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-y-auto p-4 leading-5">
        {lines.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-500 pt-2">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Waiting for code generation…</span>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="select-none w-8 text-right text-slate-600 mr-4 flex-shrink-0">
                {i + 1}
              </span>
              <span className="whitespace-pre flex-1">{highlightLine(line)}</span>
            </div>
          ))
        )}
        {!isComplete && lines.length > 0 && (
          <div className="flex">
            <span className="select-none w-8 mr-4 flex-shrink-0" />
            <span className="inline-block w-2 h-3.5 bg-teal-400 animate-pulse" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 bg-[#1f2937] border-t border-slate-700/40 text-[10px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            {isComplete
              ? <span className="text-green-400">✓ Generation complete</span>
              : <><span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" /> Generating…</>
            }
          </span>
          <span>TypeScript</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Ln {lines.length}, Col 1</span>
          <span className="flex items-center gap-1 text-purple-400">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Claude Code
          </span>
        </div>
      </div>
    </div>
  );
}
