import { useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface PrdRef {
  functionalRequirements?: string[];
  nonFunctionalRequirements?: string[];
  userJourneys?: string[];
}

interface EpicFeature {
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

interface EpicPhase {
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
function toPhases(data: EpicFeaturesData): EpicPhase[] {
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

// ── Sub-components ───────────────────────────────────────────────────────────

function PrdRefTags({ prdRef }: { prdRef: PrdRef }) {
  const frs = prdRef.functionalRequirements ?? [];
  const nfrs = prdRef.nonFunctionalRequirements ?? [];
  const journeys = prdRef.userJourneys ?? [];
  if (frs.length === 0 && nfrs.length === 0 && journeys.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {frs.map(fr => (
        <span key={fr} className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">{fr}</span>
      ))}
      {nfrs.map(nfr => (
        <span key={nfr} className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400">{nfr}</span>
      ))}
      {journeys.map(j => (
        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{j}</span>
      ))}
    </div>
  );
}

function FeatureCard({ feature, idx }: { feature: EpicFeature; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = (feature.acceptanceCriteria?.length ?? 0) > 0 || feature.rationale || feature.prdRef;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
        disabled={!hasDetail}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 text-[10px] font-bold flex items-center justify-center">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{feature.title}</p>
              {feature.deferredTo && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex-shrink-0">
                  → {feature.deferredTo}
                </span>
              )}
              {(feature.dependsOn?.length ?? 0) > 0 ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 flex-shrink-0"
                  title={`Cannot start until: ${feature.dependsOn!.join(', ')}`}
                >
                  Sequential — after {feature.dependsOn!.join(', ')}
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 flex-shrink-0">
                  Parallel
                </span>
              )}
              {hasDetail && (
                <svg
                  className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </div>
            {feature.description && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{feature.description}</p>
            )}
          </div>
        </div>
      </button>

      {expanded && hasDetail && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700/60 space-y-3 mt-0 pt-3">
          {feature.rationale && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Rationale</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 italic">{feature.rationale}</p>
            </div>
          )}
          {(feature.acceptanceCriteria?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Acceptance Criteria</p>
              <ul className="space-y-1">
                {feature.acceptanceCriteria!.map((ac, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <span className="flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-teal-400 dark:bg-teal-500" />
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

const PHASE_COLORS: Record<string, string> = {
  MVP:      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  'Phase 1':'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  'Phase 2':'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800',
  'Phase 3':'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
};

function PhaseSection({ phase }: { phase: EpicPhase }) {
  const colorClass = PHASE_COLORS[phase.label] ?? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${colorClass}`}>{phase.label}</span>
        {phase.epicTitle && (
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{phase.epicTitle.replace(/^(MVP|Phase \d+)\s*[—–-]\s*/i, '')}</span>
        )}
      </div>
      {phase.deliverable && (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic pl-1">
          <span className="font-medium text-slate-600 dark:text-slate-300">Ships: </span>{phase.deliverable}
        </p>
      )}
      <div className="space-y-2 pl-0">
        {phase.features.map((f, i) => <FeatureCard key={i} feature={f} idx={i} />)}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function EpicFeaturesView({ data }: { data: EpicFeaturesData }) {
  const phases = toPhases(data);
  const totalFeatures = phases.reduce((sum, p) => sum + p.features.length, 0);

  return (
    <div className="space-y-6 text-sm">
      {/* Epic header */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{data.epic.title}</h2>
            {data.epic.description && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{data.epic.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              {phases.length} phase{phases.length !== 1 ? 's' : ''} · {totalFeatures} feature{totalFeatures !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {data.epic.businessValue && (
          <div className="px-3 py-2.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
            <p className="text-xs text-teal-800 dark:text-teal-300 leading-relaxed">
              <span className="font-semibold">Business value: </span>{data.epic.businessValue}
            </p>
          </div>
        )}
      </div>

      {/* Phases */}
      {phases.map((phase, i) => <PhaseSection key={i} phase={phase} />)}

      {/* Out of scope */}
      {data.outOfScope && data.outOfScope.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Out of Scope</p>
          <ul className="space-y-1">
            {data.outOfScope.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
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
