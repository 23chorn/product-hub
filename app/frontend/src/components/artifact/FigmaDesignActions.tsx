import { useState } from 'react';
import type { FigmaScreenRef, ParsedFigmaDesign } from '../../utils/figma-design';
import { DeleteItemButton } from '../common/DeleteItemButton';
import { normalizeJourneyId } from './EpicFeaturesView';
import { ChromeStrip } from './ArtifactPrimitives';

// Mono uppercase label for a sub-section inside the Summary page — matches ChromeStrip's
// label treatment so the page reads as one console block rather than a stack of plain captions.
const summaryLabel = 'text-[10px] font-mono font-semibold uppercase tracking-widest text-surface-500 dark:text-surface-400 mb-1.5';

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

/**
 * Full-drawer screen-by-screen previewer for the figma_design stage.
 * Page 0 is an Overview (design gaps, navigation flow, notes) when that content exists;
 * subsequent pages show one screen at a time with rich detail and a per-screen URL input.
 */
export function FigmaScreenPreviewer({
  figmaDesign,
  links,
  onLinkChange,
  readonly = false,
  onDeleteScreen,
}: {
  figmaDesign: ParsedFigmaDesign;
  links: Record<string, string>;
  onLinkChange: (key: string, value: string) => void;
  readonly?: boolean;
  /** Delete a screen directly (no LLM revision) — omitted when the caller doesn't allow it
   *  (read-only views, or no pending figma_design checkpoint). */
  onDeleteScreen?: (screenIndex: number) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { screens, figmaFileUrl, designGaps, navigationFlow, notes } = figmaDesign;

  const inputClass = 'w-full text-sm rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-rose-500';
  const sectionLabel = 'text-[11px] font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-1';

  // Page 0 is always a Summary when there are screens (lists them briefly, plus nav/notes).
  const hasSummary = screens.length > 0;
  const screenOffset = hasSummary ? 1 : 0;
  const totalPages = screens.length + screenOffset;

  // Clamp stale index after screens change
  const pageIndex = Math.min(currentIndex, Math.max(0, totalPages - 1));
  if (pageIndex !== currentIndex) setCurrentIndex(pageIndex);

  const isSummary = hasSummary && pageIndex === 0;
  const screenIdx = pageIndex - screenOffset;
  const screen = isSummary ? null : screens[screenIdx] ?? null;

  const navPrevClass = 'px-2.5 py-1 text-xs rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  // No screens — show a minimal fallback link input
  if (screens.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {figmaFileUrl
            ? 'No individual screens were generated. Paste the file-level Figma link below, or leave blank.'
            : 'No Figma file was created automatically. Build the design from the notes above, then paste a link below (or leave blank).'}
        </p>
        {figmaFileUrl && (
          <a href={figmaFileUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 px-3 bg-[#1E1E1E] hover:bg-[#333] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <FigmaLogo size={14} />
            Open in Figma
          </a>
        )}
        <div>
          {readonly ? (
            links[FALLBACK_KEY]?.trim() ? (
              <a
                href={links[FALLBACK_KEY]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 bg-[#1E1E1E] hover:bg-[#2C2C2C] text-white text-sm font-medium rounded-lg transition-colors"
              >
                <FigmaLogo size={14} />
                View in Figma
              </a>
            ) : null
          ) : (
            <>
              <label className="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">
                Figma Frame Link (optional)
              </label>
              <input
                type="text"
                value={links[FALLBACK_KEY] ?? ''}
                onChange={e => onLinkChange(FALLBACK_KEY, e.target.value)}
                placeholder="https://www.figma.com/design/... (leave blank if not created)"
                className={inputClass}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Navigation bar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-surface-200 dark:border-surface-700 flex-shrink-0 bg-surface-50 dark:bg-surface-900">
        <button
          onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
          disabled={pageIndex === 0}
          className={navPrevClass}
        >
          ← Prev
        </button>
        <span className="text-xs font-medium text-surface-600 dark:text-surface-300 text-center min-w-0 truncate">
          {isSummary
            ? 'Summary'
            : <>
                Screen {screenIdx + 1} of {screens.length}
                <span className="mx-1.5 text-surface-300 dark:text-surface-600">·</span>
                <span className="text-surface-800 dark:text-surface-100">{screen?.name}</span>
              </>
          }
        </span>
        <button
          onClick={() => setCurrentIndex(i => Math.min(totalPages - 1, i + 1))}
          disabled={pageIndex === totalPages - 1}
          className={navPrevClass}
        >
          Next →
        </button>
      </div>

      {/* Page content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {isSummary ? (
          <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 overflow-hidden">
            <ChromeStrip left={`▤ summary — ${screens.length} screen${screens.length !== 1 ? 's' : ''}`} />
            <div className="p-3 space-y-4">
              <div>
                <p className={summaryLabel}>screens</p>
                <ul className="space-y-2 mt-1">
                  {screens.map((s, i) => (
                    <li key={s.name} className="flex gap-2 text-sm">
                      <span className="text-surface-400 dark:text-surface-500 font-mono flex-shrink-0 tabular-nums">{i + 1}.</span>
                      <span>
                        <span className="font-medium text-surface-800 dark:text-surface-100">{s.name}</span>
                        {s.description && (
                          <span className="text-surface-500 dark:text-surface-400"> — {s.description}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {navigationFlow && (
                <div>
                  <p className={summaryLabel}>navigation flow</p>
                  <pre className="text-xs font-mono text-slate-300 bg-slate-900 border border-slate-700 rounded p-3 overflow-auto whitespace-pre-wrap">{navigationFlow}</pre>
                </div>
              )}

              {notes && (
                <div>
                  <p className={summaryLabel}>notes</p>
                  <p className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed">{notes}</p>
                </div>
              )}

              {designGaps && designGaps.length > 0 && (
                <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1.5">
                    ⚠ design gaps · {designGaps.length}
                  </p>
                  <ul className="space-y-0.5">
                    {designGaps.map((gap, i) => (
                      <li key={i} className="text-xs text-amber-700 dark:text-amber-300">• {gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : screen && (
          <>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">{screen.name}</h3>
              {!readonly && onDeleteScreen && (
                <DeleteItemButton onDelete={() => onDeleteScreen(screenIdx)} label={`Delete screen "${screen.name}"`} />
              )}
            </div>

            {screen.description && (
              <p className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed">{screen.description}</p>
            )}

            {screen.prd_journeys && screen.prd_journeys.length > 0 && (
              <div>
                <p className={sectionLabel}>Covers journeys</p>
                <div className="flex flex-wrap gap-1.5">
                  {screen.prd_journeys.map((j, i) => {
                    // Real model output embeds the id in the string itself, e.g.
                    // "Journey 1: Informed Limit Order Placement (Happy Path)" — split off the
                    // id for the badge and keep the description for the tooltip so hovering
                    // doesn't just repeat "Journey 1" back.
                    const colonIdx = j.indexOf(': ');
                    const jId = normalizeJourneyId(colonIdx !== -1 ? j.slice(0, colonIdx) : j);
                    const tip = colonIdx !== -1 ? j.slice(colonIdx + 2) : undefined;
                    return (
                      <span key={i} title={tip} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-700 ${tip ? 'cursor-help' : ''}`}>
                        {jId}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {screen.layout_notes && (
              <div>
                <p className={sectionLabel}>Layout</p>
                <p className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed">{screen.layout_notes}</p>
              </div>
            )}

            {screen.interactions && screen.interactions.length > 0 && (
              <div>
                <p className={sectionLabel}>Interactions</p>
                <ul className="space-y-1">
                  {screen.interactions.map((interaction, i) => (
                    <li key={i} className="text-sm text-surface-700 dark:text-surface-300 flex items-start gap-1.5">
                      <span className="text-surface-400 flex-shrink-0 mt-0.5">•</span>
                      <span>
                        <span className="font-medium">{interaction.trigger ?? 'Action'}</span>
                        {interaction.target_screen && (
                          <> → <span className="text-brand-600 dark:text-brand-400">{interaction.target_screen}</span></>
                        )}
                        {interaction.notes && (
                          <span className="text-surface-500 dark:text-surface-400"> — {interaction.notes}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-1">
              {readonly ? (
                links[screen.name]?.trim() ? (
                  <a
                    href={links[screen.name]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-[#1E1E1E] hover:bg-[#2C2C2C] text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <FigmaLogo size={14} />
                    View in Figma
                  </a>
                ) : null
              ) : (
                <>
                  <label className="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1">
                    Figma Frame Link (optional)
                  </label>
                  <input
                    type="text"
                    value={links[screen.name] ?? ''}
                    onChange={e => onLinkChange(screen.name, e.target.value)}
                    placeholder="https://www.figma.com/design/... (leave blank if not created)"
                    className={inputClass}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Dot navigation — first dot = summary, rest = screens */}
      <div className="flex gap-1 px-4 py-2.5 border-t border-surface-200 dark:border-surface-700 flex-shrink-0 bg-surface-50 dark:bg-surface-900">
        {hasSummary && (
          <button
            onClick={() => setCurrentIndex(0)}
            title="Summary"
            className={`w-5 h-1.5 rounded-full transition-colors flex-shrink-0 ${
              pageIndex === 0 ? 'bg-rose-500' : 'bg-surface-300 dark:bg-surface-600'
            }`}
          />
        )}
        {screens.map((s, idx) => {
          const pIdx = idx + screenOffset;
          const hasLink = !!links[s.name]?.trim();
          return (
            <button
              key={s.name}
              onClick={() => setCurrentIndex(pIdx)}
              title={`${s.name}${hasLink ? ' (has link)' : ''}`}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                pIdx === pageIndex
                  ? 'bg-rose-500'
                  : hasLink
                  ? 'bg-green-400 dark:bg-green-600'
                  : 'bg-surface-300 dark:bg-surface-600'
              }`}
            />
          );
        })}
      </div>
    </div>
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
  /**
   * When provided, link inputs are managed externally (e.g. by FigmaScreenPreviewer in the
   * full artifact drawer). The component skips rendering its own URL inputs and uses these
   * links for the submit payload instead.
   */
  externalLinks?: Record<string, string>;
  onMarkComplete: (payload: { figmaUrl?: string; screenLinks?: Record<string, string> }) => void;
  onRevise: () => void;
  onReject: () => void;
}

/**
 * The figma_design checkpoint's action block: open-in-figma, a link input per generated
 * screen (so each screen's own Figma frame can be cited downstream instead of one
 * whole-file link), then mark-complete/revise/reject. Shared by the inline checkpoint
 * card and the full artifact drawer so the per-screen link UX can't drift between them.
 *
 * In the full artifact drawer, pass `externalLinks` — the URL inputs live in
 * FigmaScreenPreviewer instead, and this component renders only the action buttons.
 */
export function FigmaDesignActions({
  figmaFileUrl,
  screens,
  loading,
  compact = false,
  externalLinks,
  onMarkComplete,
  onRevise,
  onReject,
}: FigmaDesignActionsProps) {
  const [selfLinks, setSelfLinks] = useState<Record<string, string>>(
    () => Object.fromEntries(screens.map(s => [s.name, s.frame_url ?? '']))
  );
  const [currentScreenIndex, setCurrentScreenIndex] = useState(0);

  const links = externalLinks ?? selfLinks;
  const setLink = (key: string, value: string) => {
    if (!externalLinks) setSelfLinks(prev => ({ ...prev, [key]: value }));
  };

  const canSubmit = !loading;

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
    ? 'w-full text-xs rounded-md border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 px-2.5 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-rose-500'
    : 'w-full text-sm rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-rose-500';
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

  // Self-managed URL inputs (compact inline card only)
  const showUrlInputs = !externalLinks;

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

      {showUrlInputs && (
        <>
          <p className={noteClass}>
            {figmaFileUrl
              ? "Paste frame links for each screen, or leave blank if not created. Use the navigation to move between screens."
              : "No Figma file was created automatically. Build the design from the screens and notes above, then paste frame links below (or leave blank)."}
          </p>

          {screens.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setCurrentScreenIndex(Math.max(0, currentScreenIndex - 1))}
                  disabled={currentScreenIndex === 0}
                  className="px-2 py-1 text-xs rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-xs text-surface-500 dark:text-surface-400 font-medium">
                  Screen {currentScreenIndex + 1} of {screens.length}
                </span>
                <button
                  onClick={() => setCurrentScreenIndex(Math.min(screens.length - 1, currentScreenIndex + 1))}
                  disabled={currentScreenIndex === screens.length - 1}
                  className="px-2 py-1 text-xs rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>

              {screens[currentScreenIndex] && (
                <div>
                  <label className={labelClass}>{screens[currentScreenIndex].name}</label>
                  <input
                    type="text"
                    value={links[screens[currentScreenIndex].name] ?? ''}
                    onChange={e => setLink(screens[currentScreenIndex].name, e.target.value)}
                    placeholder="https://www.figma.com/design/... (optional - leave blank if not created)"
                    className={inputClass}
                  />
                </div>
              )}

              <div className="flex gap-1">
                {screens.map((s, idx) => {
                  const hasValue = !!links[s.name]?.trim();
                  return (
                    <button
                      key={s.name}
                      onClick={() => setCurrentScreenIndex(idx)}
                      title={`${s.name}${hasValue ? ' (has link)' : ' (empty)'}`}
                      className={`flex-1 h-1 rounded-full transition-colors ${
                        idx === currentScreenIndex
                          ? 'bg-rose-500'
                          : hasValue
                          ? 'bg-green-400 dark:bg-green-600'
                          : 'bg-surface-300 dark:bg-surface-600'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <label className={labelClass}>Figma Frame Link (optional)</label>
              <input
                type="text"
                value={links[FALLBACK_KEY] ?? ''}
                onChange={e => setLink(FALLBACK_KEY, e.target.value)}
                placeholder="https://www.figma.com/design/... (leave blank if not created)"
                className={inputClass}
              />
            </div>
          )}
        </>
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
