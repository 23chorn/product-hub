import { useState } from 'react';
import { DeleteItemButton } from '../common/DeleteItemButton';

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

export function PrdRefTags({ prdRef }: { prdRef: PrdRef }) {
  const frs = prdRef.functionalRequirements ?? [];
  const nfrs = prdRef.nonFunctionalRequirements ?? [];
  const journeys = prdRef.userJourneys ?? [];
  if (frs.length === 0 && nfrs.length === 0 && journeys.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {frs.map(fr => (
        <span key={fr} className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400">{fr}</span>
      ))}
      {nfrs.map(nfr => (
        <span key={nfr} className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400">{nfr}</span>
      ))}
      {journeys.map(j => (
        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">{j}</span>
      ))}
    </div>
  );
}

function FeatureCard({ feature, idx, phaseIndex, onDeleteFeature }: { feature: EpicFeature; idx: number; phaseIndex: number; onDeleteFeature?: (phaseIndex: number, featureIndex: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = (feature.acceptanceCriteria?.length ?? 0) > 0 || feature.rationale || feature.prdRef;

  return (
    <div className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
      <div className="flex items-stretch hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 min-w-0 text-left px-4 py-3"
          disabled={!hasDetail}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-400 text-[10px] font-bold flex items-center justify-center">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{feature.title}</p>
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
                {hasDetail && (
                  <svg
                    className={`w-3.5 h-3.5 text-surface-400 flex-shrink-0 ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </div>
              {feature.description && (
                <p className="mt-1 text-xs text-surface-600 dark:text-surface-400 leading-relaxed">{feature.description}</p>
              )}
            </div>
          </div>
        </button>
        {onDeleteFeature && (
          <div className="flex items-center pr-3">
            <DeleteItemButton onDelete={() => onDeleteFeature(phaseIndex, idx)} label="Delete feature" />
          </div>
        )}
      </div>

      {expanded && hasDetail && (
        <div className="px-4 pb-4 border-t border-surface-100 dark:border-surface-700/60 space-y-3 mt-0 pt-3">
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
          {feature.prdRef && <PrdRefTags prdRef={feature.prdRef} />}
        </div>
      )}
    </div>
  );
}

export const PHASE_COLORS: Record<string, string> = {
  MVP:      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  'Phase 1':'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  'Phase 2':'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800',
  'Phase 3':'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
};

interface PhaseSectionProps {
  phase: EpicPhase;
  phaseIndex: number;
  onDeletePhase?: (phaseIndex: number) => void;
  onDeleteFeature?: (phaseIndex: number, featureIndex: number) => void;
}

function PhaseSection({ phase, phaseIndex, onDeletePhase, onDeleteFeature }: PhaseSectionProps) {
  const colorClass = PHASE_COLORS[phase.label] ?? 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 border-surface-200 dark:border-surface-600';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${colorClass}`}>{phase.label}</span>
        {phase.epicTitle && (
          <span className="text-sm font-semibold text-surface-700 dark:text-surface-300">{phase.epicTitle.replace(/^(MVP|Phase \d+)\s*[—–-]\s*/i, '')}</span>
        )}
        {onDeletePhase && (
          <DeleteItemButton onDelete={() => onDeletePhase(phaseIndex)} label="Delete epic" className="ml-auto" />
        )}
      </div>
      {phase.deliverable && (
        <p className="text-xs text-surface-500 dark:text-surface-400 italic pl-1">
          <span className="font-medium text-surface-600 dark:text-surface-300">Ships: </span>{phase.deliverable}
        </p>
      )}
      <div className="space-y-2 pl-0">
        {phase.features.map((f, i) => (
          <FeatureCard key={i} feature={f} idx={i} phaseIndex={phaseIndex} onDeleteFeature={onDeleteFeature} />
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface EpicFeaturesViewProps {
  data: EpicFeaturesData;
  onDeletePhase?: (phaseIndex: number) => void;
  onDeleteFeature?: (phaseIndex: number, featureIndex: number) => void;
}

export function EpicFeaturesView({ data, onDeletePhase, onDeleteFeature }: EpicFeaturesViewProps) {
  const phases = toPhases(data);
  const totalFeatures = phases.reduce((sum, p) => sum + p.features.length, 0);
  // Legacy flat features[] data has no real phases[] array to splice from — the removal
  // helpers no-op on it, so don't wire up buttons that would silently do nothing.
  const supportsDelete = !!data.phases;

  return (
    // font-sans: this view can render inside the font-mono pipeline terminal subtree
    // (e.g. the Stories/Tests overview); pin the app font so it never inherits monospace.
    <div className="space-y-6 text-sm font-sans">
      {/* Epic header */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">{data.epic.title}</h2>
            {data.epic.description && (
              <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">{data.epic.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
              {phases.length} phase{phases.length !== 1 ? 's' : ''} · {totalFeatures} feature{totalFeatures !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {data.epic.businessValue && (
          <div className="px-3 py-2.5 rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
            <p className="text-xs text-brand-800 dark:text-brand-300 leading-relaxed">
              <span className="font-semibold">Business value: </span>{data.epic.businessValue}
            </p>
          </div>
        )}
      </div>

      {/* Phases */}
      {phases.map((phase, i) => (
        <PhaseSection
          key={i}
          phase={phase}
          phaseIndex={i}
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
