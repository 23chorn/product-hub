import { useState } from 'react';
import { featureLocalKey } from '@pap/shared';
import { DeleteItemButton } from '../common/DeleteItemButton';
import { Chevron, InitiativeHeader, PhaseTag } from './ArtifactPrimitives';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PrdRef {
  functionalRequirements?: string[];
  nonFunctionalRequirements?: string[];
  userJourneys?: string[];
}

export interface EpicFeature {
  title: string;
  description?: string;
  rationale?: string;
  acceptanceCriteria?: string[];
  prdRef?: PrdRef;
  deferredTo?: string | null;
  dependsOn?: string[];          // exact titles of prerequisite features, from the planner
  dependsOnIndices?: number[];   // resolved indices (server post-processing) — not used for display
  // legacy flat format
  phase?: string;
}

export interface EpicPhase {
  label: string;
  epicTitle?: string;
  deliverable?: string;
  features: EpicFeature[];
}

interface EpicMeta {
  title: string;
  description?: string;
  businessValue?: string;
  prdLink?: string;
}

export interface EpicFeaturesData {
  epic: EpicMeta;
  phases?: EpicPhase[];
  // legacy flat format
  features?: EpicFeature[];
  outOfScope?: string[];
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function tryParseEpicFeatures(content: string): EpicFeaturesData | null {
  const stripped = content
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  const tryParse = (text: string): EpicFeaturesData | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed.epic && (parsed.phases || parsed.features)) return parsed as EpicFeaturesData;
    } catch {}
    return null;
  };

  const direct = tryParse(stripped);
  if (direct) return direct;
  const jsonStart = stripped.indexOf('{');
  if (jsonStart > 0) return tryParse(stripped.slice(jsonStart));
  return null;
}

/** Normalise both phases[] and legacy flat features[] into a phase list. */
export function toPhases(data: EpicFeaturesData): EpicPhase[] {
  if (data.phases && data.phases.length > 0) return data.phases;
  if (data.features && data.features.length > 0) {
    const byPhase = new Map<string, EpicFeature[]>();
    for (const f of data.features) {
      const label = f.phase ?? 'MVP';
      if (!byPhase.has(label)) byPhase.set(label, []);
      byPhase.get(label)!.push(f);
    }
    return Array.from(byPhase.entries()).map(([label, features]) => ({ label, features }));
  }
  return [];
}

// ── Checkpoint-review deletion ───────────────────────────────────────────────
//
// Only operate on data.phases — the validator requires it on every freshly generated
// epic_features artifact, so the legacy flat features[] shape is read-only-fallback and
// never wired to a delete button (see EpicFeaturesView's supportsDelete check below).

/**
 * Remove a set of features (by their global position in the flattened phases[].features[]
 * order — see flattenFeatures in feature-decomposition.ts) and repair every remaining
 * feature's dependsOnIndices/dependsOn accordingly. injectFeatureDecompositionStages reads
 * dependsOnIndices as positions in that same flattened order to compute parallel refinement
 * waves — without this fixup, deleting a feature would silently shift every later feature's
 * dependency indices onto the wrong target.
 */
function removeFeaturesAndFixDependencies(data: EpicFeaturesData, removedGlobalIndices: Set<number>, removedTitles: Set<string>): EpicFeaturesData {
  if (!data.phases) return data;
  const shiftFor = (i: number) => i - [...removedGlobalIndices].filter(r => r < i).length;
  const adjustFeature = (f: EpicFeature): EpicFeature => ({
    ...f,
    dependsOnIndices: f.dependsOnIndices?.filter(i => !removedGlobalIndices.has(i)).map(shiftFor),
    dependsOn: f.dependsOn?.filter(title => !removedTitles.has(title)),
  });

  let globalIndex = 0;
  const phases = data.phases
    .map(p => {
      const features: EpicFeature[] = [];
      for (const f of p.features) {
        const isRemoved = removedGlobalIndices.has(globalIndex);
        globalIndex++;
        if (!isRemoved) features.push(adjustFeature(f));
      }
      return { ...p, features };
    })
    .filter(p => p.features.length > 0); // Remove empty phases
  return { ...data, phases };
}

/** Remove an entire phase ("epic") and its nested features. No-op if data.phases is absent. */
export function removePhase(data: EpicFeaturesData, phaseIndex: number): EpicFeaturesData {
  if (!data.phases) return data;
  let start = 0;
  for (let p = 0; p < phaseIndex; p++) start += data.phases[p].features.length;
  const count = data.phases[phaseIndex].features.length;
  const removedGlobalIndices = new Set(Array.from({ length: count }, (_, i) => start + i));
  const removedTitles = new Set(data.phases[phaseIndex].features.map(f => f.title));
  return removeFeaturesAndFixDependencies(data, removedGlobalIndices, removedTitles);
}

