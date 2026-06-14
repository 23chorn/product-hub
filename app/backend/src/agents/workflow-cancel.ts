/**
 * workflow-cancel — user-initiated cancellation registry for running workflows.
 * Tracks per-workflow AbortControllers (to kill in-flight LLM streams) and a set
 * of cancelled workflow IDs so no further stages start. Separated from the stage
 * runner so the cancel state is a single shared singleton.
 */
import { logger, stmts, insertEvent } from './workflow-db';

/**
 * Stages that run silently with no human review gate.
 * Currently empty — every stage pauses for human approval.
 * To skip human review on a stage, add it here (e.g. new Set(['pm_prd'])).
 */
export const SILENT_STAGES = new Set<string>([]);

const _cancelControllers = new Map<string, AbortController>();
const _cancelledWorkflows = new Set<string>();

/** Register the AbortController for an in-flight stage so it can be cancelled. */
export function setCancelController(workflowId: string, controller: AbortController): void {
  _cancelControllers.set(workflowId, controller);
}

/** Remove a workflow's AbortController once its stage finishes. */
export function clearCancelController(workflowId: string): void {
  _cancelControllers.delete(workflowId);
}

/**
 * Request cancellation of an active workflow.
 * Aborts any in-flight LLM stream, emits a `workflow_cancelled` event,
 * and marks the workflow complete so no further stages start.
 */
export function requestCancel(workflowId: string): void {
  _cancelledWorkflows.add(workflowId);
  const controller = _cancelControllers.get(workflowId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  const now = Date.now();
  try { stmts.updateWorkflowStatus.run('complete', now, workflowId); } catch { /* ignore */ }
  insertEvent(workflowId, 'workflow_cancelled', null, 'Workflow stopped by user.');
  logger.info(`Workflow ${workflowId} cancelled by user`);
}

/** Returns true if the user has requested cancellation for this workflow. */
export function isCancelRequested(workflowId: string): boolean {
  return _cancelledWorkflows.has(workflowId);
}

/** Clears the cancel flag so a restarted workflow can run again. */
export function clearCancelFlag(workflowId: string): void {
  _cancelledWorkflows.delete(workflowId);
  _cancelControllers.delete(workflowId);
}
