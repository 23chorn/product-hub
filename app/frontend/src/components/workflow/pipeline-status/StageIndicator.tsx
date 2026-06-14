import { STAGE_ORDER, STAGE_LABELS, type PipelineStage } from './shared';

/** Single step indicator in the code-pipeline progress list. */
export function StageIndicator({ stage, current }: { stage: PipelineStage; current: PipelineStage }) {
  const si = STAGE_ORDER.indexOf(stage);
  const ci = STAGE_ORDER.indexOf(current);
  const done = ci > si, active = ci === si;

  return (
    <div className="flex items-center gap-2">
      {done && (
        <span className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center">
          <svg className="w-1.5 h-1.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {active && (
        <span className="w-3 h-3 rounded-full bg-teal-500 flex-shrink-0 flex items-center justify-center animate-pulse">
          <span className="w-1 h-1 rounded-full bg-white" />
        </span>
      )}
      {!done && !active && (
        <span className="w-3 h-3 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
      )}
      <span className={`text-[10px] font-mono leading-tight ${
        done ? 'text-green-600 dark:text-green-400'
             : active ? 'text-teal-600 dark:text-teal-300'
             : 'text-slate-400 dark:text-slate-600'
      }`}>
        {STAGE_LABELS[stage]}
      </span>
    </div>
  );
}
