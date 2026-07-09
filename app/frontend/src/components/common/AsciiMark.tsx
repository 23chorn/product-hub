import { XCUBE_LOGO_ART } from './asciiArt';

// Natural pixel footprint of the art at the base font/line metrics below (103 cols x
// 48 rows @ 6px monospace) — every rendering scales down from this same base via CSS
// transform (not by shrinking font-size directly, which blurs the glyphs at small sizes).
const BASE_FONT_SIZE = 6;
const NATURAL_WIDTH = 364;
const NATURAL_HEIGHT = 288;

/** Renders the xCube ASCII mark scaled to an exact pixel width, keeping the character
 *  shading crisp. Used inline (CompanyLogo), tiled (AsciiCubeBackground), and as a
 *  standalone hero (LoginPage) — one scaling implementation for all three. */
export function AsciiMark({ width, className = '' }: { width: number; className?: string }) {
  const scale = width / NATURAL_WIDTH;
  const height = NATURAL_HEIGHT * scale;
  return (
    <div className={`relative overflow-hidden shrink-0 ${className}`} style={{ width, height }} aria-hidden="true">
      <pre
        className="absolute top-0 left-0 m-0 text-surface-900 dark:text-surface-100"
        style={{
          fontFamily: 'monospace',
          fontSize: BASE_FONT_SIZE,
          lineHeight: `${BASE_FONT_SIZE}px`,
          letterSpacing: 0,
          whiteSpace: 'pre',
          // Guards against an ancestor's `text-align: center` (e.g. LoginPage's centered
          // hero block) inheriting in — each line has a different rendered width, so a
          // centered pre re-indents every line independently and scrambles the grid.
          textAlign: 'left',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {XCUBE_LOGO_ART}
      </pre>
    </div>
  );
}
