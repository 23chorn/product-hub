import { useState } from 'react';

/** Long-form text (epic/initiative descriptions, QA suite notes) clamped to a few lines by
 *  default, with a toggle to read the full text. */
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <p className={`${className ?? ''} ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
      <button
        onClick={() => setExpanded(e => !e)}
        className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline mt-0.5"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}
