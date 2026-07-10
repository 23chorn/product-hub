import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chevron } from '../common/Chevron';

// ── Shared visual primitives used across EpicFeaturesView, BacklogView, and
//    the tab shells — change here and every panel updates automatically. ──────

// Re-exported so existing call sites importing Chevron from here keep working — it now
// lives in common/ (see Chevron.tsx) since common-level components (ExpandableText,
// ExpandableList) need it too, and common/ can't import from artifact/.
export { Chevron };

export function PhaseTag({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${colorClass}`}>{label}</span>
  );
}

/** Terminal-window title-bar strip for a collapsible card header — mono label on the left,
 *  a right-aligned mono readout on the right. Mirrors the seq-number/updated-at strip on
 *  home/InitiativeCard.tsx. Used by both InitiativeCard (below) and each Epic-level card, so
 *  the two top tiers of the hierarchy read as the same kind of "windowed" card — only the
 *  glyph and weight in `left` (■ initiative vs ◆ epic) tells them apart. */
export function ChromeStrip({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 font-mono text-[10px]">
      <span className="font-semibold uppercase tracking-widest text-surface-500 dark:text-surface-400 truncate">{left}</span>
      {right != null && <span className="flex-shrink-0 text-surface-400 dark:text-surface-500">{right}</span>}
    </div>
  );
}

/** Initiative-level overview card — the top of the hierarchy (Initiative → Epic → Feature),
 *  so it gets the same ChromeStrip "windowed card" treatment as an Epic card instead of a
 *  bare label + bold title floating with no chrome. `right` mirrors an Epic card's own
 *  right-aligned readout (e.g. "N phases · N features"). Title text is larger than an Epic
 *  card's (text-xl vs text-lg) since this is one tier up in the hierarchy, and — when
 *  `description` is long enough to clamp — the chevron sits next to the title as the
 *  click target, same as PhaseSection/FeatureCard's header-toggles-body pattern, rather
 *  than a separate "Show more" link buried under the text. `children` is everything else
 *  in the card body (business value, PRD link, out-of-scope list, ...), always visible —
 *  left to the caller since it varies by view. */
export function InitiativeCard({ title, right, description, children }: {
  title?: string;
  right?: ReactNode;
  description?: string | null;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (descRef.current) setIsTruncated(descRef.current.scrollHeight > descRef.current.clientHeight);
  }, [description]);

  if (!title) return null;
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 overflow-hidden">
      <ChromeStrip left="■ initiative" right={right} />
      <div className="p-4 space-y-2">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          disabled={!isTruncated}
          className="w-full flex items-start gap-2 text-left disabled:cursor-default"
        >
          {isTruncated && <Chevron expanded={expanded} className="w-4 mt-1 text-surface-400 flex-shrink-0" />}
          <p className="flex-1 min-w-0 text-xl font-bold text-surface-900 dark:text-surface-100 truncate">{title}</p>
        </button>
        {description && (
          <p
            ref={descRef}
            className={`text-sm text-surface-600 dark:text-surface-300 ${expanded ? '' : 'line-clamp-3'}`}
          >
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

/** Terminal-style header bar for review side-panels (Issues, Questions, the read-only review
 *  flyout) — mono uppercase label + optional right-aligned meta readout + close glyph, in
 *  place of the bold-title/light-subtitle header those panels used before. `actions` sits
 *  left of the close glyph (e.g. a "view issues" link). */
export function PanelChromeHeader({ label, meta, onClose, actions }: {
  label: ReactNode;
  meta?: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 flex-shrink-0 flex items-center justify-between gap-2 font-mono text-[10px]">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-semibold uppercase tracking-widest text-surface-600 dark:text-surface-300 truncate">{label}</span>
        {meta != null && <span className="text-surface-400 dark:text-surface-500 flex-shrink-0">{meta}</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {actions}
        {onClose && (
          <button onClick={onClose} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors leading-none" title="Close">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

const QUESTION_SOURCE_STYLES: Record<'flint' | 'document', string> = {
  flint: 'text-amber-600 dark:text-amber-400',
  document: 'text-cyan-600 dark:text-cyan-400',
};

/** Tags a question as coming from Flint's critic pass or from the document's own open
 *  questions — used by both the interactive review panel and the read-only review flyout so
 *  a mixed list of questions still reads as one shape with a clear provenance per item. */
export function QuestionSourceTag({ source }: { source: 'flint' | 'document' }) {
  return (
    <span className={`font-mono text-[10px] uppercase tracking-wide flex-shrink-0 ${QUESTION_SOURCE_STYLES[source]}`}>
      {source === 'flint' ? '◆ flint' : '◇ open'}
    </span>
  );
}

/** Dot + mono label — status readout used in place of a solid-fill pill (effort, dependency,
 *  test-type/priority). `dotClass` sets the indicator color; `textClass` colors the label to
 *  match without filling a background, so a row of these reads as a terminal status line
 *  rather than a row of colored tags. */
export function DotLabel({ label, dotClass, textClass = 'text-surface-600 dark:text-surface-400' }: {
  label: ReactNode;
  dotClass: string;
  textClass?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
      {label}
    </span>
  );
}

/** Feature-level "deferred to / depends on / parallel" badges — identical logic previously
 *  duplicated between EpicFeaturesView's FeatureCard and BacklogView's renderFeatureRow.
 *  `dependsOn` being present means the feature is gated on those titles (sequential); its
 *  absence means the feature can run in parallel with its siblings. */
export function FeatureDependencyBadges({ deferredTo, dependsOn }: { deferredTo?: string | null; dependsOn?: string[] }) {
  return (
    <>
      {deferredTo && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-500 flex-shrink-0">
          → {deferredTo}
        </span>
      )}
      {(dependsOn?.length ?? 0) > 0 ? (
        <DotLabel
          dotClass="bg-surface-400 dark:bg-surface-500"
          textClass="text-surface-500 dark:text-surface-400"
          label={<span title={`Cannot start until: ${dependsOn!.join(', ')}`}>→ after {dependsOn!.join(', ')}</span>}
        />
      ) : (
        <DotLabel dotClass="bg-brand-400 dark:bg-brand-500" textClass="text-brand-600 dark:text-brand-400" label="parallel" />
      )}
    </>
  );
}

// Fixed (not theme-token) colors — this console block is deliberately unconditionally dark in
// every theme (see AcceptanceCriteriaConsole below), so its text must be pinned to a literal
// palette rather than surface-*, which some themes (e.g. High Contrast) intentionally invert.
const AC_KEYWORD_COLOR: Record<string, string> = {
  given: 'text-fuchsia-400',
  when: 'text-blue-400',
  then: 'text-green-400',
  and: 'text-slate-400',
  but: 'text-slate-400',
};

/** One acceptance-criteria line, split on Given/When/Then/And/But keyword boundaries so each
 *  clause starts on its own line — same keyword coloring as the Gherkin scenario box in
 *  QATestsView. Falls back to a single plain line for free-text criteria with no G/W/T
 *  structure, rather than forcing every AC into a scenario shape it doesn't have. */
function AcceptanceCriterionLine({ text }: { text: string }) {
  const parts = text.split(/\b(Given|When|Then|And|But)\b/gi);
  if (parts.length === 1) return <p className="text-slate-300">{text}</p>;
  return (
    <p>
      {parts.map((part, pi) => {
        if (!/^(Given|When|Then|And|But)$/i.test(part)) return <span key={pi} className="text-slate-300">{part}</span>;
        return <span key={pi}>{pi > 1 && <br />}<span className={`font-bold ${AC_KEYWORD_COLOR[part.toLowerCase()]}`}>{part}</span></span>;
      })}
    </p>
  );
}

/** Acceptance criteria rendered as console blocks, matching the QA test case Gherkin styling
 *  (unconditionally dark, monospace, colored keywords) rather than a plain checklist — makes
 *  a story's AC read as the same kind of test-shaped artifact as its test cases. Shared by
 *  BacklogView's story row/Tier-1 view and QuickFeaturePanel/QuickTicketPanel's story cards. */
export function AcceptanceCriteriaConsole({ items }: { items: string[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((ac, i) => (
        <div key={i} className="rounded bg-slate-900 border border-slate-700 p-2.5 font-mono text-xs">
          <AcceptanceCriterionLine text={ac} />
        </div>
      ))}
    </div>
  );
}

// ── Tab shell — outer container shared by all three artifact panel views ──────

interface TabDef {
  id: string;
  label: string;
  count?: number;
}

interface ArtifactTabShellProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: ReactNode;
}

export function ArtifactTabShell({ tabs, activeTab, onTabChange, children }: ArtifactTabShellProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {tabs.length > 1 && (
        <div className="flex border-b border-surface-200 dark:border-surface-700 flex-shrink-0 font-mono text-[11px]">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 px-4 py-2 lowercase transition-colors ${
                activeTab === tab.id
                  ? 'text-surface-900 dark:text-surface-100 bg-surface-50 dark:bg-surface-900/40 font-semibold'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
              }`}
            >
              {activeTab === tab.id ? '[ ' : ''}{tab.label}{tab.count != null && <span className="opacity-60"> · {tab.count}</span>}{activeTab === tab.id ? ' ]' : ''}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {children}
      </div>
    </div>
  );
}
