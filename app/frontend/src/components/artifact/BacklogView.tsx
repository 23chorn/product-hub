import { useState } from 'react';
import type { WorkItemStateBucket, BacklogData, BacklogFeature, BacklogStory } from '@pap/shared';
import { featureLocalKey, storyLocalKey, backlogTier, getSprintMeta, getAllStories, getAllFeatures, storiesInDisplayOrder } from '@pap/shared';
import { WORK_ITEM_STATE_BUCKET_LABELS, WORK_ITEM_STATE_BUCKET_COLORS } from '../../utils/work-item-state-bucket';
import { toPhases, PHASE_COLORS, PrdRefTags, FrTags, FeatureKeyBadge, type EpicFeature, type EpicFeaturesData } from './EpicFeaturesView';
import { ExpandableText } from '../common/ExpandableText';
import { ExpandableList } from '../common/ExpandableList';
import { DeleteItemButton } from '../common/DeleteItemButton';
import { Chevron, InitiativeHeader, PhaseTag } from './ArtifactPrimitives';

const DEFAULT_PHASE_LABEL = 'MVP';
const UNKNOWN_PHASE_COLOR = 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300';

interface EpicSection {
  key: string;
  title: string;
  deliverable?: string;
  colorClass: string;
  entries: Array<{ feature: BacklogFeature; fi: number }>;
}

/** Title → canonical phase label, from the epic_feature_planner data — see buildEpicSections
 *  for why this is the source of truth instead of the backlog feature's own `.phase` field. */
function buildTitleToPhaseLabel(epicFeatures: EpicFeaturesData | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!epicFeatures) return map;
  for (const phase of toPhases(epicFeatures)) {
    for (const f of phase.features) map.set(f.title, phase.label);
  }
  return map;
}

/**
 * Group the merged backlog's features by phase into one section per phase — each phase was
 * planned as its own epic (epic_feature_planner's phase.epicTitle), so the Stories overview
 * should show them as separate epics too, not one epic spanning every phase. Falls back to
 * the original single-epic title when there's nothing to split (no epicFeatures data, or
 * every feature shares one phase) and to the bare phase label when there's no richer title.
 */
function buildEpicSections(features: BacklogFeature[], epicFeatures: EpicFeaturesData | null | undefined, fallbackTitle: string): EpicSection[] {
  const phases = epicFeatures ? toPhases(epicFeatures) : [];
  const phaseMetaByLabel = new Map(phases.map(p => [p.label, p]));
  const titleToPhase = buildTitleToPhaseLabel(epicFeatures);

  const grouped = new Map<string, Array<{ feature: BacklogFeature; fi: number }>>();
  const encounterOrder: string[] = [];
  features.forEach((feature, fi) => {
    // Prefer the epic plan's own phase assignment (joined by title, like buildEpicFeatureLookup
    // below) over the feature's self-reported `.phase` — that field is LLM-echoed text from the
    // per-feature refinement stage and can drift from the canonical label (typos, reformatting,
    // or silently defaulting to "MVP"), which was splitting features the epic plan grouped
    // together into separate sections purely because their phase strings no longer matched.
    const label = titleToPhase.get(feature.title) ?? feature.phase ?? DEFAULT_PHASE_LABEL;
    if (!grouped.has(label)) { grouped.set(label, []); encounterOrder.push(label); }
    grouped.get(label)!.push({ feature, fi });
  });

  // Canonical order: phases as planned, then any phase labels seen only in the backlog data.
  const planned = phases.map(p => p.label).filter(l => grouped.has(l));
  const order = [...planned, ...encounterOrder.filter(l => !planned.includes(l))];
  const singleSection = order.length <= 1;

  return order.map(label => {
    const meta = phaseMetaByLabel.get(label);
    return {
      key: label,
      title: meta?.epicTitle ?? (singleSection ? fallbackTitle : label),
      deliverable: meta?.deliverable,
      colorClass: PHASE_COLORS[label] ?? UNKNOWN_PHASE_COLOR,
      entries: grouped.get(label)!,
    };
  });
}

/** Match a backlog feature back to its planning-stage counterpart (rationale, PRD refs,
 *  dependencies) by phase + title — both are passed through verbatim into the refinement
 *  stage's prompts, so they're a reliable join key even though there's no shared id field. */
function buildEpicFeatureLookup(epicFeatures: EpicFeaturesData | null | undefined): Map<string, EpicFeature> {
  const map = new Map<string, EpicFeature>();
  if (!epicFeatures) return map;
  for (const phase of toPhases(epicFeatures)) {
    for (const f of phase.features) map.set(`${phase.label}::${f.title}`, f);
  }
  return map;
}

