import { useState } from 'react';

interface TechRefinement {
  storyId: string;
  title: string;
  type: string;
  priority: string;
  description: string;
  technicalNotes?: string;
  estimatedEffort?: number;
  acceptanceCriteria?: string[];
}

interface TechRefinementData {
  techRefinements: TechRefinement[];
}

export function tryParseTechRefinement(content: string): TechRefinementData | null {
  try {
    const stripped = content
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim();
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed.techRefinements)) return parsed as TechRefinementData;
    return null;
  } catch {
    return null;
  }
}

const TYPE_CONFIG: Record<string, { color: string; dot: string }> = {
  infrastructure: { color: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300', dot: 'bg-slate-400' },
  backend:        { color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',   dot: 'bg-blue-400' },
  frontend:       { color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', dot: 'bg-purple-400' },
  devops:         { color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', dot: 'bg-orange-400' },
  security:       { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',       dot: 'bg-red-400' },
  data:           { color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',   dot: 'bg-teal-400' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-semibold' },
  high:     { label: 'High',     color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  medium:   { label: 'Medium',   color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  low:      { label: 'Low',      color: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' },
};

function RefinementCard({ item }: { item: TechRefinement }) {
  const [open, setOpen] = useState(false);
  const typeConf = TYPE_CONFIG[item.type] ?? { color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
  const prioConf = PRIORITY_CONFIG[item.priority] ?? { label: item.priority, color: 'bg-slate-100 text-slate-500' };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
      >
        <div className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${typeConf.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{item.storyId}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${prioConf.color}`}>{prioConf.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeConf.color}`}>{item.type}</span>
            {item.estimatedEffort !== undefined && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                {item.estimatedEffort} pt{item.estimatedEffort !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-800 dark:text-slate-200 mt-0.5 leading-snug">{item.title}</p>
        </div>
        <svg className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30 text-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Description</p>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{item.description}</p>
          </div>

          {item.technicalNotes && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Technical Notes</p>
              <div className="rounded bg-slate-800 dark:bg-slate-900 border border-slate-700 p-2.5 font-mono text-xs text-slate-300">
                {item.technicalNotes}
              </div>
            </div>
          )}

          {item.acceptanceCriteria && item.acceptanceCriteria.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Acceptance Criteria</p>
              <ul className="space-y-1">
                {item.acceptanceCriteria.map((ac, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <span className="text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5">✓</span>
                    <span>{ac}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TechRefinementView({ data }: { data: TechRefinementData }) {
  const items = data.techRefinements;

  // Group by type
  const typeOrder = ['infrastructure', 'backend', 'frontend', 'devops', 'security', 'data'];
  const grouped = typeOrder.reduce<Record<string, TechRefinement[]>>((acc, t) => {
    acc[t] = items.filter(i => i.type === t);
    return acc;
  }, {});
  const other = items.filter(i => !typeOrder.includes(i.type));

  const totalEffort = items.reduce((sum, i) => sum + (i.estimatedEffort ?? 0), 0);
  const criticalCount = items.filter(i => i.priority === 'critical').length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Tech Refinement</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{items.length} technical tasks</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2.5 text-center">
          <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{items.length}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide mt-0.5">Total tasks</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2.5 text-center">
          <p className="text-xl font-bold text-red-700 dark:text-red-400">{criticalCount}</p>
          <p className="text-[10px] text-red-500 dark:text-red-500 uppercase tracking-wide mt-0.5">Critical</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2.5 text-center">
          <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{totalEffort}</p>
          <p className="text-[10px] text-blue-500 dark:text-blue-500 uppercase tracking-wide mt-0.5">Story pts</p>
        </div>
      </div>

      {/* Grouped by type */}
      {typeOrder.map(type => {
        const group = grouped[type];
        if (!group || group.length === 0) return null;
        const conf = TYPE_CONFIG[type];
        return (
          <div key={type}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
              {type}
              <span className="font-normal text-slate-400">({group.length})</span>
            </h3>
            <div className="space-y-2">
              {group.map(item => <RefinementCard key={item.storyId} item={item} />)}
            </div>
          </div>
        );
      })}

      {other.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Other ({other.length})</h3>
          <div className="space-y-2">
            {other.map(item => <RefinementCard key={item.storyId} item={item} />)}
          </div>
        </div>
      )}
    </div>
  );
}
