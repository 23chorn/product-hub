import type { StageStatus } from '../stores/workflowStore';

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function labelClass(status: StageStatus): string {
  switch (status) {
    case 'complete':       return 'text-green-700 dark:text-green-400';
    case 'in-progress':    return 'text-teal-700 dark:text-teal-400 font-semibold';
    case 'at-checkpoint':  return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'rejected':       return 'text-red-600 dark:text-red-400 line-through';
    case 'skipped':        return 'text-slate-400 dark:text-slate-600 line-through';
    default:               return 'text-slate-400 dark:text-slate-600';
  }
}

export function deriveStageStatus(
  stageName: string,
  currentStage: string | null,
  completedStages: string[],
  pendingStage: string | null,
  workflowStatus: string
): StageStatus {
  if (pendingStage === stageName) return 'at-checkpoint';
  if (currentStage === stageName && workflowStatus === 'active') return 'in-progress';
  if (completedStages.includes(stageName)) return 'complete';
  return 'pending';
}