/**
 * Small state-bucket pill shown next to a story/feature title when `stateByLocalKey` is
 * provided. Fragile by construction: the local key is recomputed from the story/feature's
 * positional index in the *merged* `features` array, which only matches push-time order
 * because mergeBacklogs sorts by `num` ascending — nothing enforces that invariant here.
 */
function StateBucketPill({ bucket }: { bucket?: WorkItemStateBucket }) {
  if (!bucket) return null;
  return (
    <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${WORK_ITEM_STATE_BUCKET_COLORS[bucket]}`}>
      {WORK_ITEM_STATE_BUCKET_LABELS[bucket]}
    </span>
  );
}



/** Render hours with AI comparison: "3h (was 8h)" or just "8h" when not AI-assisted. */
function HoursDisplay({ story, aiAssisted }: { story: BacklogStory; aiAssisted: boolean }) {
  if (!story.estimatedHours) return null;
  if (aiAssisted && story.traditionalHours != null && story.traditionalHours !== story.estimatedHours) {
    return <> · {story.estimatedHours}h <span className="line-through opacity-50">{story.traditionalHours}h</span></>;
  }
  return <> · {story.estimatedHours}h</>;
}

/** Render technical notes (iOS / Android / Backend) added by the tech refinement stage. */
function TechnicalNotes({ notes }: { notes?: BacklogStory['technical_notes'] }) {
  if (!notes || (!notes.ios && !notes.android && !notes.backend)) return null;
  const items: Array<{ key: string; label: string; color: string; note: string }> = [];
  if (notes.ios) items.push({ key: 'ios', label: 'iOS', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', note: notes.ios });
  if (notes.android) items.push({ key: 'android', label: 'Android', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', note: notes.android });
  if (notes.backend) items.push({ key: 'backend', label: 'Backend', color: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400', note: notes.backend });
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-medium text-surface-500 dark:text-surface-400">Technical Notes:</p>
      {items.map(({ key, label, color, note }) => (
        <div key={key} className="flex gap-1.5 items-start">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${color}`}>{label}</span>
          <p className="text-xs text-surface-600 dark:text-surface-400">{note}</p>
        </div>
      ))}
    </div>
  );
}

/** Feature-level rationale + acceptance criteria + FR/NFR/Journey badges, sourced from the
 *  epic_features planning artifact (epicMatch) — shown on expand next to a feature's stories.
 *  Shared by the merged multi-feature overview and the single-feature refinement preview so
 *  both get the same context instead of the preview silently omitting it. */
