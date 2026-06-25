import { ConfirmModal, type ConfirmTone } from './ConfirmModal';

interface ArchiveConfirmModalProps {
  mode: 'archive' | 'unarchive';
  itemTitle: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const COPY: Record<ArchiveConfirmModalProps['mode'], {
  tone: ConfirmTone;
  subtitle: string;
  body: string;
  confirmLabel: string;
  loadingLabel: string;
}> = {
  archive: {
    tone: 'danger',
    subtitle: 'Hidden, not deleted',
    body: 'Removes it from the default Progress Tracker list. Admins can review and restore it later from Archived Initiatives.',
    confirmLabel: 'Yes, Archive',
    loadingLabel: 'Archiving...',
  },
  unarchive: {
    tone: 'success',
    subtitle: 'Reversible',
    body: 'Restores it to the default Progress Tracker list.',
    confirmLabel: 'Yes, Unarchive',
    loadingLabel: 'Unarchiving...',
  },
};

/** Confirmation dialog for the admin-only manual archive/unarchive action on a completed
 *  initiative — shared by the Progress Tracker detail page and the Initiatives card menu. */
export function ArchiveConfirmModal({ mode, itemTitle, loading, onCancel, onConfirm }: ArchiveConfirmModalProps) {
  const copy = COPY[mode];
  return (
    <ConfirmModal
      tone={copy.tone}
      title={`${mode === 'archive' ? 'Archive' : 'Unarchive'} "${itemTitle}"?`}
      subtitle={copy.subtitle}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      loadingLabel={copy.loadingLabel}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
