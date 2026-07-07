import { ConfirmModal } from '../common/ConfirmModal';

interface RetryConfirmModalProps {
  isWave: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog shown before retrying the current stage (discards its in-progress
 *  output and any pending review for it, then reruns it from scratch with a fresh brief). */
export function RetryConfirmModal({ isWave, loading, onCancel, onConfirm }: RetryConfirmModalProps) {
  return (
    <ConfirmModal
      tone="danger"
      title="Retry the current stage?"
      subtitle="Discards this stage's progress"
      body={
        isWave
          ? 'Discards the in-progress output and any pending review for every feature running in parallel in this stage, then reruns all of them from scratch with a fresh brief. Already-approved stages are not affected.'
          : "Discards this stage's in-progress output and any pending review for it, then reruns it from scratch with a fresh brief. Already-approved stages are not affected."
      }
      confirmLabel="Yes, Retry"
      loadingLabel="Retrying..."
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
