import { useState } from 'react';
import type { TestCase, QATestSuite } from '@pap/shared';
import { ExpandableText } from '../common/ExpandableText';
import { DeleteItemButton } from '../common/DeleteItemButton';
import { normalizePrdId } from './EpicFeaturesView';

/** Remove one test case by its position in data.test_cases. The view groups/reorders
 *  cases by type or priority for display via .filter() (preserves object identity), so
 *  callers find `index` with data.test_cases.indexOf(tc) rather than matching by id —
 *  id uniqueness across cases isn't guaranteed. */
export function removeTestCase(data: QATestSuite, index: number): QATestSuite {
  return { ...data, test_cases: data.test_cases.filter((_, i) => i !== index) };
}

// Keys match VALID_TEST_TYPES in app/backend/src/agents/tool-validators.ts — keep in sync.
const TYPE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  happy_path:  { label: 'Happy Path',  color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',   dot: 'bg-green-400' },
  negative:    { label: 'Negative',    color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',           dot: 'bg-red-400' },
  edge:        { label: 'Edge Case',   color: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400', dot: 'bg-fuchsia-400' },
  boundary:    { label: 'Boundary',    color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',   dot: 'bg-amber-400' },
  security:    { label: 'Security',    color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400', dot: 'bg-cyan-400' },
  performance: { label: 'Performance', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', dot: 'bg-orange-400' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-semibold', dot: 'bg-red-400' },
  high:     { label: 'High',     color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400', dot: 'bg-amber-400' },
  medium:   { label: 'Medium',   color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', dot: 'bg-blue-400' },
  low:      { label: 'Low',      color: 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400', dot: 'bg-surface-400' },
};

const TYPE_ORDER = ['happy_path', 'negative', 'edge', 'boundary', 'security', 'performance'];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

/** Resolve display metadata for a test type, with a generic fallback for types outside TYPE_ORDER
 *  (e.g. legacy fixtures) so every test case still gets a labeled, colored category. */
export function typeMeta(type: string): { label: string; color: string; dot: string } {
  return TYPE_CONFIG[type] ?? {
    label: type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    color: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
    dot: 'bg-surface-400',
  };
}

/** Resolve display metadata for a priority, with a generic fallback for values outside
 *  PRIORITY_CONFIG, mirroring typeMeta. */
function priorityMeta(priority: string): { label: string; color: string; dot: string } {
  return PRIORITY_CONFIG[priority] ?? {
    label: priority.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    color: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
    dot: 'bg-surface-400',
  };
}

/** Display metadata for a phase label — phases have no fixed palette (unlike type/priority),
 *  so every phase renders with the same neutral style; only the label varies. */
function phaseMeta(phase: string): { label: string; color: string; dot: string } {
  return {
    label: phase,
    color: 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400',
    dot: 'bg-surface-400',
  };
}

/** Extract [feature number, test case number] from a test case for sort ordering.
 *  Feature number comes from story_ref (e.g. "F1.S3" -> 1), since epic-level ids
 *  (TC-UI-NNN / TC-API-NNN) don't encode it; falls back to the legacy TC-F<n>-NNN id
 *  format when story_ref is absent or not a plain string. Test case number is the
 *  trailing counter in the id (e.g. TC-UI-007 -> 7). Missing pieces sort last. */
function testCaseSortKey(tc: TestCase): [number, number] {
  const ref = typeof tc.story_ref === 'string' ? tc.story_ref : undefined;
  const featureMatch = ref?.match(/^F(\d+)/) ?? tc.id.match(/^TC-F(\d+)-/);
  const featureNum = featureMatch ? parseInt(featureMatch[1], 10) : Number.MAX_SAFE_INTEGER;
  const caseMatch = tc.id.match(/(\d+)$/);
  const caseNum = caseMatch ? parseInt(caseMatch[1], 10) : Number.MAX_SAFE_INTEGER;
  return [featureNum, caseNum];
}

/** Split a story_ref (or linkedStory) value into individual "Fx.Sy" badges. Handles the
 *  normal array form and a single clean ref, and defensively un-mangles artifacts
 *  generated before the array-based story_ref prompt guidance, where the model
 *  concatenated multiple refs into one string with no delimiter (e.g. "F1.S3F1.S4F1.S5")
 *  — without this, that string renders as one unreadable badge instead of several. */
export function splitStoryRefs(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.flatMap(v => v.match(/F\d+\.S\d+/g) ?? [v]);
}

/** Sort test cases by feature number then test case number, so each category section
 *  reads in a stable, predictable order rather than raw artifact/merge order. */
function sortTestCases(testCases: TestCase[]): TestCase[] {
  return [...testCases].sort((a, b) => {
    const [featureA, caseA] = testCaseSortKey(a);
    const [featureB, caseB] = testCaseSortKey(b);
    return featureA - featureB || caseA - caseB;
  });
}

/** Group test cases by their actual `type` value — known TYPE_ORDER types first (in that
 *  order), then any other types in first-seen order — so every category present in the data
 *  gets its own square and section instead of being lumped into a catch-all "Other" bucket.
 *  Cases within each group are ordered by feature number then test case number. */
export function groupByType(testCases: TestCase[]): Array<[string, TestCase[]]> {
  const present = Array.from(new Set(testCases.map(tc => tc.type)));
  const ordered = [...TYPE_ORDER.filter(t => present.includes(t)), ...present.filter(t => !TYPE_ORDER.includes(t))];
  return ordered.map(type => [type, sortTestCases(testCases.filter(tc => tc.type === type))]);
}

/** Group test cases by their actual `priority` value, mirroring groupByType — known
 *  PRIORITY_ORDER priorities first (in that order), then any other values in first-seen order.
 *  Cases within each group are ordered by feature number then test case number. */
function groupByPriority(testCases: TestCase[]): Array<[string, TestCase[]]> {
  const present = Array.from(new Set(testCases.map(tc => tc.priority)));
  const ordered = [...PRIORITY_ORDER.filter(p => present.includes(p)), ...present.filter(p => !PRIORITY_ORDER.includes(p))];
  return ordered.map(priority => [priority, sortTestCases(testCases.filter(tc => tc.priority === priority))]);
}

/** Feature key ("F1") a story_ref token ("F1.S3") or bare feature ref belongs to. */
function featureKeyOf(ref: string): string {
  return ref.match(/^(F\d+)/)?.[1] ?? ref;
}

/** Every distinct phase label a test case's story refs touch, via phaseByFeatureKey. Empty
 *  when none of its referenced features resolve to a known phase. */
export function phasesForTestCase(tc: TestCase, phaseByFeatureKey: Record<string, string>): string[] {
  const featureKeys = new Set(splitStoryRefs(tc.story_ref ?? tc.linkedStory).map(featureKeyOf));
  return [...new Set([...featureKeys].map(fk => phaseByFeatureKey[fk]).filter((p): p is string => !!p))];
}

/** Group test cases by phase (via phaseByFeatureKey), mirroring groupByType/groupByPriority.
 *  A case whose story refs span more than one phase appears under every phase it touches —
 *  intentionally not deduped — so a reviewer scanning one phase's coverage still sees it, and
 *  the cross-phase badge (see TestCaseCard) makes clear it's a deliberate shared flow rather
 *  than an accidental duplicate written separately in another phase. */
export function groupByPhase(testCases: TestCase[], phaseByFeatureKey: Record<string, string>, phaseOrder: string[]): Array<[string, TestCase[]]> {
  const byPhase = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    const phases = phasesForTestCase(tc, phaseByFeatureKey);
    for (const phase of phases.length > 0 ? phases : ['Unassigned']) {
      if (!byPhase.has(phase)) byPhase.set(phase, []);
      byPhase.get(phase)!.push(tc);
    }
  }
  const present = [...byPhase.keys()];
  const ordered = [...phaseOrder.filter(p => present.includes(p)), ...present.filter(p => !phaseOrder.includes(p))];
  return ordered.map(phase => [phase, sortTestCases(byPhase.get(phase)!)]);
}

/** The ADO Test Plan URL for whichever phase a test case's story refs resolve to first. */
function planUrlForTestCase(tc: TestCase, planUrlByFeatureKey: Record<string, string>): string | undefined {
  const featureKeys = new Set(splitStoryRefs(tc.story_ref ?? tc.linkedStory).map(featureKeyOf));
  for (const fk of featureKeys) {
    if (planUrlByFeatureKey[fk]) return planUrlByFeatureKey[fk];
  }
  return undefined;
}

function TestCaseCard({ tc, frMap, phaseByFeatureKey, planUrlByFeatureKey, onDelete }: {
  tc: TestCase;
  frMap?: Record<string, string>;
  phaseByFeatureKey?: Record<string, string>;
  planUrlByFeatureKey?: Record<string, string>;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const typeConf = typeMeta(tc.type);
  const prioConf = priorityMeta(tc.priority);

  const hasScenario = tc.scenario && (tc.scenario.given?.length || tc.scenario.when?.length || tc.scenario.then?.length);
  const hasSteps = tc.steps && tc.steps.length > 0;
  const isCrossPhase = !!phaseByFeatureKey && phasesForTestCase(tc, phaseByFeatureKey).length > 1;
  const planUrl = planUrlByFeatureKey ? planUrlForTestCase(tc, planUrlByFeatureKey) : undefined;

  return (
    <div className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
      <div className="flex items-stretch hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-start gap-3"
      >
        <div className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${typeConf.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-surface-400 dark:text-surface-500">{tc.id}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${prioConf.color}`}>{prioConf.label}</span>
            {tc.layer === 'technical' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">API</span>
            )}
            {isCrossPhase && (
              <span
                title="This test case's stories span more than one phase — a deliberate shared flow, not a duplicate."
                className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 font-medium cursor-help"
              >
                Cross-phase
              </span>
            )}
          </div>
          <p className="text-base text-surface-800 dark:text-surface-200 mt-0.5 leading-snug truncate min-w-0">{tc.title}</p>
          {/* FR/story refs kept on their own row, separate from the fixed id/priority/layer badges
              above — their count varies per test case, so mixing them into the same row made some
              rows wrap to two lines and others not, producing inconsistent row heights. */}
          {((Array.isArray(tc.prd_ref) ? tc.prd_ref : tc.prd_ref ? [tc.prd_ref] : []).length > 0 || splitStoryRefs(tc.story_ref ?? tc.linkedStory).length > 0) && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {(Array.isArray(tc.prd_ref) ? tc.prd_ref : tc.prd_ref ? [tc.prd_ref] : []).map(fr => {
                const key = normalizePrdId(fr);
                const tip = frMap?.[key];
                return (
                  <span
                    key={fr}
                    title={tip}
                    className={`text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 ${tip ? 'cursor-help' : ''}`}
                  >
                    {key}
                  </span>
                );
              })}
              {splitStoryRefs(tc.story_ref ?? tc.linkedStory).map(ref => (
                <span
                  key={ref}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400"
                >
                  {ref}
                </span>
              ))}
            </div>
          )}
          {tc.endpoint && (
            <p className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 mt-0.5">{tc.endpoint.method} {tc.endpoint.path}</p>
          )}
          {tc.category && <p className="text-[10px] text-surface-400 dark:text-surface-500 mt-0.5">{tc.category}</p>}
        </div>
        <svg className={`w-3.5 h-3.5 text-surface-400 flex-shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {planUrl && (
        <a
          href={planUrl}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          title="Open this test case's ADO Test Plan"
          className="flex items-center px-2 text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
      {onDelete && (
        <div className="flex items-center pr-2">
          <DeleteItemButton onDelete={onDelete} label="Delete test case" />
        </div>
      )}
      </div>

      {open && (
        <div className="border-t border-surface-100 dark:border-surface-700 px-3 py-3 space-y-3 bg-surface-50/50 dark:bg-surface-800/30 text-sm">
          {tc.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Description</p>
              <p className="text-xs text-surface-700 dark:text-surface-300">{tc.description}</p>
            </div>
          )}

          {tc.preconditions && tc.preconditions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Preconditions</p>
              {tc.preconditions.map((p, i) => (
                <p key={i} className="text-xs text-surface-600 dark:text-surface-400 ml-2">· {p}</p>
              ))}
            </div>
          )}

          {/* Gherkin scenario (old format) */}
          {hasScenario && (
            <div className="rounded bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5 font-mono text-xs">
              {tc.scenario!.given.map((s, i) => (
                <p key={i}><span className="font-bold text-fuchsia-600 dark:text-fuchsia-400">{i === 0 ? 'Given' : 'And'} </span><span className="text-surface-700 dark:text-surface-300">{s}</span></p>
              ))}
              {tc.scenario!.when.map((s, i) => (
                <p key={i}><span className="font-bold text-blue-600 dark:text-blue-400">{i === 0 ? 'When' : 'And'} </span><span className="text-surface-700 dark:text-surface-300">{s}</span></p>
              ))}
              {tc.scenario!.then.map((s, i) => (
                <p key={i}><span className="font-bold text-green-600 dark:text-green-400">{i === 0 ? 'Then' : 'And'} </span><span className="text-surface-700 dark:text-surface-300">{s}</span></p>
              ))}
            </div>
          )}

          {/* Steps + expected result (new format) */}
          {!hasScenario && hasSteps && (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Steps</p>
                <ol className="list-decimal list-inside space-y-1">
                  {tc.steps!.map((step, i) => (
                    <li key={i} className="text-xs text-surface-700 dark:text-surface-300">{step}</li>
                  ))}
                </ol>
              </div>
              {tc.expectedResult && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Expected Result</p>
                  <p className="text-xs text-surface-700 dark:text-surface-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded px-2.5 py-2">
                    {tc.expectedResult}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Test data */}
          {tc.test_data && Object.keys(tc.test_data).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Test data</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(tc.test_data).map(([k, v]) => (
                  <span key={k} className="text-[10px] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded px-1.5 py-0.5 font-mono text-surface-600 dark:text-surface-400">
                    {k}: <span className="text-brand-600 dark:text-brand-400">{String(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags + automation notes */}
          {(tc.tags?.length || tc.automation_notes) && (
            <div className="flex items-start justify-between gap-4">
              {tc.tags && tc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tc.tags.map(tag => (
                    <span key={tag} className="text-[10px] bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 rounded px-1.5 py-0.5 font-mono">{tag}</span>
                  ))}
                </div>
              )}
              {tc.automation_notes && (
                <p className="text-[10px] text-surface-400 dark:text-surface-500 italic max-w-xs text-right">{tc.automation_notes}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QATestsView({ data, frMap, phaseByFeatureKey, planUrlByFeatureKey, phaseOrder, onDeleteTestCase }: {
  data: QATestSuite;
  frMap?: Record<string, string>;
  /** Feature key ("F1") -> phase label ("MVP", "Phase 2", ...), enabling the "Phase" grouping
   *  toggle below. Omit where phase data isn't available (e.g. no epic_feature_planner run). */
  phaseByFeatureKey?: Record<string, string>;
  /** Feature key -> that phase's ADO Test Plan URL, shown as a per-test-case link. */
  planUrlByFeatureKey?: Record<string, string>;
  /** Canonical phase display order (e.g. epicFeatures.phases labels); falls back to first-seen order. */
  phaseOrder?: string[];
  onDeleteTestCase?: (index: number) => void;
}) {
  // Counts (and the test case groups below) are derived from the test cases themselves rather
  // than the artifact's separate `coverage` field — that field is frequently absent (current
  // multi-agent QA artifacts don't populate it) or stale (a merged/filtered test_cases list
  // doesn't recompute it), so test_cases is the only count that's always correct.
  const totalCount = data.test_cases.length;
  const hasPhaseData = !!phaseByFeatureKey && Object.keys(phaseByFeatureKey).length > 0;
  const [groupMode, setGroupMode] = useState<'type' | 'priority' | 'phase'>('type');
  const effectiveGroupMode = groupMode === 'phase' && !hasPhaseData ? 'type' : groupMode;
  const groupedCases = effectiveGroupMode === 'type' ? groupByType(data.test_cases)
    : effectiveGroupMode === 'priority' ? groupByPriority(data.test_cases)
    : groupByPhase(data.test_cases, phaseByFeatureKey!, phaseOrder ?? []);
  const groupMeta = effectiveGroupMode === 'type' ? typeMeta : effectiveGroupMode === 'priority' ? priorityMeta : phaseMeta;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    // font-sans: this view can render inside the font-mono pipeline terminal subtree
    // (the per-refinement Stories/Tests overview); pin the app font so it never inherits monospace.
    <div className="space-y-5 font-sans">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">{data.suite ?? 'QA Test Suite'}</h2>
        {data.version && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">v{data.version}</p>}
        {data.metadata?.notes && (
          <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-2.5 py-2">
            <ExpandableText text={data.metadata.notes} className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed" />
          </div>
        )}
      </div>

      {/* Test counts — total on its own row, then a toggleable type/priority breakdown. Counts
          are derived from test_cases directly rather than the artifact's separate `coverage`
          field, which is frequently absent or stale. Switching the toggle also re-groups the
          test case list below. */}
      {totalCount > 0 && (
        <div className="space-y-3">
          <div className="bg-surface-50 dark:bg-surface-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">Total Test Cases</span>
            <span className="text-lg font-bold text-surface-900 dark:text-surface-100">{totalCount}</span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">
                By {effectiveGroupMode === 'type' ? 'Type' : effectiveGroupMode === 'priority' ? 'Priority' : 'Phase'}
              </p>
              <div className="inline-flex rounded-md border border-surface-200 dark:border-surface-700 overflow-hidden">
                {(hasPhaseData ? (['type', 'priority', 'phase'] as const) : (['type', 'priority'] as const)).map((mode, i) => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                      effectiveGroupMode === mode
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                    } ${i > 0 ? 'border-l border-surface-200 dark:border-surface-700' : ''}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className={`grid gap-1.5 ${effectiveGroupMode === 'type' ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {groupedCases.map(([key, cases]) => {
                const meta = groupMeta(key);
                return (
                  <div key={key} className={`${meta.color} rounded-md px-2 py-1.5 text-center`}>
                    <p className="text-sm font-bold">{cases.length}</p>
                    <p className="text-[9px] uppercase tracking-wide mt-0.5 opacity-80">{meta.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Test case groups — grouped by the same toggle above, collapsed by default. */}
      {groupedCases.map(([key, cases]) => {
        const meta = groupMeta(key);
        const isOpen = expandedGroups.has(key);
        return (
          <div key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="w-full flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2"
            >
              <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
              <span className="font-normal text-surface-400">({cases.length})</span>
            </button>
            {isOpen && (
              <div className="space-y-2">
                {cases.map(tc => (
                  <TestCaseCard
                    key={tc.id}
                    tc={tc}
                    frMap={frMap}
                    phaseByFeatureKey={phaseByFeatureKey}
                    planUrlByFeatureKey={planUrlByFeatureKey}
                    onDelete={onDeleteTestCase ? () => onDeleteTestCase(data.test_cases.indexOf(tc)) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
