import { AsciiMark } from './AsciiMark';

const TILE_WIDTH = 182;
const TILE_COUNT = 48;

/** Static, tiled rendering of the xCube mark used as ambient wallpaper behind page
 *  content — small enough per-copy to read clearly as the logo, repeated so it fills
 *  the page like a watermark pattern. Decorative only — never interactive. */
export function AsciiCubeBackground({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none select-none overflow-hidden ${className}`} aria-hidden="true">
      <div
        className="grid justify-center content-center h-full"
        style={{ gridTemplateColumns: `repeat(auto-fill, ${TILE_WIDTH}px)`, gap: '2.5rem' }}
      >
        {Array.from({ length: TILE_COUNT }).map((_, i) => (
          <AsciiMark key={i} width={TILE_WIDTH} className="opacity-[0.08] dark:opacity-[0.2]" />
        ))}
      </div>
    </div>
  );
}
