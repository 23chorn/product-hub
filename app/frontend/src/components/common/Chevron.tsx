/** Collapse/expand indicator — a unicode glyph rather than an SVG, matching the glyph-based
 *  status icons used throughout workflow/pipeline-terminal (StatusIcon, EVENT_CFG). Swaps
 *  glyph shape on toggle instead of rotating, so no transform/transition is needed. */
export function Chevron({ expanded, className = 'w-3.5 text-surface-400' }: { expanded: boolean; className?: string }) {
  return (
    <span className={`${className} flex-shrink-0 inline-block text-center font-mono leading-none select-none`} aria-hidden="true">
      {expanded ? '▾' : '▸'}
    </span>
  );
}
