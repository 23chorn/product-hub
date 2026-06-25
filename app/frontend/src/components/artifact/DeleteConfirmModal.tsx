import { ConfirmModal } from '../common/ConfirmModal';

interface DeleteConfirmModalProps {
  itemLabel: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before deleting a single story/feature/epic/test-case from
 *  an artifact during checkpoint review. Saves directly (no checkpointId) — does not
 *  advance the workflow, so the reviewer still approves explicitly afterward. */
export function DeleteConfirmModal({ itemLabel, loading, onCancel, onConfirm }: DeleteConfirmModalProps) {
  return (
    <ConfirmModal
      tone="danger"
      title={`Delete ${itemLabel}?`}
      subtitle="This action cannot be undone"
      body="This removes it from the artifact immediately — no AI revision is generated. The workflow stays at this checkpoint, so you can keep reviewing before approving."
      confirmLabel="Yes, Delete"
      loadingLabel="Deleting..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
