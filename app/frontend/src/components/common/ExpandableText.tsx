import { useEffect, useRef, useState } from 'react';
import { Chevron } from './Chevron';

/** Long-form text (epic/initiative descriptions, QA suite notes) clamped to a few lines by
 *  default — click anywhere on it to expand/collapse, same as the epic/feature accordions
 *  (see EpicFeaturesView's PhaseSection/FeatureCard). Only clickable when actually truncated. */
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (textRef.current) setIsTruncated(textRef.current.scrollHeight > textRef.current.clientHeight);
  }, [text]);

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
      disabled={!isTruncated}
      className="block w-full text-left disabled:cursor-default"
    >
      <p ref={textRef} className={`${className ?? ''} ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
      {isTruncated && <Chevron expanded={expanded} className="w-3 text-surface-400 mt-0.5" />}
    </button>
  );
}
