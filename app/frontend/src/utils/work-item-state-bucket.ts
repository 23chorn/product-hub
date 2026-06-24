import type { WorkItemStateBucket } from '@pap/shared';

/** Single source of truth for displaying a WorkItemStateBucket — used by the
 * Completed Initiatives list cards and the BacklogView state pills. */
export const WORK_ITEM_STATE_BUCKETS: WorkItemStateBucket[] = ['not_started', 'in_progress', 'done', 'removed'];

export const WORK_ITEM_STATE_BUCKET_LABELS: Record<WorkItemStateBucket, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  removed: 'Removed',
};

export const WORK_ITEM_STATE_BUCKET_COLORS: Record<WorkItemStateBucket, string> = {
  not_started: 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400',
  in_progress: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400',
  done: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  removed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
};
