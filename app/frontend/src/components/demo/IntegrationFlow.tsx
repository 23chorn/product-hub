import type { DemoEvent } from './types';

const STEP_CONFIG: Record<string, { icon: string; color: string; bgColor: string; group: 'airtable' | 'hub' | 'ado' | 'code' }> = {
  demo_started:            { icon: '▶', color: 'text-slate-400', bgColor: 'bg-slate-700', group: 'hub' },
  airtable_webhook:        { icon: '🪝', color: 'text-orange-400', bgColor: 'bg-orange-900/40', group: 'airtable' },
  initiative_parsed:       { icon: '📋', color: 'text-orange-300', bgColor: 'bg-orange-900/30', group: 'airtable' },
  hub_intake:              { icon: '⚙', color: 'text-teal-400', bgColor: 'bg-teal-900/40', group: 'hub' },
  coordinator_analyzing:   { icon: '🧠', color: 'text-teal-300', bgColor: 'bg-teal-900/30', group: 'hub' },
  workflow_started:        { icon: '🚀', color: 'text-teal-200', bgColor: 'bg-teal-900/20', group: 'hub' },
  ado_pipeline_queued:     { icon: '📥', color: 'text-blue-400', bgColor: 'bg-blue-900/40', group: 'ado' },
  ado_pipeline_triggered:  { icon: '▶', color: 'text-blue-300', bgColor: 'bg-blue-900/40', group: 'ado' },
  ado_creating_items:      { icon: '🗂', color: 'text-blue-200', bgColor: 'bg-blue-900/30', group: 'ado' },
  ado_sync_complete:       { icon: '✓', color: 'text-green-400', bgColor: 'bg-green-900/40', group: 'ado' },
  code_generation_start:   { icon: '⌨', color: 'text-purple-400', bgColor: 'bg-purple-900/40', group: 'code' },
  code_generation_complete:{ icon: '✓', color: 'text-purple-300', bgColor: 'bg-purple-900/30', group: 'code' },
  demo_complete:           { icon: '🎉', color: 'text-green-400', bgColor: 'bg-green-900/40', group: 'hub' },
};

const GROUP_LABELS: Record<string, { label: string; color: string }> = {
  airtable: { label: 'Airtable', color: 'text-orange-400' },
  hub:      { label: 'Product Hub', color: 'text-teal-400' },
  ado:      { label: 'Azure DevOps', color: 'text-blue-400' },
  code:     { label: 'Claude Code', color: 'text-purple-400' },
};

function formatTs(ts: number) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function PayloadBadge({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).slice(0, 3);
  if (!entries.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.map(([k, v]) => {
        const raw = String(v);
        const isUrl = typeof v === 'string' && v.startsWith('http');
        const display = Array.isArray(v) ? `[${(v as unknown[]).length}]` : isUrl ? raw : raw.slice(0, 40);
        return (
          <span key={k} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 font-mono">
            <span className="text-slate-500">{k}:</span>
            {isUrl ? (
              <a
                href={raw}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[200px]"
                title={raw}
              >
                {raw.replace(/^https?:\/\//, '').slice(0, 40)}
              </a>
            ) : (
              <span className="text-slate-300">{display}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface Props {
  events: DemoEvent[];
  isRunning: boolean;
  isComplete: boolean;
}

export function IntegrationFlow({ events, isRunning, isComplete }: Props) {
  const displayEvents = events.filter(e => e.type !== 'code_line' && e.type !== 'connected');

  let lastGroup = '';

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-xl overflow-hidden border border-slate-700/60">
      {/* Header */}
      <div className="px-4 py-3 bg-[#161b22] border-b border-slate-700/60">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Integration Flow</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Airtable → Product Hub → Azure DevOps</p>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && !isComplete && (
              <span className="flex items-center gap-1.5 text-[10px] text-teal-400">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                Live
              </span>
            )}
            {isComplete && (
              <span className="text-[10px] text-green-400">Complete</span>
            )}
          </div>
        </div>
      </div>

      {/* Event stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {displayEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-10">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-2xl">🔌</div>
            <div>
              <p className="text-sm font-medium text-slate-300">Ready to demo</p>
              <p className="text-xs text-slate-500 mt-1">Click "Run Demo" to simulate the full integration flow</p>
            </div>
          </div>
        )}

        {displayEvents.map((event, i) => {
          const cfg = STEP_CONFIG[event.type] ?? { icon: '●', color: 'text-slate-400', bgColor: 'bg-slate-700', group: 'hub' };
          const group = GROUP_LABELS[cfg.group];
          const showGroupLabel = cfg.group !== lastGroup;
          if (showGroupLabel) lastGroup = cfg.group;

          return (
            <div key={i}>
              {showGroupLabel && (
                <div className={`text-[9px] font-semibold uppercase tracking-widest ${group.color} px-2 py-1 mt-1`}>
                  {group.label}
                </div>
              )}
              <div className="flex gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/40 transition-colors group">
                {/* Icon */}
                <div className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs ${cfg.bgColor}`}>
                  <span className={cfg.color}>{cfg.icon}</span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-200 leading-tight">{event.label}</span>
                    <span className="flex-shrink-0 text-[9px] text-slate-600 font-mono">{formatTs(event.timestamp)}</span>
                  </div>
                  {event.payload && <PayloadBadge payload={event.payload as Record<string, unknown>} />}
                </div>
              </div>
            </div>
          );
        })}

        {isRunning && !isComplete && (
          <div className="flex gap-2.5 px-2 py-2">
            <div className="flex-shrink-0 w-6 h-6 rounded bg-slate-700 flex items-center justify-center">
              <svg className="w-3 h-3 text-teal-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <div className="flex items-center">
              <span className="text-xs text-slate-500 animate-pulse">Processing…</span>
            </div>
          </div>
        )}
      </div>

      {/* Footer stats */}
      {displayEvents.length > 0 && (
        <div className="px-4 py-2 bg-[#161b22] border-t border-slate-700/40 flex items-center justify-between text-[10px] text-slate-500">
          <span>{displayEvents.length} events</span>
          <div className="flex gap-2">
            {Object.entries(GROUP_LABELS).map(([key, { label, color }]) => {
              const count = displayEvents.filter(e => (STEP_CONFIG[e.type]?.group ?? 'hub') === key).length;
              if (!count) return null;
              return (
                <span key={key} className={`${color} opacity-70`}>{label} ×{count}</span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
