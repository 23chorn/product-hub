import { useState } from 'react';
import { useWorkflowStore, type WorkflowCheckpoint, type WorkflowRow } from '../stores/workflowStore';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';
import { STAGE_LABELS } from '../constants/stage-labels';

interface UseCheckpointActionsArgs {
  pendingCheckpoint?: WorkflowCheckpoint;
  activeWorkflow: WorkflowRow | null;
  /** Surface an error message in the host component. */
  setError: (msg: string | null) => void;
  /** Reset host-local form state (revise form, confirm modals) on a successful resolve. */
  onResolved?: () => void;
}

/**
 * Encapsulates the three workflow-mutating checkpoint actions (mark Figma complete,
 * rerun the current stage, resolve a checkpoint) plus their shared in-flight flag.
 * Pulls the store/auth dependencies itself so the host component only passes the
 * checkpoint context, an error sink, and an optional form-reset callback.
 */
export function useCheckpointActions({ pendingCheckpoint, activeWorkflow, setError, onResolved }: UseCheckpointActionsArgs) {
  const { applyWorkflowStatus, addCoordinatorMessage, setViewingArtifactId } = useWorkflowStore();
  const { user } = useAuthStore();
  const [resolveLoading, setResolveLoading] = useState(false);

  async function figmaComplete(figmaUrl?: string) {
    if (!pendingCheckpoint || !activeWorkflow) return;
    setResolveLoading(true);
    setError(null);
    try {
      const result = await api.figmaComplete(pendingCheckpoint.id, figmaUrl);
      applyWorkflowStatus(result.workflow);
      addCoordinatorMessage({ role: 'coordinator', content: 'Figma mockups marked complete. Syncing latest frame data and advancing to the next stage.', timestamp: Date.now() });
      setViewingArtifactId(null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to mark Figma complete');
    } finally {
      setResolveLoading(false);
    }
  }

  async function rerunStage() {
    if (!activeWorkflow?.id) return;
    setResolveLoading(true);
    setError(null);
    try {
      const result = await api.retryWorkflowStage(activeWorkflow.id);
      applyWorkflowStatus(result.workflow);
      setViewingArtifactId(null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to rerun stage');
    } finally {
      setResolveLoading(false);
    }
  }

  async function resolve(status: 'approved' | 'rejected' | 'revised', fb?: string) {
    if (!pendingCheckpoint || !activeWorkflow) return;
    setResolveLoading(true);
    setError(null);
    try {
      const result = await api.resolveCheckpoint(pendingCheckpoint.id, status, fb);
      applyWorkflowStatus(result.workflow);

      const statusLabel = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'sent for revision';
      const actor = user?.name ?? user?.username;
      const byNote = actor ? ` by **${actor}**` : '';
      addCoordinatorMessage({
        role: 'coordinator',
        content: `Checkpoint **${STAGE_LABELS[pendingCheckpoint.stage] ?? pendingCheckpoint.stage}** ${statusLabel}${byNote}.${
          result.complete ? ' Workflow complete.' : ''
        }`,
        timestamp: Date.now(),
      });

      onResolved?.();
      setViewingArtifactId(null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to resolve');
    } finally {
      setResolveLoading(false);
    }
  }

  return { resolveLoading, figmaComplete, rerunStage, resolve };
}
