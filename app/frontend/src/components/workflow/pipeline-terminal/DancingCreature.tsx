import { useEffect, useState } from 'react';

const CREATURE_FRAMES = [
  ['\\(^.^)/', ' ~  ~  '],
  [' (^.^) ', '~  ~   '],
  ['/(^.^)\\', '   ~  ~'],
  [' (^.^) ', '  ~   ~'],
];

/** Tiny idle animation shown while the pipeline is running. */
export function DancingCreature() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % CREATURE_FRAMES.length), 700);
    return () => clearInterval(t);
  }, []);
  const [top, bottom] = CREATURE_FRAMES[frame];
  return (
    <div
      className="flex-shrink-0 pb-3 pt-2 flex flex-col items-center select-none transition-opacity duration-500"
      title="keep going"
    >
      <pre className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-400 text-center font-mono">{top}</pre>
      <pre className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-500 text-center font-mono">{bottom}</pre>
    </div>
  );
}
