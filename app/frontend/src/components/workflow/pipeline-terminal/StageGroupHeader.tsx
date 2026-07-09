import { STAGE_LABELS } from '../../../constants/stage-labels';
import type { StageStatus } from '../../../stores/workflowStore';

/** Section header that groups terminal events by pipeline stage. */
export function StageGroupHeader({
  stageName, status, artifactId, onViewOutput, wikiUrl,
}: {
  stageName: string;
  status: StageStatus;
  artifactId?: number | null;
  onViewOutput?: (id: number) => void;
  wikiUrl?: string | null;
}) {
  const label = STAGE_LABELS[stageName] ?? stageName;
  const color = status === 'complete'
    ? 'text-green-600 dark:text-green-400'
    : status === 'in-progress'
    ? 'text-brand-600 dark:text-brand-400'
    : status === 'at-checkpoint'
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-surface-400 dark:text-surface-600';

  const dot = status === 'complete'
    ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
    : status === 'in-progress'
    ? <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse inline-block" />
    : status === 'at-checkpoint'
    ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
    : null;

  // A full-width top border (rather than the previous thin rule trailing the
  // label) is what actually reads as a section break once the log is dense
  // with rows — the old inline rule was easy to lose among hover backgrounds.
  return (
    <div className="mt-4 pt-3 border-t-2 border-surface-200 dark:border-surface-700/80">
      <div className={`flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${color}`}>
        {dot}
        <span>{label}</span>
        {artifactId && onViewOutput && (
          <button
            onClick={() => onViewOutput(artifactId)}
            className="text-[9px] font-mono normal-case tracking-normal text-surface-600 dark:text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap border border-surface-300 dark:border-surface-700 hover:border-brand-400 dark:hover:border-brand-800 rounded px-1.5 py-0.5"
          >
            view →
          </button>
        )}
        {wikiUrl && (
          <a
            href={wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] font-mono normal-case tracking-normal text-surface-600 dark:text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap border border-surface-300 dark:border-surface-700 hover:border-brand-400 dark:hover:border-brand-800 rounded px-1.5 py-0.5"
          >
            wiki ↗
          </a>
        )}
      </div>
    </div>
  );
}