/** Remove one feature from a phase. No-op if data.phases is absent. */
export function removeFeatureFromPhase(data: EpicFeaturesData, phaseIndex: number, featureIndex: number): EpicFeaturesData {
  if (!data.phases) return data;
  let globalIndex = 0;
  for (let p = 0; p < phaseIndex; p++) globalIndex += data.phases[p].features.length;
  globalIndex += featureIndex;
  const removedTitle = data.phases[phaseIndex].features[featureIndex]?.title;
  return removeFeaturesAndFixDependencies(data, new Set([globalIndex]), new Set(removedTitle ? [removedTitle] : []));
}

// ── Sub-components ───────────────────────────────────────────────────────────

// Strip dashes and leading zeros from numeric suffix so "FR-01"/"FR-1" → "FR1" to match PRD id format.
export function normalizePrdId(id: string): string {
  return id.replace(/-0*(\d+)$/, '$1');
}

/** Collapse the drifting journey id spellings the model has produced across runs
 *  ("J1", "Journey 1", "Journey_1", "journey1", ...) to one compact "J<n>" form, so
 *  the same journey renders the same badge label across every feature that references
 *  it. Falls back to the trimmed original for free-text journey names with no numeric id.
 *  Exported so FigmaDesignActions can apply the same id/description split to a screen's
 *  "Covers journeys" pills instead of re-deriving its own id scheme. */
export function normalizeJourneyId(id: string): string {
  const match = id.trim().match(/^j(?:ourney)?[\s_-]*(\d+)$/i);
  return match ? `J${match[1]}` : id.trim();
}

/** Feature identity badge ("F1", "F2", ...) — the same positional key (`featureLocalKey`)
 *  used for FR ownership, push-time dedup, and ADO ticket prefixes, so a reviewer can refer
 *  to "F3" and mean the exact same feature the backend does. Exported standalone so every
 *  feature-row surface (epic plan preview, per-feature checkpoint, merged backlog overview)
 *  renders the same badge instead of each re-deriving its own numbering markup. */
export function FeatureKeyBadge({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400">
      {label}
    </span>
  );
}

/** FR-only badges — the foundation every downstream stage traces back to, so these are
 *  surfaced prominently (next to titles, always visible) rather than gated behind expand
 *  like NFR/journey badges. Exported standalone so feature/story rows across every view
 *  (epic/feature preview, backlog, completed-initiative) render the same badge instead of
 *  each re-deriving its own FR markup. */
export function FrTags({ frs, frMap, className }: {
  frs: string[];
  frMap?: Record<string, string>;
  className?: string;
}) {
  if (frs.length === 0) return null;
  return (
    <div className={className ?? 'flex flex-wrap gap-1'}>
      {frs.map(fr => {
        const key = normalizePrdId(fr);
        const tip = frMap?.[key];
        return <span key={fr} title={tip} className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 ${tip ? 'cursor-help' : ''}`}>{key}</span>;
      })}
    </div>
  );
}

/** Full-text FR listing for the feature detail/expand view — the header row already shows
 *  the compact "FR-01" badges via FrTags, so repeating the same badges here added nothing;
 *  this is the one place a reviewer actually reads the requirement text, not just its id. */
function FrFullList({ frs, frMap }: { frs: string[]; frMap?: Record<string, string> }) {
  if (frs.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Functional Requirements</p>
      <ul className="space-y-1">
        {frs.map(fr => {
          const key = normalizePrdId(fr);
          const text = frMap?.[key];
          return (
            <li key={fr} className="flex gap-2 text-xs text-surface-700 dark:text-surface-300">
              <span className="flex-shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400">{key}</span>
              <span>{text ?? fr}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PrdRefTags({ prdRef, frMap, nfrMap }: {
  prdRef: PrdRef;
  frMap?: Record<string, string>;
  nfrMap?: Record<string, string>;
}) {
  const frs = prdRef.functionalRequirements ?? [];
  const nfrs = prdRef.nonFunctionalRequirements ?? [];
  const journeys = prdRef.userJourneys ?? [];
  if (frs.length === 0 && nfrs.length === 0 && journeys.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <FrFullList frs={frs} frMap={frMap} />
      {(nfrs.length > 0 || journeys.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {nfrs.map(nfr => {
            const key = normalizePrdId(nfr);
            const tip = nfrMap?.[key];
            return <span key={nfr} title={tip} className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 ${tip ? 'cursor-help' : ''}`}>{key}</span>;
          })}
          {journeys.map(j => {
            const colonIdx = j.indexOf(': ');
            const jId = normalizeJourneyId(colonIdx !== -1 ? j.slice(0, colonIdx) : j);
            const tip = colonIdx !== -1 ? j.slice(colonIdx + 2) : undefined;
            return <span key={j} title={tip} className={`text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 ${tip ? 'cursor-help' : ''}`}>{jId}</span>;
          })}
        </div>
      )}
    </div>
  );
}

