import { STAGE_LABELS } from '../../constants/stage-labels';
import type { StageStatus } from '../../stores/workflowStore';
import { AgentAnimation } from './AgentAnimation';

// ── Props ────────────────────────────────────────────────────────────────────

interface StageRowProps {
  stageName: string;
  status: StageStatus;
  customLabel?: string; // Override default stage label (e.g., "F1 — Checkout Flow")
  /** Scrolls the event log to this stage's section. Only wired up once the stage has started. */
  onSelect?: () => void;
  /** Box-drawing prefix from buildRoadmapTree (e.g. "├─ ", "│  └─ "), or '' for a flat row. */
  treePrefix?: string;
  /** Small inline tag next to the label (e.g. "wave 2") — used to surface a feature's
   *  parallel-refinement wave without letting it dictate the row's position in the tree
   *  (features stay grouped by phase; wave order is annotation only). */
  badge?: string;
}

// ── Status icon ───────────────────────────────────────────────────────────────

export function StatusIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'complete':
      return <span className="text-green-600 dark:text-green-500 text-xs leading-none select-none">✓</span>;
    case 'in-progress':
      return <span className="text-brand-600 dark:text-brand-400 text-xs leading-none select-none animate-pulse">▶</span>;
    case 'at-checkpoint':
      return <span className="text-amber-600 dark:text-amber-400 text-xs leading-none select-none animate-pulse">⏸</span>;
    case 'rejected':
      return <span className="text-red-600 dark:text-red-500 text-xs leading-none select-none">✕</span>;
    case 'skipped':
      return <span className="text-surface-400 dark:text-surface-700 text-xs leading-none select-none">─</span>;
    default:
      return <span className="text-surface-400 dark:text-surface-700 text-xs leading-none select-none">○</span>;
  }
}

// ── Label color ───────────────────────────────────────────────────────────────

export function labelColor(status: StageStatus): string {
  switch (status) {
    case 'complete':    return 'text-surface-500 dark:text-surface-400';
    case 'in-progress': return 'text-brand-600 dark:text-brand-300';
    case 'at-checkpoint': return 'text-amber-600 dark:text-amber-300';
    case 'rejected':    return 'text-red-500 dark:text-red-400';
    case 'skipped':     return 'text-surface-400 dark:text-surface-700';
    default:            return 'text-surface-500 dark:text-surface-600';
  }
}

// ── StageRow ──────────────────────────────────────────────────────────────────
// Left-rail roadmap row — one line of the box-drawing tree built by buildRoadmapTree.
// Deliberately minimal (status + label + running animation only): checkpoint/complete
// detail (review links, timestamps) lives in the event log's own section header/rows,
// not duplicated here. Every row (flat or nested) shares the same font size and
// vertical rhythm (py-1, items-center) — only the presence of a tree prefix differs.
//
// The status icon leads the row (prefix, then icon, then label) — branch header rows
// (Refinement, phase names) mirror this exact icon column with an aggregate status
// (see roadmap-tree.ts) so they're not the one row type with no icon.

export function StageRow({
  stageName,
  status,
  customLabel,
  onSelect,
  treePrefix = '',
  badge,
}: StageRowProps) {
  const isActive = status === 'in-progress';
  const clickable = status !== 'pending' && !!onSelect;

  return (
    <div
      className={`flex items-center gap-1.5 py-1.5 ${clickable ? 'cursor-pointer group' : ''}`}
      onClick={clickable ? onSelect : undefined}
    >
      {treePrefix && (
        <span className="flex-shrink-0 font-mono text-[13px] leading-none text-surface-300 dark:text-surface-700 whitespace-pre select-none">
          {treePrefix}
        </span>
      )}
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        <StatusIcon status={status} />
      </span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`min-w-0 text-[13px] font-mono leading-none truncate ${labelColor(status)} ${clickable ? 'group-hover:text-brand-600 dark:group-hover:text-brand-400 group-hover:underline' : ''}`}>
            {customLabel ?? STAGE_LABELS[stageName] ?? stageName}
          </span>
          {badge && (
            <span className="flex-shrink-0 text-[9px] font-mono uppercase tracking-wide text-surface-400 dark:text-surface-600 border border-surface-300 dark:border-surface-700 rounded px-1 leading-[14px]">
              {badge}
            </span>
          )}
        </div>
        {isActive && (
          <div className="mt-1 overflow-hidden">
            <AgentAnimation stageName={stageName} />
          </div>
        )}
      </div>
    </div>
  );
}
