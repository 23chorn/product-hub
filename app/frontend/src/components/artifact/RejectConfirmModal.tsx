import { ConfirmModal } from '../common/ConfirmModal';

interface RejectConfirmModalProps {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before rejecting a checkpoint (which permanently ends the workflow). */
export function RejectConfirmModal({ loading, onCancel, onConfirm }: RejectConfirmModalProps) {
  return (
    <ConfirmModal
      tone="danger"
      title="End this workflow?"
      subtitle="This action cannot be undone"
      body="Rejecting will permanently end this workflow. All completed stages are preserved, but no further stages will run. You can start a new workflow with a fresh goal afterward."
      confirmLabel="Yes, Reject"
      loadingLabel="Rejecting..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
