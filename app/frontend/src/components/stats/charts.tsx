import { useState } from 'react';

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
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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
  const midY = (minY + maxY) / 2;
  const range = maxY - minY || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: i * stepX,
    y: height - ((p.y - minY) / range) * (height - 10) - 5,
  }));
  const polylinePoints = coords.map(c => `${c.x},${c.y}`).join(' ');
  const fmt = valueFormat ?? ((v: number) => String(v));

  return (
    <div className="flex">
      <div className="relative flex-shrink-0 w-9 text-right text-[10px] text-surface-400 dark:text-surface-500" style={{ height }}>
        <span className="absolute right-1 -translate-y-1/2" style={{ top: 5 }}>{fmt(maxY)}</span>
        <span className="absolute right-1 -translate-y-1/2" style={{ top: height / 2 }}>{fmt(midY)}</span>
        <span className="absolute right-1 -translate-y-1/2" style={{ top: height - 5 }}>{fmt(minY)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="relative" style={{ height }}>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full absolute inset-0" style={{ height }}>
            <polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
          {/* Dots are plain HTML, not SVG, so they stay round and small — the viewBox's non-uniform
              x/y scaling (preserveAspectRatio="none") would otherwise stretch SVG circles into wide ellipses.
              Each gets an oversized invisible hit area since the visible dot itself is only 4px. */}
          {coords.map((c, i) => (
            <div
              key={i}
              className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-default"
              style={{ left: `${(c.x / width) * 100}%`, top: c.y }}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <div className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
            </div>
          ))}
          {hoverIndex !== null && (
            <div
              className="absolute z-10 -translate-x-1/2 -translate-y-full px-1.5 py-0.5 rounded-md bg-surface-900 dark:bg-surface-700 text-white text-[10px] whitespace-nowrap shadow-lg pointer-events-none"
              style={{ left: `${(coords[hoverIndex].x / width) * 100}%`, top: coords[hoverIndex].y - 6 }}
            >
              {formatWeek(points[hoverIndex].x)} · {fmt(points[hoverIndex].y)}
            </div>
          )}
        </div>
        <div className="flex justify-between text-[10px] text-surface-400 dark:text-surface-500 mt-1">
          <span>{formatWeek(points[0].x)}</span>
          <span>{formatWeek(points[points.length - 1].x)}</span>
        </div>
      </div>
    </div>
  );
}

/** Vertical grouped bars (two series per week) built from plain divs — avoids pulling in a chart library for one chart. */
export function WeeklyBars({ points, height = 130 }: {
  points: Array<{ weekStart: number; started: number; completed: number }>;
  height?: number;
}) {
  if (points.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-xs text-surface-400 dark:text-surface-600">No data yet</div>;
  }
  const max = Math.max(1, ...points.map(p => Math.max(p.started, p.completed)));
  const mid = Math.round(max / 2);
  return (
    <div>
      <div className="flex">
        <div className="relative flex-shrink-0 w-5 text-right text-[10px] text-surface-400 dark:text-surface-500" style={{ height }}>
          <span className="absolute right-1 -translate-y-1/2" style={{ top: 2 }}>{max}</span>
          <span className="absolute right-1 -translate-y-1/2" style={{ top: height / 2 }}>{mid}</span>
          <span className="absolute right-1 -translate-y-1/2" style={{ top: height - 2 }}>0</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-end gap-1.5" style={{ height }}>
            {points.map((p, i) => (
              <div
                key={i}
                className="flex-1 flex items-end justify-center gap-0.5"
                title={`Week of ${formatWeek(p.weekStart)} — started ${p.started}, completed ${p.completed}`}
              >
                <div
                  className="w-1/2 bg-brand-300 dark:bg-brand-700/70 rounded-t"
                  style={{ height: `${(p.started / max) * 100}%`, minHeight: p.started > 0 ? 3 : 0 }}
                />
                <div
                  className="w-1/2 bg-rose-400 dark:bg-rose-600/70 rounded-t"
                  style={{ height: `${(p.completed / max) * 100}%`, minHeight: p.completed > 0 ? 3 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-surface-400 dark:text-surface-500 mt-1">
            <span>{formatWeek(points[0].weekStart)}</span>
            <span>{formatWeek(points[points.length - 1].weekStart)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-surface-500 dark:text-surface-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-brand-300 dark:bg-brand-700/70 inline-block" /> Started</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-400 dark:bg-rose-600/70 inline-block" /> Completed</span>
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
