import { useEffect, useState } from 'react';

type Frame = [string, string]; // [bar, action]

const STAGE_FRAMES: Record<string, Frame[]> = {
  analyst: [
    ['█▓▒░░░░░', 'scanning'],
    ['░█▓▒░░░░', 'scanning'],
    ['░░█▓▒░░░', 'scanning'],
    ['░░░█▓▒░░', 'scanning'],
    ['░░░░█▓▒░', 'scanning'],
    ['░░░░░█▓▒', 'scanning'],
    ['░░░░░░█▓', 'scanning'],
    ['░░░░░░░█', 'scanning'],
  ],
  pm_prd: [
    ['▁▂▃▅▇█▇▅', 'drafting'],
    ['▂▃▅▇█▇▅▃', 'drafting'],
    ['▃▅▇█▇▅▃▂', 'drafting'],
    ['▅▇█▇▅▃▂▁', 'drafting'],
    ['▇█▇▅▃▂▁▂', 'drafting'],
    ['█▇▅▃▂▁▂▃', 'drafting'],
    ['▇▅▃▂▁▂▃▅', 'drafting'],
    ['▅▃▂▁▂▃▅▇', 'drafting'],
  ],
  solution_architect: [
    ['░░░░░░░░', 'designing'],
    ['▒░░░░░░░', 'designing'],
    ['▒▒░░░░░░', 'designing'],
    ['▒▒▒░░░░░', 'designing'],
    ['▒▒▒▒░░░░', 'designing'],
    ['▒▒▒▒▒░░░', 'designing'],
    ['▒▒▒▒▒▒░░', 'designing'],
    ['▒▒▒▒▒▒▒░', 'designing'],
  ],
  prototype: [
    ['░░░░░░░░', 'generating'],
    ['▒░░░░░░░', 'generating'],
    ['▓▒░░░░░░', 'generating'],
    ['█▓▒░░░░░', 'generating'],
    ['░█▓▒░░░░', 'generating'],
    ['░░█▓▒░░░', 'generating'],
    ['░░░█▓▒░░', 'generating'],
    ['░░░░█▓▒░', 'generating'],
  ],
  curator: [
    ['≈≈≈≈≈≈≈≈', 'curating'],
    ['~≈≈≈≈≈≈~', 'curating'],
    ['~~≈≈≈≈~~', 'curating'],
    ['~~~≈≈~~~', 'curating'],
    ['~~~~≈~~~', 'curating'],
    ['~~~≈≈~~~', 'curating'],
    ['~~≈≈≈≈~~', 'curating'],
    ['~≈≈≈≈≈≈~', 'curating'],
  ],
};

const DEFAULT_FRAMES: Frame[] = [
  ['⣾⣽⣻⢿⡿⣟⣯⣷', 'working'],
  ['⣽⣻⢿⡿⣟⣯⣷⣾', 'working'],
  ['⣻⢿⡿⣟⣯⣷⣾⣽', 'working'],
  ['⢿⡿⣟⣯⣷⣾⣽⣻', 'working'],
  ['⡿⣟⣯⣷⣾⣽⣻⢿', 'working'],
  ['⣟⣯⣷⣾⣽⣻⢿⡿', 'working'],
  ['⣯⣷⣾⣽⣻⢿⡿⣟', 'working'],
  ['⣷⣾⣽⣻⢿⡿⣟⣯', 'working'],
];

export function AgentAnimation({ stageName }: { stageName: string }) {
  const frames = STAGE_FRAMES[stageName] ?? DEFAULT_FRAMES;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % frames.length), 160);
    return () => clearInterval(id);
  }, [frames.length]);

  const [bar, action] = frames[frame];

  return (
    <div className="font-mono text-[10px] text-teal-500 dark:text-teal-400 leading-tight select-none whitespace-nowrap overflow-hidden">
      <span className="opacity-75 tracking-widest">{bar}</span>
      <span className="ml-1.5 opacity-40">{action}…</span>
    </div>
  );
}
