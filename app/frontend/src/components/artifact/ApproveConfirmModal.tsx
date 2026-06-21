import { ConfirmModal } from '../common/ConfirmModal';

interface ApproveConfirmModalProps {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before approving a checkpoint (advances the workflow to the next stage). */
export function ApproveConfirmModal({ loading, onCancel, onConfirm }: ApproveConfirmModalProps) {
  return (
    <ConfirmModal
      tone="success"
      title="Approve this stage?"
      subtitle="This advances the workflow to the next stage"
      body="Make sure you've reviewed the output above. Once approved, the next stage starts immediately."
      confirmLabel="Yes, Approve"
      loadingLabel="Approving..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
