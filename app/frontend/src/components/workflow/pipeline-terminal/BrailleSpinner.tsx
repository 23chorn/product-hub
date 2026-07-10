import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Braille-cell spin glyph — matches the character register of the stage status
 *  icons (✓ ▶ ⏸) instead of dropping to a stroke-SVG spinner mid-terminal. */
export function BrailleSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 90);
    return () => clearInterval(id);
  }, []);
  return <span className={className} aria-hidden="true">{FRAMES[frame]}</span>;
}
