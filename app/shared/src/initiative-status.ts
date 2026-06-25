// Shared workflow-completion predicate and ADO local-key numbering — used by both the
// frontend Home screen and the backend completed-initiatives route so the two runtimes
// agree on what counts as a "completed" workflow, and by both the ADO push code and the
// backlog artifact viewer so they agree on how an F#/F#.S# local key is derived.

export type WorkflowInfo = {
  id: string;
  status: string;
  currentStage: string | null;
  summary: string | null;
  pipelineStatus?: string;
  isCancelled?: boolean;
  isDemo?: boolean;
  pendingStage?: string | null;
  pendingApprovals?: Array<{ stage: string; roles: string[] }>;
  updatedAt?: number;
};

/** Collapse a workflow's raw status into a display status, accounting for cancellation and pipeline state. */
export function effectiveStatus(wf: WorkflowInfo): string {
  if (wf.isCancelled) return 'cancelled';
  if (wf.status === 'complete' && wf.pipelineStatus && wf.pipelineStatus !== 'complete') return 'active';
  return wf.status;
}

/**
 * Display title for an initiative: the latest workflow's AI-generated summary wins when
 * present, else the raw item title. Single source of truth so the Home page and the
 * Progress Tracker page never show two different names for the same initiative.
 */
export function resolveDisplayTitle(rawTitle: string, workflowSummary?: string | null): string {
  return workflowSummary || rawTitle;
}

/**
 * Local key for a feature's position in the backlog (1-based) — e.g. "F1".
 * Single source of truth for this numbering: used both as the ado_work_item_map
 * lookup key and as the title prefix stamped onto the ADO ticket itself, so the
 * two always agree.
 */
export function featureLocalKey(featureIndex: number): string {
  return `F${featureIndex + 1}`;
}

/** Local key for a story's position within its feature (1-based) — e.g. "F1.S2". */
export function storyLocalKey(featureKey: string, storyIndex: number): string {
  return `${featureKey}.S${storyIndex + 1}`;
}
