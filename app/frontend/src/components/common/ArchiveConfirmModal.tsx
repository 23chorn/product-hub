import { ConfirmModal, type ConfirmTone } from './ConfirmModal';

interface ArchiveConfirmModalProps {
  mode: 'archive' | 'unarchive' | 'delete';
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
  delete: {
    tone: 'danger',
    subtitle: 'Permanent deletion',
    body: 'This will permanently delete the initiative and all associated workflows, artifacts, and data. This action cannot be undone.',
    confirmLabel: 'Yes, Delete',
    loadingLabel: 'Deleting...',
  },
};

/** Confirmation dialog for the admin-only manual archive/unarchive/delete action on an
 *  initiative — shared by the Progress Tracker detail page and the Initiatives card menu. */
export function ArchiveConfirmModal({ mode, itemTitle, loading, onCancel, onConfirm }: ArchiveConfirmModalProps) {
  const copy = COPY[mode];
  const title = mode === 'archive' ? 'Archive' : mode === 'unarchive' ? 'Unarchive' : 'Delete';
  return (
    <ConfirmModal
      tone={copy.tone}
      title={`${title} "${itemTitle}"?`}
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
