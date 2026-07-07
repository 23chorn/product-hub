import { ConfirmModal } from '../common/ConfirmModal';

interface StopConfirmModalProps {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before stopping a workflow. Stopping is terminal — the
 *  workflow cannot be resumed afterward, only restarted from the beginning. */
export function StopConfirmModal({ loading, onCancel, onConfirm }: StopConfirmModalProps) {
  return (
    <ConfirmModal
      tone="danger"
      title="Stop this workflow?"
      subtitle="This action cannot be undone"
      body="Stops the workflow immediately and marks it as stopped — it cannot be resumed. All artifacts and approvals produced so far are kept, but continuing afterward requires restarting the workflow from the beginning."
      confirmLabel="Yes, Stop"
      loadingLabel="Stopping..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