function FeatureDetailPanel({ epicMatch, acceptanceCriteria, frMap, nfrMap }: {
  epicMatch?: EpicFeature;
  acceptanceCriteria?: string[];
  frMap?: Record<string, string>;
  nfrMap?: Record<string, string>;
}) {
  const hasDetail = !!epicMatch?.rationale || (acceptanceCriteria?.length ?? 0) > 0 || !!epicMatch?.prdRef;
  if (!hasDetail) return null;
  return (
    <div className="px-4 py-3 space-y-2 bg-surface-50/60 dark:bg-surface-900/30 border-t border-surface-200 dark:border-surface-700">
      {epicMatch?.rationale && (
        <p className="text-xs text-surface-600 dark:text-surface-400 italic">{epicMatch.rationale}</p>
      )}
      {(acceptanceCriteria?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Feature Acceptance Criteria</p>
          <ul className="space-y-1">
            {acceptanceCriteria!.map((ac, ai) => (
              <li key={ai} className="text-xs text-surface-700 dark:text-surface-300 flex items-start gap-1.5">
                <span className="text-brand-400 dark:text-brand-500 mt-0.5 flex-shrink-0">•</span>
                <span>{ac}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {epicMatch?.prdRef && <PrdRefTags prdRef={epicMatch.prdRef} frMap={frMap} nfrMap={nfrMap} />}
    </div>
  );
}

/** Render aggregate hours with optional AI savings line. */
function AggregateHours({ hours, traditionalHours, aiAssisted }: { hours: number; traditionalHours?: number; aiAssisted: boolean }) {
  if (hours <= 0) return null;
  if (aiAssisted && traditionalHours != null && traditionalHours > 0 && traditionalHours !== hours) {
    const saved = traditionalHours - hours;
    const pct = Math.round((saved / traditionalHours) * 100);
    return <> · {hours}h <span className="line-through opacity-50">{traditionalHours}h</span> <span className="text-emerald-600 dark:text-emerald-400">(-{pct}%)</span></>;
  }
  return <> · {hours}h</>;
}

interface BacklogViewProps {
  data: BacklogData;
  isFeaturePreview?: boolean;
  /** "F3" etc — only known by the caller for a single-feature checkpoint (backlog_F<n>
   *  artifact type carries its own index), so this stays undefined for the merged overview,
   *  which already derives it per-row from the flattened features array instead. */
  featureKey?: string;
  initiativeTitle?: string;
  stateByLocalKey?: Map<string, WorkItemStateBucket>;
  epicFeatures?: EpicFeaturesData | null;
  /** Optional FR/NFR id→text maps sourced from the PRD artifact — shown as tooltips on prdRef badges. */
  frMap?: Record<string, string>;
  nfrMap?: Record<string, string>;
  // Only ever passed for the live single-feature checkpoint review (isFeaturePreview
  // artifacts) — never wire these into the merged multi-feature overview's renderFeatureRow
  // path, since removeStoryFromBacklog/removeTestCaseFromStory only operate on the single
  // previewed feature and would silently mutate the wrong feature otherwise.
  onDeleteStory?: (storyIndex: number) => void;
  onDeleteTestCase?: (storyIndex: number, testCaseIndex: number) => void;
}

export function BacklogView({ data, isFeaturePreview, featureKey, initiativeTitle, stateByLocalKey, epicFeatures, frMap, nfrMap, onDeleteStory, onDeleteTestCase }: BacklogViewProps) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());
  // Epics and features both default collapsed so a multi-feature overview doesn't dump every
  // story on screen at once — drill in per epic, then per feature.
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());
  const [expandedFeatures, setExpandedFeatures] = useState<Set<number>>(new Set());

  const toggleStory = (key: string) => {
    setExpandedStories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleFeature = (fi: number) => {
    setExpandedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(fi)) next.delete(fi); else next.add(fi);
      return next;
    });
  };

  const toggleEpic = (key: string) => {
    setExpandedEpics(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const tier = backlogTier(data);
  const sprintMeta = getSprintMeta(data);
  const allStories = getAllStories(data);
  const features = getAllFeatures(data);
  const hasFeatures = tier === 3 && features.length > 0;
  const aiAssisted = sprintMeta?.aiAssisted ?? false;
  const epicFeatureLookup = buildEpicFeatureLookup(epicFeatures);

  const totalStories = allStories.length;
  const totalEffort = allStories.reduce((s, st) => s + (st.effort ?? 0), 0);
  const totalHours = allStories.reduce((s, st) => s + (st.estimatedHours ?? 0), 0);
  const totalTraditionalHours = sprintMeta?.totalTraditionalHours ?? totalHours;

  const renderStory = (story: BacklogStory, si: number, prefix: string, stateBucket?: WorkItemStateBucket, storyKey?: string) => {
    const key = `${prefix}-${si}`;
    const isExpanded = expandedStories.has(key);
    return (
      <div key={si} className="px-4 py-2.5">
        <div className="flex items-start gap-2 group">
        <button
          onClick={() => toggleStory(key)}
          className="flex-1 min-w-0 text-left flex items-start gap-2"
        >
          <Chevron expanded={isExpanded} className="w-3.5 h-3.5 mt-0.5 text-surface-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {storyKey && <FeatureKeyBadge label={storyKey} />}
              <span className="text-base text-surface-900 dark:text-surface-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                {story.title}
              </span>
              <FrTags frs={story.prd_ref?.functional_requirements ?? []} frMap={frMap} />
              {story.effort != null && (
                <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    : 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                }`}>
                  {story.effort}<HoursDisplay story={story} aiAssisted={aiAssisted} />
                </span>
              )}
              <StateBucketPill bucket={stateBucket} />
            </div>
            {(story.persona || story.as_a) && !isExpanded && (
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5 truncate">{story.as_a || story.persona}</p>
            )}
          </div>
        </button>
        {onDeleteStory && (
          <DeleteItemButton onDelete={() => onDeleteStory(si)} label="Delete story" className="mt-0.5" />
        )}
        </div>

        {isExpanded && (
          <div className="ml-5.5 mt-2 space-y-2 pl-4 border-l-2 border-surface-100 dark:border-surface-700">
            {/* Support both old format (persona/goal/benefit) and new format (as_a/i_want/so_that) */}
            {(story.persona || story.as_a) && (
              <div>
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">As a: </span>
                <span className="text-xs text-surface-700 dark:text-surface-300">{story.as_a || story.persona}</span>
              </div>
            )}
            {(story.goal || story.i_want) && (
              <div>
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">I want: </span>
                <span className="text-xs text-surface-700 dark:text-surface-300">{story.i_want || story.goal}</span>
              </div>
            )}
            {(story.benefit || story.so_that) && (
              <div>
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">So that: </span>
                <span className="text-xs text-surface-700 dark:text-surface-300">{story.so_that || story.benefit}</span>
              </div>
            )}
            {(() => { const acs = story.acceptanceCriteria ?? story.acceptance_criteria; return acs && acs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {acs.map((ac, ai) => (
                    <li key={ai} className="text-xs text-surface-700 dark:text-surface-300 flex items-start gap-1.5">
                      <span className="text-green-500 mt-px flex-shrink-0">✓</span>
                      <span>{ac.split(/\b(Given|When|Then|And|But)\b/gi).map((part, pi) =>
                        /^(Given|When|Then|And|But)$/i.test(part)
                          ? <span key={pi}>{pi > 1 && <br />}<strong>{part}</strong></span>
                          : <span key={pi}>{part}</span>
                      )}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ); })()}

            {/* Technical Acceptance Criteria (new multi-agent format) */}
            {story.technical_acceptance_criteria && story.technical_acceptance_criteria.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Technical Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {story.technical_acceptance_criteria.map((tac, ti) => (
                    <li key={ti} className="text-xs text-surface-700 dark:text-surface-300 flex items-start gap-1.5">
                      <span className="text-blue-500 mt-px flex-shrink-0">⚙</span>
                      <span>{tac}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Platform tags (new multi-agent format) */}
            {(() => {
              const platformRaw = story.platform;
              const platforms = Array.isArray(platformRaw) ? platformRaw : platformRaw ? [String(platformRaw)] : [];
              return platforms.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {platforms.map(p => (
                    <span key={p} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      p === 'backend' ? 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400'
                      : p === 'web' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      : p === 'ios' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400'
                      : p === 'android' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-400'
                    }`}>
                      {p.toUpperCase()}
                    </span>
                  ))}
                </div>
              );
            })()}

            {/* Test Cases (new multi-agent format) */}
            {story.test_cases && story.test_cases.length > 0 && (
              <div className="border-t border-surface-200 dark:border-surface-700 pt-3 mt-3">
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Test Cases ({story.test_cases.length}):</p>
                <div className="space-y-2">
                  {story.test_cases.map((tc, tci) => (
                    <div key={tc.id} className="bg-surface-50 dark:bg-surface-800/50 rounded p-2 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-surface-500 dark:text-surface-400">{tc.id}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tc.type === 'happy_path' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : tc.type === 'bad_path' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          {tc.type.replace('_', ' ')}
                        </span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tc.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : tc.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                          : tc.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-400'
                        }`}>
                          {tc.priority}
                        </span>
                      </div>
                      <div className="space-y-0.5 text-xs">
                        {tc.scenario.given.map((g, gi) => (
                          <div key={`g${gi}`} className="text-surface-600 dark:text-surface-400">
                            <strong className="text-surface-700 dark:text-surface-300">Given</strong> {g}
                          </div>
                        ))}
                        {tc.scenario.when.map((w, wi) => (
                          <div key={`w${wi}`} className="text-surface-600 dark:text-surface-400">
                            <strong className="text-surface-700 dark:text-surface-300">When</strong> {w}
                          </div>
                        ))}
                        {tc.scenario.then.map((t, thi) => (
                          <div key={`t${thi}`} className="text-surface-600 dark:text-surface-400">
                            <strong className="text-surface-700 dark:text-surface-300">Then</strong> {t}
                          </div>
                        ))}
                      </div>
                      </div>
                      {onDeleteTestCase && (
                        <DeleteItemButton onDelete={() => onDeleteTestCase(si, tci)} label="Delete test case" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {story.agentContext && (
              <div className="bg-surface-50 dark:bg-surface-800 rounded p-2 mt-1">
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-0.5">Agent Context:</p>
                <p className="text-xs text-surface-600 dark:text-surface-400">{story.agentContext}</p>
              </div>
            )}
            <TechnicalNotes notes={story.technical_notes} />
          </div>
        )}
      </div>
    );
  };

  /** Collapsible feature row — header always visible, stories shown only once expanded. Shared
   *  by the merged multi-feature overview (nested under an epic section) and the rare no-epic
   *  fallback. `epicMatch` is the planning-stage counterpart (see buildEpicFeatureLookup) — it
   *  carries rationale/PRD refs/dependencies that the refinement stage's own artifact doesn't
   *  repeat, and is undefined when there's no epic_features data to match against. */
  const renderFeatureRow = (feature: BacklogFeature, fi: number, epicMatch?: EpicFeature) => {
    const isExpanded = expandedFeatures.has(fi);
    const featureEffort = feature.stories.reduce((s, st) => s + (st.effort ?? 0), 0);
    const featureHours = feature.stories.reduce((s, st) => s + (st.estimatedHours ?? 0), 0);
    const featureTraditionalHours = feature.stories.reduce((s, st) => s + (st.traditionalHours ?? st.estimatedHours ?? 0), 0);
    const featureKey = featureLocalKey(fi);
    const ev = sprintMeta?.effectiveVelocity;
    const featureAcceptanceCriteria = feature.acceptance_criteria ?? epicMatch?.acceptanceCriteria;
    return (
      <div key={fi} className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
        <button
          onClick={() => toggleFeature(fi)}
          className="w-full text-left flex items-start gap-2 px-4 py-3 bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <Chevron expanded={isExpanded} className="w-3.5 h-3.5 mt-0.5 text-surface-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">Feature</span>
              <FeatureKeyBadge label={featureKey} />
              {featureEffort > 0 && (
                <span className="text-xs text-surface-400 dark:text-surface-500">
                  {featureEffort} pts
                  <AggregateHours hours={featureHours} traditionalHours={featureTraditionalHours} aiAssisted={aiAssisted} />
                  {ev && ev > 0 && (
                    <> · {Math.round((featureEffort / ev) * 10) / 10} sprints</>
                  )}
                </span>
              )}
              {epicMatch?.deferredTo && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  → {epicMatch.deferredTo}
                </span>
              )}
              {(epicMatch?.dependsOn?.length ?? 0) > 0 ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400"
                  title={`Cannot start until: ${epicMatch!.dependsOn!.join(', ')}`}
                >
                  Sequential — after {epicMatch!.dependsOn!.join(', ')}
                </span>
              ) : epicMatch ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400">
                  Parallel
                </span>
              ) : null}
              <StateBucketPill bucket={stateByLocalKey?.get(featureKey)} />
            </div>
            <h4 className="text-base font-semibold text-surface-900 dark:text-surface-100 truncate min-w-0">{feature.title}</h4>
            <FrTags frs={epicMatch?.prdRef?.functionalRequirements ?? []} frMap={frMap} className="flex flex-wrap gap-1 mt-1" />
            {feature.description && (
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">{feature.description}</p>
            )}
            {!isExpanded && (
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                {feature.stories.length} stor{feature.stories.length !== 1 ? 'ies' : 'y'}
              </p>
            )}
          </div>
        </button>
        {isExpanded && (
          <>
            <FeatureDetailPanel epicMatch={epicMatch} acceptanceCriteria={featureAcceptanceCriteria} frMap={frMap} nfrMap={nfrMap} />
            <div className="divide-y divide-surface-100 dark:divide-surface-700 border-t border-surface-200 dark:border-surface-700">
              {storiesInDisplayOrder(feature.stories).map(({ story, index: si }) => renderStory(story, si, `${fi + 1}`, stateByLocalKey?.get(storyLocalKey(featureKey, si)), story.story_id ?? storyLocalKey(featureKey, si)))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    // font-sans: this view can render inside the font-mono pipeline terminal subtree
    // (the per-refinement Stories/Tests overview); pin the app font so it never inherits monospace.
    <div className="space-y-4 font-sans">
      {/* AI-assisted badge */}
      {aiAssisted && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">AI-Assisted Estimates</span>
          <span className="text-xs text-emerald-600 dark:text-emerald-500">Hours reflect AI-augmented development velocity</span>
        </div>
      )}

      {/* Initiative / Epic / Feature context — same card structure as the !isFeaturePreview path */}
      {tier === 3 && data.epic && isFeaturePreview && (() => {
        const feature = features[0];
        const epic = data.epic;
        return (
          <div className="space-y-3">
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 p-4 space-y-2">
              <InitiativeHeader title={initiativeTitle ?? epic.title} />
              {epic.description && (
                <ExpandableText text={epic.description} className="text-sm text-surface-600 dark:text-surface-300" />
              )}
              {epic.businessValue && (
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  <span className="font-semibold">Business value: </span>{epic.businessValue}
                </p>
              )}
            </div>
            {feature && (() => {
              // Same title→phase→epicMatch resolution as the merged overview's renderFeatureRow
              // (buildEpicFeatureLookup below) — a single feature checkpoint still needs its
              // planning-stage AC/FR/NFR/Journey context, not just its own restated description.
              const phaseLabel = buildTitleToPhaseLabel(epicFeatures).get(feature.title) ?? feature.phase ?? DEFAULT_PHASE_LABEL;
              const epicMatch = epicFeatureLookup.get(`${phaseLabel}::${feature.title}`);
              const featureAcceptanceCriteria = feature.acceptance_criteria ?? epicMatch?.acceptanceCriteria;
              const hasDetail = !!epicMatch?.rationale || (featureAcceptanceCriteria?.length ?? 0) > 0 || !!epicMatch?.prdRef;
              const isExpanded = expandedFeatures.has(0);
              return (
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 overflow-hidden">
                  <button
                    onClick={() => hasDetail && toggleFeature(0)}
                    disabled={!hasDetail}
                    className="w-full text-left flex items-start gap-2 px-4 py-3 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:cursor-default disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                  >
                    {hasDetail && <Chevron expanded={isExpanded} className="w-3.5 h-3.5 mt-0.5 text-surface-400 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">Feature</span>
                        {featureKey && <FeatureKeyBadge label={featureKey} />}
                        {totalEffort > 0 && (
                          <span className="text-xs text-surface-400 dark:text-surface-500">
                            {totalEffort} pts
                            <AggregateHours hours={totalHours} traditionalHours={totalTraditionalHours} aiAssisted={aiAssisted} />
                            {sprintMeta?.sprintsRequired != null && <> · {sprintMeta.sprintsRequired} sprints</>}
                          </span>
                        )}
                      </div>
                      <h4 className="text-base font-semibold text-surface-900 dark:text-surface-100 truncate min-w-0">{feature.title}</h4>
                      <FrTags frs={epicMatch?.prdRef?.functionalRequirements ?? []} frMap={frMap} className="flex flex-wrap gap-1 mt-1" />
                      {feature.description && (
                        <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">{feature.description}</p>
                      )}
                      <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                        {totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
                      </p>
                    </div>
                  </button>
                  {isExpanded && (
                    <FeatureDetailPanel epicMatch={epicMatch} acceptanceCriteria={featureAcceptanceCriteria} frMap={frMap} nfrMap={nfrMap} />
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Initiative overview + one collapsible Epic per phase — Tier 3 merged backlog
          (multiple features, no single feature in focus). Each phase was planned as its own
          epic, so it gets its own card here instead of one epic spanning every phase; expand
          an epic to drill into its features, then a feature to view its stories. */}
      {tier === 3 && data.epic && !isFeaturePreview && (() => {
        const epic = data.epic;
        const sections = buildEpicSections(features, epicFeatures, epic.title);
        const outOfScope = epicFeatures?.outOfScope ?? [];
        return (
          <div className="space-y-3">
            {/* Initiative + epic overview — shown once, not collapsible */}
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 p-4 space-y-2">
              <InitiativeHeader title={initiativeTitle ?? epic.title} />
              {epic.description && (
                <ExpandableText text={epic.description} className="text-sm text-surface-600 dark:text-surface-300" />
              )}
              {epic.businessValue && (
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  <span className="font-semibold">Business value: </span>{epic.businessValue}
                </p>
              )}
              {epic.prdLink && (
                <a
                  href={epic.prdLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2"
                >
                  View PRD ↗
                </a>
              )}
              {outOfScope.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Out of scope</p>
                  <ExpandableList items={outOfScope} />
                </div>
              )}
            </div>

            {/* One collapsible "Epic" card per phase */}
            {sections.map(section => {
              const isExpanded = expandedEpics.has(section.key);
              const sectionStories = section.entries.reduce((sum, { feature }) => sum + feature.stories.length, 0);
              return (
                <div key={section.key} className="rounded-lg border border-surface-200 dark:border-surface-700 hover:border-violet-200 dark:hover:border-violet-800 transition-colors overflow-hidden">
                  <button
                    onClick={() => toggleEpic(section.key)}
                    className="group w-full text-left flex items-start gap-2 bg-surface-50 dark:bg-surface-800/40 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors p-4"
                  >
                    <Chevron expanded={isExpanded} className="w-4 h-4 mt-1 text-surface-400 group-hover:text-violet-500 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Epic</span>
                        <PhaseTag label={section.key} colorClass={section.colorClass} />
                        <span className="text-xs text-surface-400">·</span>
                        <span className="text-xs text-surface-500 dark:text-surface-400">
                          {section.entries.length} feature{section.entries.length !== 1 ? 's' : ''} · {sectionStories} stor{sectionStories !== 1 ? 'ies' : 'y'}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{section.title}</h3>
                      {section.deliverable && (
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 italic">
                          <span className="font-medium not-italic">Ships: </span>{section.deliverable}
                        </p>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-surface-200 dark:border-surface-700 p-4 space-y-2">
                      {section.entries.map(({ feature, fi }) =>
                        renderFeatureRow(feature, fi, epicFeatureLookup.get(`${section.key}::${feature.title}`))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Feature header — only for Tier 2 (single feature without epic) */}
      {tier === 2 && data.feature && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">Feature</span>
            {data.feature.phase && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                data.feature.phase === 'MVP'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400'
              }`}>
                {data.feature.phase}
              </span>
            )}
            <span className="text-xs text-surface-400">·</span>
            <span className="text-xs text-surface-500 dark:text-surface-400">
              {totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
              {totalEffort > 0 && <> · {totalEffort} pts</>}
              <AggregateHours hours={totalHours} traditionalHours={totalTraditionalHours} aiAssisted={aiAssisted} />
              {sprintMeta?.sprintsRequired != null && (
                <> · {sprintMeta.sprintsRequired} sprints</>
              )}
            </span>
          </div>
          <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">{data.feature.title}</h3>
          {data.feature.description && (
            <p className="text-sm text-surface-600 dark:text-surface-300 mt-1">{data.feature.description}</p>
          )}
        </div>
      )}

      {/* Story detail — only for Tier 1 (single story, always expanded) */}
      {tier === 1 && data.story && (() => {
        const story = data.story;
        return (
          <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500 dark:text-emerald-400">Story</span>
              {story.effort != null && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    : 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                }`}>
                  {story.effort} pts<HoursDisplay story={story} aiAssisted={aiAssisted} />
                </span>
              )}
              {sprintMeta?.sprintsRequired != null && (
                <span className="text-xs text-surface-500 dark:text-surface-400">
                  · {sprintMeta.sprintsRequired} sprints
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {story.story_id && <FeatureKeyBadge label={story.story_id} />}
              <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">{story.title}</h3>
              <FrTags frs={story.prd_ref?.functional_requirements ?? []} frMap={frMap} />
            </div>
            {/* Support both old format (persona/goal/benefit) and new format (as_a/i_want/so_that) */}
            {(story.persona || story.as_a) && (
              <div><span className="text-xs font-medium text-surface-500 dark:text-surface-400">As a: </span><span className="text-xs text-surface-700 dark:text-surface-300">{story.as_a || story.persona}</span></div>
            )}
            {(story.goal || story.i_want) && (
              <div><span className="text-xs font-medium text-surface-500 dark:text-surface-400">I want: </span><span className="text-xs text-surface-700 dark:text-surface-300">{story.i_want || story.goal}</span></div>
            )}
            {(story.benefit || story.so_that) && (
              <div><span className="text-xs font-medium text-surface-500 dark:text-surface-400">So that: </span><span className="text-xs text-surface-700 dark:text-surface-300">{story.so_that || story.benefit}</span></div>
            )}
            {(() => { const acs = story.acceptanceCriteria ?? story.acceptance_criteria; return acs && acs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {acs.map((ac, ai) => (
                    <li key={ai} className="text-xs text-surface-700 dark:text-surface-300 flex items-start gap-1.5">
                      <span className="text-green-500 mt-px flex-shrink-0">✓</span>
                      <span>{ac.split(/\b(Given|When|Then|And|But)\b/gi).map((part, pi) =>
                        /^(Given|When|Then|And|But)$/i.test(part)
                          ? <span key={pi}>{pi > 1 && <br />}<strong>{part}</strong></span>
                          : <span key={pi}>{part}</span>
                      )}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ); })()}

            {/* Technical Acceptance Criteria (new multi-agent format) */}
            {story.technical_acceptance_criteria && story.technical_acceptance_criteria.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Technical Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {story.technical_acceptance_criteria.map((tac, ti) => (
                    <li key={ti} className="text-xs text-surface-700 dark:text-surface-300 flex items-start gap-1.5">
                      <span className="text-blue-500 mt-px flex-shrink-0">⚙</span>
                      <span>{tac}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Platform tags (new multi-agent format) */}
            {(() => {
              const platformRaw = story.platform;
              const platforms = Array.isArray(platformRaw) ? platformRaw : platformRaw ? [String(platformRaw)] : [];
              return platforms.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {platforms.map(p => (
                    <span key={p} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      p === 'backend' ? 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400'
                      : p === 'web' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      : p === 'ios' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400'
                      : p === 'android' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-400'
                    }`}>
                      {p.toUpperCase()}
                    </span>
                  ))}
                </div>
              );
            })()}

            {/* Test Cases (new multi-agent format) */}
            {story.test_cases && story.test_cases.length > 0 && (
              <div className="mt-3 border-t border-surface-200 dark:border-surface-700 pt-3">
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Test Cases ({story.test_cases.length}):</p>
                <div className="space-y-2">
                  {story.test_cases.map(tc => (
                    <div key={tc.id} className="bg-surface-50 dark:bg-surface-800/50 rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-surface-500 dark:text-surface-400">{tc.id}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tc.type === 'happy_path' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : tc.type === 'bad_path' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          {tc.type.replace('_', ' ')}
                        </span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tc.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : tc.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                          : tc.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-400'
                        }`}>
                          {tc.priority}
                        </span>
                      </div>
                      <div className="space-y-0.5 text-xs">
                        {tc.scenario.given.map((g, gi) => (
                          <div key={`g${gi}`} className="text-surface-600 dark:text-surface-400">
                            <strong className="text-surface-700 dark:text-surface-300">Given</strong> {g}
                          </div>
                        ))}
                        {tc.scenario.when.map((w, wi) => (
                          <div key={`w${wi}`} className="text-surface-600 dark:text-surface-400">
                            <strong className="text-surface-700 dark:text-surface-300">When</strong> {w}
                          </div>
                        ))}
                        {tc.scenario.then.map((t, ti) => (
                          <div key={`t${ti}`} className="text-surface-600 dark:text-surface-400">
                            <strong className="text-surface-700 dark:text-surface-300">Then</strong> {t}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {story.agentContext && (
              <div className="bg-surface-50 dark:bg-surface-800 rounded p-2 mt-1">
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-0.5">Agent Context:</p>
                <p className="text-xs text-surface-600 dark:text-surface-400">{story.agentContext}</p>
              </div>
            )}
            <TechnicalNotes notes={story.technical_notes} />
          </div>
        );
      })()}

      {/* Stories renderer — Tier 2, and the Tier 3 single-feature checkpoint preview. The
          merged Tier 3 overview's feature/story tree renders above instead, nested inside its
          per-phase collapsible epic sections, since each feature there needs to drill in
          independently. */}
      {tier !== 1 && !(tier === 3 && data.epic && !isFeaturePreview) && (() => {
        // Feature checkpoint preview — the hierarchy header above already shows the
        // feature's title/description/phase, so just render its stories directly.
        if (hasFeatures && isFeaturePreview) {
          return (
            <div className="rounded-lg border border-surface-200 dark:border-surface-700">
              <div className="divide-y divide-surface-100 dark:divide-surface-700">
                {storiesInDisplayOrder(features[0].stories).map(({ story, index: si }) => renderStory(story, si, '1', stateByLocalKey?.get(storyLocalKey(featureLocalKey(0), si)), story.story_id ?? storyLocalKey(featureLocalKey(0), si)))}
              </div>
            </div>
          );
        }

        // Tier 3 with no epic data (rare) — same collapsible feature cards, just not nested
        // under an epic card since there's no epic to nest them under.
        if (hasFeatures) {
          return (
            <div className="space-y-2">
              {features.map((feature, fi) => renderFeatureRow(feature, fi))}
            </div>
          );
        }

        // Tier 2 feature stories — render directly (header already shown above)
        return (
          <div className="rounded-lg border border-surface-200 dark:border-surface-700">
            <div className="divide-y divide-surface-100 dark:divide-surface-700">
              {storiesInDisplayOrder(data.feature?.stories ?? []).map(({ story, index: si }) => renderStory(story, si, '1', stateByLocalKey?.get(storyLocalKey(featureLocalKey(0), si)), story.story_id ?? storyLocalKey(featureLocalKey(0), si)))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
