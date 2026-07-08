import { useEffect, useState } from 'react';

type Frame = [string, string]; // [bar, action]

// Each stage gets its own glyph family *and* motion (ping / grow / breathe / bounce),
// not just a recolored copy of another stage's bar — that's what made analyst and
// prototype read as the same animation before this pass.
const STAGE_FRAMES: Record<string, Frame[]> = {
  // Sage — radar ping sweeping across
  analyst: [
    ['●·······', 'scanning'],
    ['·●······', 'scanning'],
    ['··●·····', 'scanning'],
    ['···●····', 'scanning'],
    ['····●···', 'scanning'],
    ['·····●··', 'scanning'],
    ['······●·', 'scanning'],
    ['·······●', 'scanning'],
  ],
  // Rex — heartbeat waveform
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
  // Apex — a feature lighting up as it's carved out of the backlog
  epic_feature_planner: [
    ['▣□□□□□□□', 'planning'],
    ['□▣□□□□□□', 'planning'],
    ['□□▣□□□□□', 'planning'],
    ['□□□▣□□□□', 'planning'],
    ['□□□□▣□□□', 'planning'],
    ['□□□□□▣□□', 'planning'],
    ['□□□□□□▣□', 'planning'],
    ['□□□□□□□▣', 'planning'],
  ],
  // Atlas — a blueprint line extending
  solution_architect: [
    ['─·······', 'designing'],
    ['──······', 'designing'],
    ['───·····', 'designing'],
    ['────····', 'designing'],
    ['─────···', 'designing'],
    ['──────··', 'designing'],
    ['───────·', 'designing'],
    ['────────', 'designing'],
  ],
  // Vera, Finn, Remi & Cole — the story token passing between collaborators
  story_decomposition: [
    ['◆◇◇◇◇◇◇◇', 'refining'],
    ['◇◆◇◇◇◇◇◇', 'refining'],
    ['◇◇◆◇◇◇◇◇', 'refining'],
    ['◇◇◇◆◇◇◇◇', 'refining'],
    ['◇◇◇◇◆◇◇◇', 'refining'],
    ['◇◇◇◇◇◆◇◇', 'refining'],
    ['◇◇◇◇◇◇◆◇', 'refining'],
    ['◇◇◇◇◇◇◇◆', 'refining'],
  ],
  // Vera — checking off test cases one by one
  qa_engineer: [
    ['☑☐☐☐☐☐☐☐', 'testing'],
    ['☑☑☐☐☐☐☐☐', 'testing'],
    ['☑☑☑☐☐☐☐☐', 'testing'],
    ['☑☑☑☑☐☐☐☐', 'testing'],
    ['☑☑☑☑☑☐☐☐', 'testing'],
    ['☑☑☑☑☑☑☐☐', 'testing'],
    ['☑☑☑☑☑☑☑☐', 'testing'],
    ['☑☑☑☑☑☑☑☑', 'testing'],
  ],
  // Nova — twin sparks travelling as the prototype materializes
  prototype: [
    ['✦·✧·····', 'generating'],
    ['·✦·✧····', 'generating'],
    ['··✦·✧···', 'generating'],
    ['···✦·✧··', 'generating'],
    ['····✦·✧·', 'generating'],
    ['·····✦·✧', 'generating'],
    ['······✦·', 'generating'],
    ['·······✦', 'generating'],
  ],
  // Bora — a pen stroke sketching the frame
  figma_design: [
    ['╱·······', 'sketching'],
    ['·╱······', 'sketching'],
    ['··╱·····', 'sketching'],
    ['···╱····', 'sketching'],
    ['····╱···', 'sketching'],
    ['·····╱··', 'sketching'],
    ['······╱·', 'sketching'],
    ['·······╱', 'sketching'],
  ],
  // Kira — the request/response handshake bouncing back and forth
  api_spec: [
    ['→·······', 'contracting'],
    ['·→······', 'contracting'],
    ['··→·····', 'contracting'],
    ['···→····', 'contracting'],
    ['····←···', 'contracting'],
    ['···←····', 'contracting'],
    ['··←·····', 'contracting'],
    ['·←······', 'contracting'],
  ],
  // Ivy — a settling tide
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
  // Vera — the per-feature suites breathing together into one
  epic_qa: [
    ['≡·······', 'synthesizing'],
    ['≡≡······', 'synthesizing'],
    ['≡≡≡·····', 'synthesizing'],
    ['≡≡≡≡····', 'synthesizing'],
    ['≡≡≡≡≡···', 'synthesizing'],
    ['≡≡≡≡····', 'synthesizing'],
    ['≡≡≡·····', 'synthesizing'],
    ['≡≡······', 'synthesizing'],
  ],
  // System — feature branches converging into one backlog, then back apart
  backlog_merge: [
    ['▶······◀', 'merging'],
    ['·▶····◀·', 'merging'],
    ['··▶··◀··', 'merging'],
    ['···▶◀···', 'merging'],
    ['···◀▶···', 'merging'],
    ['··◀··▶··', 'merging'],
    ['·◀····▶·', 'merging'],
    ['◀······▶', 'merging'],
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

/**
 * Dynamic feature/QA sub-stages (story_decomposition_F1, qa_engineer_F2,
 * story_decomposition_F1_qa, ...) share their base stage's animation rather
 * than each needing its own entry above.
 */
function baseStageKey(stageName: string): string {
  const match = stageName.match(/^(.+?)_F\d+(_qa)?$/);
  if (!match) return stageName;
  return match[2] ? 'qa_engineer' : match[1];
}

export function AgentAnimation({ stageName }: { stageName: string }) {
  const frames = STAGE_FRAMES[baseStageKey(stageName)] ?? DEFAULT_FRAMES;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % frames.length), 160);
    return () => clearInterval(id);
  }, [frames.length]);

  const [bar, action] = frames[frame];

  return (
    <div className="font-mono text-[10px] text-brand-500 dark:text-brand-400 leading-tight select-none whitespace-nowrap overflow-hidden">
      <span className="opacity-75 tracking-widest">{bar}</span>
      <span className="ml-1.5 opacity-40">{action}…</span>
    </div>
  );
}
