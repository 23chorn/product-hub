/** Shared types and status helper for the HomeScreen and its sub-components. */
import type { AirtableItem } from '@pap/shared';

export type WorkflowInfo = {
  id: string;
  status: string;
  currentStage: string | null;
  summary: string | null;
  pipelineStatus?: string;
  isCancelled?: boolean;
  isDemo?: boolean;
  pendingStage?: string | null;
};

export type EnrichedItem = AirtableItem & { source?: string; workflow?: WorkflowInfo };

export type LaunchPhase = 'analyzing' | 'confirming' | 'launching';
export type StatusFilter = 'all' | 'active' | 'review' | 'done' | 'new' | 'mine';

/** A togglable pipeline stage as shown in the launch confirmation modal. */
export interface StageOption {
  key: string;
  label: string;
  short: string;
}

export const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all',    label: 'All' },
  { key: 'mine',   label: 'Needs my approval' },
  { key: 'active', label: 'Running' },
  { key: 'review', label: 'Needs review' },
  { key: 'done',   label: 'Done' },
  { key: 'new',    label: 'Not started' },
];

/** Collapse a workflow's raw status into a display status, accounting for cancellation and pipeline state. */
export function effectiveStatus(wf: WorkflowInfo): string {
  if (wf.isCancelled) return 'cancelled';
  if (wf.status === 'complete' && wf.pipelineStatus && wf.pipelineStatus !== 'complete') return 'active';
  return wf.status;
}
