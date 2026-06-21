import { ConfirmModal } from '../common/ConfirmModal';

interface RestartConfirmModalProps {
  isDemo: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before restarting a workflow from the beginning (discards all progress). */
export function RestartConfirmModal({ isDemo, loading, onCancel, onConfirm }: RestartConfirmModalProps) {
  return (
    <ConfirmModal
      tone="danger"
      title="Restart from the beginning?"
      subtitle="This action cannot be undone"
      body={
        isDemo
          ? 'Restarting the demo discards every artifact and checkpoint produced so far and reruns the full pipeline from stage one.'
          : 'Restarting discards every artifact and checkpoint produced so far and reruns the full pipeline from stage one. There is no way to recover the current progress afterward.'
      }
      confirmLabel="Yes, Restart"
      loadingLabel="Restarting..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
