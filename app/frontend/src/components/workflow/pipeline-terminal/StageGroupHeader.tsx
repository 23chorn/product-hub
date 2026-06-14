import { STAGE_LABELS } from '../../../constants/stage-labels';
import type { StageStatus } from '../../../stores/workflowStore';

/** Section header that groups terminal events by pipeline stage. */
export function StageGroupHeader({
  stageName, status, artifactId, onViewOutput,
}: {
  stageName: string;
  status: StageStatus;
  artifactId?: number | null;
  onViewOutput?: (id: number) => void;
}) {
  const label = STAGE_LABELS[stageName] ?? stageName;
  const color = status === 'complete'
    ? 'text-green-600 dark:text-green-400'
    : status === 'in-progress'
    ? 'text-teal-600 dark:text-teal-400'
    : status === 'at-checkpoint'
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-slate-400 dark:text-slate-600';

  const dot = status === 'complete'
    ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
    : status === 'in-progress'
    ? <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse inline-block" />
    : status === 'at-checkpoint'
    ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
    : null;

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 mt-2 first:mt-0 text-[10px] font-semibold uppercase tracking-widest ${color}`}>
      {dot}
      <span>{label}</span>
      {artifactId && onViewOutput && (
        <button
          onClick={() => onViewOutput(artifactId)}
          className="text-[9px] font-mono normal-case tracking-normal text-slate-500 dark:text-slate-600 hover:text-teal-600 dark:hover:text-teal-400 transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-800 hover:border-teal-400 dark:hover:border-teal-800 rounded px-1.5 py-0.5"
        >
          view →
        </button>
      )}
      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800/60" />
    </div>
  );
}
