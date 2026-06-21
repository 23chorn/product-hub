export function formatWeek(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface SparklinePoint { x: number; y: number }

/** Minimal responsive SVG trend line — no charting dependency needed for this few data points. */
export function Sparkline({ points, color = 'rgb(var(--brand-600))', height = 70, valueFormat }: {
  points: SparklinePoint[];
  color?: string;
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  if (points.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-xs text-surface-400 dark:text-surface-600">No data yet</div>;
  }
  if (points.length === 1) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-surface-600 dark:text-surface-300">
        {valueFormat ? valueFormat(points[0].y) : points[0].y}
      </div>
    );
  }

  const width = 100;
  const ys = points.map(p => p.y);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, minY + 1);
  const range = maxY - minY || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: i * stepX,
    y: height - ((p.y - minY) / range) * (height - 10) - 5,
  }));
  const polylinePoints = coords.map(c => `${c.x},${c.y}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={1.8} fill={color}>
            <title>{valueFormat ? valueFormat(points[i].y) : String(points[i].y)}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-surface-400 dark:text-surface-500 mt-1">
        <span>{formatWeek(points[0].x)}</span>
        <span>{formatWeek(points[points.length - 1].x)}</span>
      </div>
    </div>
  );
}

/** Vertical grouped bars (two series per week) built from plain divs — avoids pulling in a chart library for one chart. */
export function WeeklyBars({ points, height = 110 }: {
  points: Array<{ weekStart: number; started: number; completed: number }>;
  height?: number;
}) {
  if (points.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-xs text-surface-400 dark:text-surface-600">No data yet</div>;
  }
  const max = Math.max(1, ...points.map(p => Math.max(p.started, p.completed)));
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {points.map((p, i) => (
          <div
            key={i}
            className="flex-1 flex items-end justify-center gap-0.5"
            title={`Week of ${formatWeek(p.weekStart)} — started ${p.started}, completed ${p.completed}`}
          >
            <div
              className="w-1/2 bg-brand-300 dark:bg-brand-700/70 rounded-t"
              style={{ height: `${(p.started / max) * 100}%`, minHeight: p.started > 0 ? 2 : 0 }}
            />
            <div
              className="w-1/2 bg-violet-400 dark:bg-violet-600/70 rounded-t"
              style={{ height: `${(p.completed / max) * 100}%`, minHeight: p.completed > 0 ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-surface-400 dark:text-surface-500 mt-1">
        <span>{formatWeek(points[0].weekStart)}</span>
        <span>{formatWeek(points[points.length - 1].weekStart)}</span>
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-surface-500 dark:text-surface-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-brand-300 dark:bg-brand-700/70 inline-block" /> Started</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-400 dark:bg-violet-600/70 inline-block" /> Completed</span>
      </div>
    </div>
  );
}

/** Horizontal bar list — used for per-stage breakdowns (durations, approval rates). */
export function HorizontalBarList({ items, color = 'bg-brand-500', valueFormat, emptyLabel = 'No data yet' }: {
  items: Array<{ label: string; value: number; sublabel?: string }>;
  color?: string;
  valueFormat?: (v: number) => string;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-surface-400 dark:text-surface-600 py-3">{emptyLabel}</div>;
  }
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex items-baseline justify-between text-xs mb-1 gap-2">
            <span className="font-medium text-surface-700 dark:text-surface-300 truncate">{item.label}</span>
            <span className="text-surface-500 dark:text-surface-400 flex-shrink-0">
              {valueFormat ? valueFormat(item.value) : item.value}{item.sublabel ? ` · ${item.sublabel}` : ''}
            </span>
          </div>
          <div className="h-1.5 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
            <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
