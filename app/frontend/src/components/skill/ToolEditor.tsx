import { useState, useEffect, useRef } from 'react';

const PARAM_TYPES = ['string', 'number', 'boolean', 'array', 'object'];

interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  params: ToolParam[];
}

function parseTools(json: string): ToolDef[] {
  if (!json.trim()) return [];
  try {
    const stripped = json.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(stripped);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t: any) => ({
      name: t.name ?? '',
      description: t.description ?? '',
      params: Object.entries<any>(t.input_schema?.properties ?? {}).map(([name, schema]) => ({
        name,
        type: schema.type ?? 'string',
        description: schema.description ?? '',
        required: (t.input_schema?.required ?? []).includes(name),
      })),
    }));
  } catch {
    return [];
  }
}

function serializeTools(tools: ToolDef[]): string {
  if (tools.length === 0) return '';
  return JSON.stringify(
    tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          t.params.map(p => [p.name, { type: p.type, description: p.description }])
        ),
        required: t.params.filter(p => p.required).map(p => p.name),
      },
    })),
    null,
    2
  );
}

/** Shared read-only card rendering a single tool definition — used in editor preview and ToolViewer. */
export function ToolPreviewCard({ tool }: { tool: any }) {
  const props = Object.entries<any>(tool.input_schema?.properties ?? {});
  const required = new Set<string>(tool.input_schema?.required ?? []);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-3 py-2.5 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <span className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">
          {tool.name ?? <span className="text-red-400 italic">unnamed</span>}
        </span>
        {tool.description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{tool.description}</p>
        )}
      </div>
      {props.length > 0 && (
        <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900/40">
          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Parameters</p>
          <div className="space-y-1.5">
            {props.map(([name, schema]) => (
              <div key={name} className="flex items-start gap-2 text-xs flex-wrap">
                <code className="flex-shrink-0 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-teal-600 dark:text-teal-400">{name}</code>
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{schema.type}</span>
                {required.has(name) && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">required</span>
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
  );
}

const inputCls = 'w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-slate-400';

/** Form-based tool definition editor. Serializes to the same JSON schema on every change. */
export function JsonToolEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  const [tools, setTools] = useState<ToolDef[]>(() => parseTools(value));
  const lastSerialized = useRef(serializeTools(parseTools(value)));

  useEffect(() => {
    const parsed = parseTools(value);
    const serialized = serializeTools(parsed);
    if (serialized !== lastSerialized.current) {
      setTools(parsed);
      lastSerialized.current = serialized;
    }
  }, [value]);

  function commit(newTools: ToolDef[]) {
    const serialized = serializeTools(newTools);
    lastSerialized.current = serialized;
    setTools(newTools);
    onChange(serialized);
  }

  function addTool() {
    commit([...tools, { name: '', description: '', params: [] }]);
  }

  function removeTool(ti: number) {
    commit(tools.filter((_, i) => i !== ti));
  }

  function updateTool(ti: number, patch: Partial<ToolDef>) {
    commit(tools.map((t, i) => (i === ti ? { ...t, ...patch } : t)));
  }

  function addParam(ti: number) {
    commit(
      tools.map((t, i) =>
        i === ti
          ? { ...t, params: [...t.params, { name: '', type: 'string', description: '', required: false }] }
          : t
      )
    );
  }

  function removeParam(ti: number, pi: number) {
    commit(tools.map((t, i) => (i === ti ? { ...t, params: t.params.filter((_, j) => j !== pi) } : t)));
  }

  function updateParam(ti: number, pi: number, patch: Partial<ToolParam>) {
    commit(
      tools.map((t, i) =>
        i === ti ? { ...t, params: t.params.map((p, j) => (j === pi ? { ...p, ...patch } : p)) } : t
      )
    );
  }

  if (readOnly) {
    const raw = (() => {
      try {
        const p = JSON.parse(value);
        return Array.isArray(p) ? p : null;
      } catch {
        return null;
      }
    })();
    if (!value.trim()) return <p className="text-xs text-slate-400 italic">No tools defined.</p>;
    if (raw === null) return <p className="text-xs text-red-400">Invalid JSON</p>;
    return (
      <div className="h-full overflow-y-auto space-y-3 pr-1">
        {raw.map((tool: any, i: number) => (
          <ToolPreviewCard key={tool.name ?? i} tool={tool} />
        ))}
      </div>
    );
  }

  const XIcon = () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  return (
    <div className="h-full overflow-y-auto space-y-3 pr-1">
      {tools.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic py-2">
          No tools defined yet. Add one below.
        </p>
      )}

      {tools.map((tool, ti) => (
        <div key={ti} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Tool name row */}
          <div className="px-3 py-2 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <input
              value={tool.name}
              onChange={(e) => updateTool(ti, { name: e.target.value })}
              placeholder="tool_name"
              className="flex-1 px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-600 bg-transparent text-teal-700 dark:text-teal-300 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:font-normal placeholder:text-slate-400"
            />
            <button
              onClick={() => removeTool(ti)}
              className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="Remove tool"
            >
              <XIcon />
            </button>
          </div>

          <div className="px-3 py-3 bg-slate-50 dark:bg-slate-900/40 space-y-3">
            {/* Description */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                Description
              </label>
              <input
                value={tool.description}
                onChange={(e) => updateTool(ti, { description: e.target.value })}
                placeholder="When should the agent call this tool?"
                className={inputCls}
              />
            </div>

            {/* Parameters */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                  Parameters
                </label>
                <button
                  onClick={() => addParam(ti)}
                  className="text-[10px] px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors font-medium"
                >
                  + Add param
                </button>
              </div>

              {tool.params.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">No parameters.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_88px_1fr_58px_16px] gap-1.5 px-0.5">
                    {['Name', 'Type', 'Description', 'Required', ''].map((h) => (
                      <span key={h} className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                        {h}
                      </span>
                    ))}
                  </div>
                  {tool.params.map((param, pi) => (
                    <div key={pi} className="grid grid-cols-[1fr_88px_1fr_58px_16px] gap-1.5 items-center">
                      <input
                        value={param.name}
                        onChange={(e) => updateParam(ti, pi, { name: e.target.value })}
                        placeholder="param_name"
                        className={`${inputCls} font-mono`}
                      />
                      <select
                        value={param.type}
                        onChange={(e) => updateParam(ti, pi, { type: e.target.value })}
                        className={inputCls}
                      >
                        {PARAM_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <input
                        value={param.description}
                        onChange={(e) => updateParam(ti, pi, { description: e.target.value })}
                        placeholder="What this param does"
                        className={inputCls}
                      />
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={param.required}
                          onChange={(e) => updateParam(ti, pi, { required: e.target.checked })}
                          className="rounded border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500"
                        />
                      </div>
                      <button
                        onClick={() => removeParam(ti, pi)}
                        className="p-0.5 rounded text-slate-400 hover:text-red-500 transition-colors"
                        title="Remove parameter"
                      >
                        <XIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addTool}
        className="w-full py-2.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400 hover:border-teal-400 dark:hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-50/50 dark:hover:bg-teal-900/10 transition-colors font-medium"
      >
        + Add tool
      </button>
    </div>
  );
}
