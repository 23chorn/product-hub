import type { ReactNode } from 'react';

// ── Shared visual primitives used across EpicFeaturesView, BacklogView, and
//    the tab shells — change here and every panel updates automatically. ──────

/** Collapse/expand indicator — a unicode glyph rather than an SVG, matching the glyph-based
 *  status icons used throughout workflow/pipeline-terminal (StatusIcon, EVENT_CFG). Swaps
 *  glyph shape on toggle instead of rotating, so no transform/transition is needed. */
export function Chevron({ expanded, className = 'w-3.5 text-surface-400' }: { expanded: boolean; className?: string }) {
  return (
    <span className={`${className} flex-shrink-0 inline-block text-center font-mono leading-none select-none`} aria-hidden="true">
      {expanded ? '▾' : '▸'}
    </span>
  );
}

export function InitiativeHeader({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Initiative</span>
      <p className="text-base font-bold text-surface-900 dark:text-surface-100 truncate">{title}</p>
    </div>
  );
}

export function PhaseTag({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${colorClass}`}>{label}</span>
  );
}

/** Terminal-window title-bar strip for a collapsible card header — mono label on the left,
 *  a right-aligned mono readout on the right. Mirrors the seq-number/updated-at strip on
 *  home/InitiativeCard.tsx, applied here to Epic-level cards (the top of the hierarchy, where
 *  a persistent chrome bar reads best). */
export function ChromeStrip({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 font-mono text-[10px]">
      <span className="font-semibold uppercase tracking-widest text-surface-500 dark:text-surface-400 truncate">{left}</span>
      {right != null && <span className="flex-shrink-0 text-surface-400 dark:text-surface-500">{right}</span>}
    </div>
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
