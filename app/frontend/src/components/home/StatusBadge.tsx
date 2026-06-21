import { STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import { effectiveStatus, type WorkflowInfo } from './types';

/** Small coloured status pill for an initiative's workflow (Running / Review / Done / Stopped). */
export function StatusBadge({ wf }: { wf?: WorkflowInfo }) {
  if (!wf) return null;
  const eff = effectiveStatus(wf);
  const pendingStageLabel = wf.pendingStage
    ? STAGE_SHORT_LABELS[wf.pendingStage] ?? wf.pendingStage.replace(/_/g, ' ')
    : null;
  const label = eff === 'complete' ? 'Done'
    : eff === 'cancelled' ? 'Stopped'
    : eff === 'paused_at_checkpoint' ? (pendingStageLabel ? `Review · ${pendingStageLabel}` : 'Review')
    : eff === 'active' ? 'Running'
    : eff;
  const color = eff === 'complete'
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    : eff === 'cancelled'
    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
    : eff === 'paused_at_checkpoint'
    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    : eff === 'active'
    ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
    : 'bg-surface-100 dark:bg-surface-700 text-surface-500';
  return (
    <span className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${color}`}>
      {eff === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />}
      {label}
    </span>
  );
}
