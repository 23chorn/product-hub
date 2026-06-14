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

/** Collapse a workflow's raw status into a display status, accounting for cancellation and pipeline state. */
export function effectiveStatus(wf: WorkflowInfo): string {
  if (wf.isCancelled) return 'cancelled';
  if (wf.status === 'complete' && wf.pipelineStatus && wf.pipelineStatus !== 'complete') return 'active';
  return wf.status;
}
