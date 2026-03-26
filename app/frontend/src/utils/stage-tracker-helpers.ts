import type { StageStatus } from '../stores/workflowStore';

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export interface StageTokenData {
  specialist: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    searchCount: number;
    estimatedCost: number;
  };
  critic?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCost: number;
  };
  priorRunsCost?: number;
}

export function labelClass(status: StageStatus): string {
  switch (status) {
    case 'complete':       return 'text-green-700 dark:text-green-400';
    case 'in-progress':    return 'text-blue-700 dark:text-blue-400 font-semibold';
    case 'at-checkpoint':  return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'rejected':       return 'text-red-600 dark:text-red-400 line-through';
    case 'skipped':        return 'text-gray-400 dark:text-gray-600 line-through';
    default:               return 'text-gray-400 dark:text-gray-600';
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
