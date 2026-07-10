import { useState } from 'react';
import { formatTs, LOG_ROW_GRID } from './event-config';

/** Renders **bold** markers as real emphasis instead of stripping them — the curator/
 *  critic bolds the specific field or verdict that changed, which is worth keeping. */
function renderLine(line: string) {
  return line.split(/(\*\*.*?\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-surface-800 dark:text-surface-200">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

/** Collapsible detail row used for multi-line events (curator reasoning, critic verdict).
 *  Shares EventRow's glyph/timestamp column grid — flatter than a rounded card (a solid
 *  left accent bar carries the type color, no border on the other three sides), but keeps
 *  a light permanent tint so the row still stands out from the plain log lines around it.
 *  The whole block (header + preview/expanded text) is one button, so clicking anywhere
 *  in it toggles — not just the header line. */
export function ExpandableRow({
  label,
  labelColor,
  accentColor,
  bgColor,
  content,
  timestamp,
}: {
  label: string;
  labelColor: string;
  accentColor: string;
  bgColor: string;
  content: string;
  timestamp: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n').filter(Boolean);
  const hasMore = lines.length > 1;
  const displayLines = expanded ? lines : lines.slice(0, 1);

  return (
    <div className={`${LOG_ROW_GRID} items-start px-2 py-1`}>
      <span className="text-[11px] pt-1.5" />
      <div className={`border-l-2 ${accentColor} ${bgColor}`}>
        <button
          onClick={() => hasMore && setExpanded(e => !e)}
          className={`w-full text-left pl-2.5 pr-2 py-1 transition-[filter] ${hasMore ? 'cursor-pointer hover:brightness-95 dark:hover:brightness-125' : 'cursor-default'}`}
        >
          <div className="flex items-center gap-2">
            {hasMore ? (
              <span
                className={`inline-block flex-shrink-0 text-[10px] ${labelColor} opacity-70 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                ▸
              </span>
            ) : (
              <span className="w-2.5 flex-shrink-0" />
            )}
            <span className={`text-[9px] font-semibold uppercase tracking-widest font-mono flex-1 text-left ${labelColor}`}>
              {label}
            </span>
            {!expanded && hasMore && (
              <span className="text-[9px] text-surface-400 dark:text-surface-600 font-mono normal-case tracking-normal flex-shrink-0">
                +{lines.length - 1} more
              </span>
            )}
          </div>
          <div className="pt-0.5">
            {displayLines.map((line, i) => (
              <p key={i} className="text-[10px] text-surface-600 dark:text-surface-400 font-mono leading-relaxed">
                {renderLine(line)}
              </p>
            ))}
          </div>
        </button>
      </div>

      <span className="text-[11px] text-surface-400 dark:text-surface-700 font-mono tabular-nums text-right pt-1.5">{formatTs(timestamp)}</span>
    </div>
  );
}
