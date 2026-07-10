import { AsciiMark } from '../../common/AsciiMark';

const MARK_WIDTH = 40;

// Same density-shading alphabet as the logo art itself (space/+/*/# light to dark —
// see asciiArt.ts) so the trail reads as an extension of the mark, not a foreign
// gradient blur. Ordered light→dense left to right; the densest glyphs sit right
// behind the mark and thin out going back.
const TRAIL_GLYPHS = '  + + * * # #';

/** xCube mark that sweeps left-to-right across the pane in a slow, continuous cycle
 *  while the pipeline is running, trailing a fading streak of the logo's own ASCII
 *  shading characters behind it — replaces the old DancingCreature idle animation
 *  and the earlier stationary ripple mark. */
export function XCubeTrail() {
  return (
    <div className="flex-shrink-0 pb-4 pt-3 h-16 relative overflow-hidden select-none" title="working">
      <div className="absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 flex items-center animate-xcube-travel">
        <span
          aria-hidden="true"
          className="font-mono text-[11px] leading-none tracking-tighter whitespace-pre -mr-1"
          style={{
            background: 'linear-gradient(to left, #10BAFF, #8103FF)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            WebkitMaskImage: 'linear-gradient(to left, black 0%, transparent 90%)',
            maskImage: 'linear-gradient(to left, black 0%, transparent 90%)',
          }}
        >
          {TRAIL_GLYPHS}
        </span>
        <AsciiMark width={MARK_WIDTH} colored className="relative z-10" />
      </div>
    </div>
  );
}
