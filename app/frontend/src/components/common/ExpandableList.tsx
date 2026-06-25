import { useState } from 'react';

/** A bullet list collapsed to a preview count by default, with a toggle to reveal the rest —
 *  for lists (e.g. "out of scope" items) long enough to dominate their card. */
export function ExpandableList({ items, previewCount = 2 }: { items: string[]; previewCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, previewCount);
  const hiddenCount = items.length - visible.length;
  return (
    <>
      <ul className="space-y-0.5">
        {visible.map((item, i) => (
          <li key={i} className="text-xs text-surface-500 dark:text-surface-400 flex gap-1.5">
            <span className="flex-shrink-0">–</span><span>{item}</span>
          </li>
        ))}
      </ul>
      {items.length > previewCount && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline mt-1"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </>
  );
}
