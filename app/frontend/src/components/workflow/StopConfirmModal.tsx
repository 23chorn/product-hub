import { ConfirmModal } from '../common/ConfirmModal';

interface StopConfirmModalProps {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before stopping a workflow. The run itself can't be
 *  un-stopped, but afterward it can be resumed from any stage it already reached
 *  (or restarted from scratch) — see ResumeFromStageModal / RestartConfirmModal. */
export function StopConfirmModal({ loading, onCancel, onConfirm }: StopConfirmModalProps) {
  return (
    <ConfirmModal
      tone="danger"
      title="Stop this workflow?"
      subtitle="This action cannot be undone"
      body="Stops the workflow immediately and marks it as stopped. All artifacts and approvals produced so far are kept — afterward you can resume from any stage it already reached, or restart from the beginning."
      confirmLabel="Yes, Stop"
      loadingLabel="Stopping..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
