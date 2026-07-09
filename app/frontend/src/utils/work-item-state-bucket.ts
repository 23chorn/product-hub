import type { WorkItemStateBucket } from '@pap/shared';

/** Single source of truth for displaying a WorkItemStateBucket — used by the
 * Progress Tracker list cards and the BacklogView state pills. */
export const WORK_ITEM_STATE_BUCKETS: WorkItemStateBucket[] = ['not_started', 'in_progress', 'done', 'removed'];

export const WORK_ITEM_STATE_BUCKET_LABELS: Record<WorkItemStateBucket, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  removed: 'Removed',
};

/** Dot + text colors for DotLabel — not a filled pill, so a row of these reads as a terminal
 *  status line rather than a row of colored tags (see ArtifactPrimitives' DotLabel doc). */
export const WORK_ITEM_STATE_BUCKET_COLORS: Record<WorkItemStateBucket, { dot: string; text: string }> = {
  not_started: { dot: 'bg-surface-400 dark:bg-surface-500', text: 'text-surface-500 dark:text-surface-400' },
  in_progress: { dot: 'bg-brand-500 animate-pulse', text: 'text-brand-600 dark:text-brand-400' },
  done: { dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' },
  removed: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
};
