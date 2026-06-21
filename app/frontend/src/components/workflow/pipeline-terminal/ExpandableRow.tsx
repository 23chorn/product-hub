import { useState } from 'react';
import { formatTs } from './event-config';

/** Collapsible detail row used for multi-line events (curator reasoning, critic verdict). */
export function ExpandableRow({
  label,
  labelColor,
  borderColor,
  bgColor,
  content,
  timestamp,
}: {
  label: string;
  labelColor: string;
  borderColor: string;
  bgColor: string;
  content: string;
  timestamp: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n').filter(Boolean);
  const hasMore = lines.length > 1;
  const displayLines = expanded ? lines : lines.slice(0, 1);

  return (
    <div className={`mx-2 my-1 rounded border ${borderColor} ${bgColor}`}>
      <button
        onClick={() => hasMore && setExpanded(e => !e)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {hasMore && (
          <span className={`text-[9px] font-mono ${labelColor} opacity-60 w-3 flex-shrink-0`}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
        {!hasMore && <span className="w-3 flex-shrink-0" />}
        <span className={`text-[9px] font-semibold uppercase tracking-widest font-mono flex-1 text-left ${labelColor}`}>
          {label}
        </span>
        <span className="text-[9px] text-surface-400 dark:text-surface-700 font-mono flex-shrink-0">{formatTs(timestamp)}</span>
      </button>
      <div className="px-3 pb-2">
        {displayLines.map((line, i) => {
          const plain = line.replace(/\*\*(.*?)\*\*/g, '$1');
          return (
            <p key={i} className="text-[10px] text-surface-600 dark:text-surface-400 font-mono leading-relaxed">
              {plain}
            </p>
          );
        })}
        {!expanded && hasMore && (
          <p className="text-[9px] text-surface-400 dark:text-surface-600 font-mono mt-0.5">
            +{lines.length - 1} more line{lines.length - 1 !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
