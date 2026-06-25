import { useState } from 'react';
import type { FigmaScreenRef } from '../../utils/figma-design';

const FALLBACK_KEY = '__file__';

function FigmaLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 28.5A9.5 9.5 0 1 1 28.5 19 9.5 9.5 0 0 1 19 28.5Z" fill="#1ABCFE"/>
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19V47.5A9.5 9.5 0 0 1 0 47.5Z" fill="#0ACF83"/>
      <path d="M19 0V19H28.5A9.5 9.5 0 0 0 19 0Z" fill="#FF7262"/>
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="#F24E1E"/>
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="#FF7262"/>
    </svg>
  );
}

interface FigmaDesignActionsProps {
  figmaFileUrl: string | null;
  /** Screens from the artifact's `screens_created`. Empty when the artifact didn't parse —
   * falls back to a single file-level link input in that case. */
  screens: FigmaScreenRef[];
  loading: boolean;
  /** Smaller text/padding for the inline checkpoint card vs. the full artifact drawer. */
  compact?: boolean;
  onMarkComplete: (payload: { figmaUrl?: string; screenLinks?: Record<string, string> }) => void;
  onRevise: () => void;
  onReject: () => void;
}

/**
 * The figma_design checkpoint's action block: open-in-figma, a link input per generated
 * screen (so each screen's own Figma frame can be cited downstream instead of one
 * whole-file link), then mark-complete/revise/reject. Shared by the inline checkpoint
 * card and the full artifact drawer so the per-screen link UX can't drift between them.
 */
export function FigmaDesignActions({
  figmaFileUrl,
  screens,
  loading,
  compact = false,
  onMarkComplete,
  onRevise,
  onReject,
}: FigmaDesignActionsProps) {
  const [links, setLinks] = useState<Record<string, string>>(
    () => Object.fromEntries(screens.map(s => [s.name, s.frame_url ?? '']))
  );

  const setLink = (key: string, value: string) => setLinks(prev => ({ ...prev, [key]: value }));

  const hasAnyLink = Object.values(links).some(v => v.trim());
  const canSubmit = !loading && (!!figmaFileUrl || hasAnyLink);

  function submit() {
    if (screens.length > 0) {
      const screenLinks: Record<string, string> = {};
      for (const s of screens) {
        const v = links[s.name]?.trim();
        if (v) screenLinks[s.name] = v;
      }
      onMarkComplete({ screenLinks });
    } else {
      onMarkComplete({ figmaUrl: links[FALLBACK_KEY]?.trim() });
    }
  }

  const inputClass = compact
    ? 'w-full text-xs rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-rose-500'
    : 'w-full text-sm rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-rose-500';
  const labelClass = 'block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-0.5';
  const primaryBtnClass = compact
    ? 'text-xs px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-medium transition-colors'
    : 'flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-700 disabled:bg-surface-300 text-white text-sm font-medium rounded-lg transition-colors';
  const reviseBtnClass = compact
    ? 'text-xs px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white transition-colors'
    : 'py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 text-white text-sm font-medium rounded-lg transition-colors';
  const rejectBtnClass = compact
    ? 'text-xs px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors'
    : 'py-2 px-3 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 text-red-700 dark:text-red-400 text-sm font-medium rounded-lg transition-colors';
  const noteClass = 'text-xs text-surface-500 dark:text-surface-400';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {figmaFileUrl && (
        <a
          href={figmaFileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={compact
            ? 'flex items-center justify-center gap-1.5 w-full text-xs px-3 py-1.5 rounded-md bg-[#1E1E1E] hover:bg-[#333] text-white font-medium transition-colors'
            : 'flex items-center justify-center gap-2 w-full py-2 px-3 bg-[#1E1E1E] hover:bg-[#333] text-white text-sm font-medium rounded-lg transition-colors'}
        >
          <FigmaLogo size={compact ? 10 : 14} />
          Open in Figma
        </a>
      )}

      <p className={noteClass}>
        {figmaFileUrl
          ? 'Paste each screen’s frame link below, then mark complete to advance the workflow.'
          : 'No Figma file was created automatically. Build the design from the screens and notes above, then paste each screen’s frame link below.'}
      </p>

      {screens.length > 0 ? (
        <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
          {screens.map(s => (
            <div key={s.name}>
              <label className={labelClass}>{s.name}</label>
              <input
                type="text"
                value={links[s.name] ?? ''}
                onChange={e => setLink(s.name, e.target.value)}
                placeholder="https://www.figma.com/design/..."
                className={inputClass}
              />
            </div>
          ))}
        </div>
      ) : (
        <input
          type="text"
          value={links[FALLBACK_KEY] ?? ''}
          onChange={e => setLink(FALLBACK_KEY, e.target.value)}
          placeholder="https://www.figma.com/design/..."
          className={inputClass}
        />
      )}

      <div className={compact ? 'flex items-center gap-2' : 'flex gap-2'}>
        <button onClick={submit} disabled={!canSubmit} className={primaryBtnClass}>
          {loading ? 'Saving...' : figmaFileUrl ? 'Mark Figma Complete' : 'Save Links & Continue'}
        </button>
        <button onClick={onRevise} disabled={loading} className={reviseBtnClass}>
          Revise
        </button>
        <button onClick={onReject} disabled={loading} className={rejectBtnClass}>
          Reject
        </button>
      </div>
    </div>
  );
}
