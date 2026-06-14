import { useEffect, useMemo } from 'react';

/** Read-only preview card rendering a single tool definition's schema. */
function ToolPreviewCard({ tool }: { tool: any }) {
  const props = Object.entries<any>(tool.input_schema?.properties ?? {});
  const required = new Set<string>(tool.input_schema?.required ?? []);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-3 py-2 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <span className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">
          {tool.name ?? <span className="text-red-400 italic">unnamed</span>}
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-2.5 bg-slate-50 dark:bg-slate-900/40">
        {tool.description && (
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{tool.description}</p>
        )}
        {props.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">Parameters</p>
            <div className="space-y-1.5">
              {props.map(([name, schema]) => (
                <div key={name} className="flex items-start gap-2 text-xs flex-wrap">
                  <code className="flex-shrink-0 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-teal-600 dark:text-teal-400">{name}</code>
                  <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 self-center">{schema.type}</span>
                  {required.has(name) && (
                    <span className="flex-shrink-0 px-1.5 py-0 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">required</span>
                  )}
                  {schema.description && (
                    <span className="text-slate-500 dark:text-slate-400 leading-relaxed">{schema.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** JSON source editor for tool definitions with a live parsed preview. */
export function JsonToolEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = useMemo<any[] | null>(() => {
    if (!value.trim()) return [];
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : null; }
    catch { return null; }
  }, [value]);

  const format = () => {
    try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch {}
  };

  useEffect(() => {
    if (value.trim()) { try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full gap-2">
      <div className="w-1/2 h-full flex flex-col gap-1.5">
        <div className="flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-400 dark:text-slate-500">JSON source</span>
          <button
            onClick={format}
            className="text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Format
          </button>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          placeholder={'[\n  {\n    "name": "my_tool",\n    "description": "When to call it…",\n    "input_schema": {\n      "type": "object",\n      "properties": {\n        "param": { "type": "string", "description": "…" }\n      },\n      "required": ["param"]\n    }\n  }\n]'}
        />
      </div>
      <div className="w-1/2 h-full flex flex-col gap-1.5">
        <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">Preview</span>
        <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3 space-y-3">
          {parsed === null ? (
            <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-medium">Invalid JSON</span>
            </div>
          ) : parsed.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">No tools defined yet.</p>
          ) : (
            parsed.map((tool: any, i: number) => <ToolPreviewCard key={tool.name ?? i} tool={tool} />)
          )}
        </div>
      </div>
    </div>
  );
}
