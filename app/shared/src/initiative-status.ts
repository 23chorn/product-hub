// Shared workflow-completion predicate and ADO local-key numbering — used by both the
// frontend Home screen and the backend completed-initiatives route so the two runtimes
// agree on what counts as a "completed" workflow, and by both the ADO push code and the
// backlog artifact viewer so they agree on how an F#/F#.S# local key is derived.

export type WorkflowInfo = {
  id: string;
  status: string;
  currentStage: string | null;
  summary: string | null;
  stageSequence?: string[];
  pipelineStatus?: string;
  isCancelled?: boolean;
  isDemo?: boolean;
  isPaused?: boolean;
  pausedAt?: number;
  pendingStage?: string | null;
  pendingApprovals?: Array<{ stage: string; roles: string[] }>;
  updatedAt?: number;
};

export type InitiativeComment = {
  id: string;
  itemId: string;
  userId?: string;
  authorName: string;
  body: string;
  type: 'note' | 'decision' | 'pause' | 'resume';
  title?: string;
  createdAt: number;
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

/** Inverse of featureLocalKey — parse "F1" back to its 0-based feature index, or null if malformed. */
export function parseFeatureLocalKey(key: string): number | null {
  const m = /^F(\d+)$/.exec(key);
  return m ? Number(m[1]) - 1 : null;
}

/** Inverse of storyLocalKey — parse "F1.S2" back to 0-based { featureIndex, storyIndex }, or null if malformed. */
export function parseStoryLocalKey(key: string): { featureIndex: number; storyIndex: number } | null {
  const m = /^F(\d+)\.S(\d+)$/.exec(key);
  return m ? { featureIndex: Number(m[1]) - 1, storyIndex: Number(m[2]) - 1 } : null;
}
