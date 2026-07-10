import { useState } from 'react';
import { useSplitArtifactCandidates } from '../../hooks/useSplitArtifactCandidates';

interface SplitViewButtonProps {
  /** Artifact id to exclude from the picker (the document already open in the main pane). */
  excludeArtifactId?: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/** Header button + dropdown for picking a second document to preview alongside the current
 *  one. Shared by ArtifactViewer and BacklogOverviewModal so both preview surfaces support
 *  split view the same way. Renders nothing when the workflow has no other documents yet. */
export function SplitViewButton({ excludeArtifactId, selectedId, onSelect }: SplitViewButtonProps) {
  const candidates = useSplitArtifactCandidates(excludeArtifactId);
  const [open, setOpen] = useState(false);

  if (candidates.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
          selectedId
            ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400'
            : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600 hover:text-surface-700 dark:hover:text-surface-200'
        }`}
        title="View another document side by side"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16M4 4h16v16H4V4z" />
        </svg>
        Split View
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-[28rem] max-w-[90vw] bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-surface-200 dark:border-surface-700">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                Open alongside
              </p>
            </div>
            {candidates.map(c => (
              <button
                key={c.id}
                onClick={() => { onSelect(c.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs whitespace-nowrap overflow-hidden text-ellipsis hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors ${
                  selectedId === c.id ? 'bg-surface-100 dark:bg-surface-800 text-brand-600 dark:text-brand-400 font-medium' : 'text-surface-700 dark:text-surface-300'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
