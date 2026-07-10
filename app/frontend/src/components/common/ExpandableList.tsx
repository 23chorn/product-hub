import { useState } from 'react';
import { Chevron } from './Chevron';

/** A bullet list collapsed to a preview count by default — click the label to reveal the
 *  rest, chevron in line with it, same as ExpandableText / the epic/feature accordions
 *  (for lists, e.g. "out of scope" items, long enough to dominate their card). The label
 *  lives here rather than being rendered separately by the caller so the chevron always
 *  sits next to it, not trailing below the list content. */
export function ExpandableList({ label, items, previewCount = 2 }: { label?: string; items: string[]; previewCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = items.length > previewCount;
  const visible = expanded ? items : items.slice(0, previewCount);

  return (
    <div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
        disabled={!hasMore}
        className="w-full flex items-center gap-1.5 text-left disabled:cursor-default"
      >
        {hasMore && <Chevron expanded={expanded} className="w-3 text-surface-400 flex-shrink-0" />}
        {label && (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">{label}</p>
        )}
      </button>
      <ul className="space-y-0.5 mt-1">
        {visible.map((item, i) => (
          <li key={i} className="text-xs text-surface-500 dark:text-surface-400 flex gap-1.5">
            <span className="flex-shrink-0">–</span><span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