function FeatureCard({ feature, idx, globalIndex, phaseIndex, frMap, nfrMap, onDeleteFeature }: { feature: EpicFeature; idx: number; globalIndex: number; phaseIndex: number; frMap?: Record<string, string>; nfrMap?: Record<string, string>; onDeleteFeature?: (phaseIndex: number, featureIndex: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = (feature.acceptanceCriteria?.length ?? 0) > 0 || !!feature.rationale || !!feature.prdRef;

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      <div className="flex items-stretch">
        <button
          onClick={() => setExpanded(e => !e)}
          disabled={!hasDetail}
          className="flex-1 min-w-0 text-left flex items-start gap-2 px-4 py-3 bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:cursor-default"
        >
          <Chevron expanded={expanded} className="w-3.5 h-3.5 mt-0.5 text-surface-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">Feature</span>
              <FeatureKeyBadge label={featureLocalKey(globalIndex)} />
              {feature.deferredTo && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex-shrink-0">
                  → {feature.deferredTo}
                </span>
              )}
              {(feature.dependsOn?.length ?? 0) > 0 ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400 flex-shrink-0"
                  title={`Cannot start until: ${feature.dependsOn!.join(', ')}`}
                >
                  Sequential — after {feature.dependsOn!.join(', ')}
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 flex-shrink-0">
                  Parallel
                </span>
              )}
            </div>
            <h4 className="text-base font-semibold text-surface-900 dark:text-surface-100 truncate min-w-0">{feature.title}</h4>
            <FrTags frs={feature.prdRef?.functionalRequirements ?? []} frMap={frMap} className="flex flex-wrap gap-1 mt-1" />
            {feature.description && (
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">{feature.description}</p>
            )}
          </div>
        </button>
        {onDeleteFeature && (
          <div className="flex items-center pr-3 bg-surface-50 dark:bg-surface-800/60">
            <DeleteItemButton onDelete={() => onDeleteFeature(phaseIndex, idx)} label="Delete feature" />
          </div>
        )}
      </div>

      {expanded && hasDetail && (
        <div className="px-4 pb-4 border-t border-surface-100 dark:border-surface-700/60 space-y-3 pt-3">
          {feature.rationale && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1">Rationale</p>
              <p className="text-xs text-surface-600 dark:text-surface-400 italic">{feature.rationale}</p>
            </div>
          )}
          {(feature.acceptanceCriteria?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1.5">Acceptance Criteria</p>
              <ul className="space-y-1">
                {feature.acceptanceCriteria!.map((ac, i) => (
                  <li key={i} className="flex gap-2 text-xs text-surface-700 dark:text-surface-300">
                    <span className="flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-brand-400 dark:bg-brand-500" />
                    <span>{ac}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feature.prdRef && <PrdRefTags prdRef={feature.prdRef} frMap={frMap} nfrMap={nfrMap} />}
        </div>
      )}
    </div>
  );
}

export const PHASE_COLORS: Record<string, string> = {
  MVP:      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  'Phase 1':'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  'Phase 2':'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
  'Phase 3':'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
};

interface PhaseSectionProps {
  phase: EpicPhase;
  phaseIndex: number;
  /** Count of features in every earlier phase — added to a feature's local index to get
   *  its global position, matching the backend's flattened `featureLocalKey(i)` numbering. */
  featureIndexOffset: number;
  frMap?: Record<string, string>;
  nfrMap?: Record<string, string>;
  onDeletePhase?: (phaseIndex: number) => void;
  onDeleteFeature?: (phaseIndex: number, featureIndex: number) => void;
}

function PhaseSection({ phase, phaseIndex, featureIndexOffset, frMap, nfrMap, onDeletePhase, onDeleteFeature }: PhaseSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const colorClass = PHASE_COLORS[phase.label] ?? 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300';
  const epicTitle = phase.epicTitle?.replace(/^(MVP|Phase \d+)\s*[—–-]\s*/i, '');
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 hover:border-violet-200 dark:hover:border-violet-800 transition-colors overflow-hidden">
      <div className="flex items-stretch bg-surface-50 dark:bg-surface-800/40">
        <button
          onClick={() => setExpanded(e => !e)}
          className="group flex-1 min-w-0 text-left flex items-start gap-2 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors p-4"
        >
          <Chevron expanded={expanded} className="w-4 h-4 mt-1 text-surface-400 group-hover:text-violet-500 transition-colors" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Epic</span>
              <PhaseTag label={phase.label} colorClass={colorClass} />
              <span className="text-xs text-surface-400">·</span>
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {phase.features.length} feature{phase.features.length !== 1 ? 's' : ''}
              </span>
            </div>
            {epicTitle && <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{epicTitle}</h3>}
            {phase.deliverable && (
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 italic">
                <span className="font-medium not-italic">Ships: </span>{phase.deliverable}
              </p>
            )}
          </div>
        </button>
        {onDeletePhase && (
          <div className="flex items-center pr-4">
            <DeleteItemButton onDelete={() => onDeletePhase(phaseIndex)} label="Delete epic" />
          </div>
        )}
      </div>
      {expanded && (
        <div className="border-t border-surface-200 dark:border-surface-700 p-4 space-y-2">
          {phase.features.map((f, i) => (
            <FeatureCard key={i} feature={f} idx={i} globalIndex={featureIndexOffset + i} phaseIndex={phaseIndex} frMap={frMap} nfrMap={nfrMap} onDeleteFeature={onDeleteFeature} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface EpicFeaturesViewProps {
  data: EpicFeaturesData;
  initiativeTitle?: string;
  frMap?: Record<string, string>;
  nfrMap?: Record<string, string>;
  onDeletePhase?: (phaseIndex: number) => void;
  onDeleteFeature?: (phaseIndex: number, featureIndex: number) => void;
}

export function EpicFeaturesView({ data, initiativeTitle, frMap, nfrMap, onDeletePhase, onDeleteFeature }: EpicFeaturesViewProps) {
  const phases = toPhases(data);
  const totalFeatures = phases.reduce((sum, p) => sum + p.features.length, 0);
  // Running feature count before each phase, so FeatureCard can show the same global "F<n>"
  // key the backend assigns via featureLocalKey (positional across the flattened feature list).
  const featureIndexOffsets = phases.reduce<number[]>((offsets, _p, i) => {
    offsets.push(i === 0 ? 0 : offsets[i - 1] + phases[i - 1].features.length);
    return offsets;
  }, []);
  // Legacy flat features[] data has no real phases[] array to splice from — the removal
  // helpers no-op on it, so don't wire up buttons that would silently do nothing.
  const supportsDelete = !!data.phases;

  return (
    // font-sans: this view can render inside the font-mono pipeline terminal subtree
    // (e.g. the Stories/Tests overview); pin the app font so it never inherits monospace.
    <div className="space-y-3 text-sm font-sans">
      {/* Initiative / epic overview card — same structure as BacklogView's !isFeaturePreview path */}
      <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 p-4 space-y-2">
        <InitiativeHeader title={initiativeTitle ?? data.epic.title} />
        {data.epic.description && (
          <p className="text-sm text-surface-600 dark:text-surface-300">{data.epic.description}</p>
        )}
        {data.epic.businessValue && (
          <p className="text-xs text-surface-500 dark:text-surface-400">
            <span className="font-semibold">Business value: </span>{data.epic.businessValue}
          </p>
        )}
        <p className="text-[10px] font-semibold text-surface-400 dark:text-surface-500">
          {phases.length} phase{phases.length !== 1 ? 's' : ''} · {totalFeatures} feature{totalFeatures !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Phases */}
      {phases.map((phase, i) => (
        <PhaseSection
          key={i}
          phase={phase}
          phaseIndex={i}
          featureIndexOffset={featureIndexOffsets[i]}
          frMap={frMap}
          nfrMap={nfrMap}
          onDeletePhase={supportsDelete ? onDeletePhase : undefined}
          onDeleteFeature={supportsDelete ? onDeleteFeature : undefined}
        />
      ))}

      {/* Out of scope */}
      {data.outOfScope && data.outOfScope.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">Out of Scope</p>
          <ul className="space-y-1">
            {data.outOfScope.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs text-surface-500 dark:text-surface-400">
                <span className="flex-shrink-0 mt-1">–</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
