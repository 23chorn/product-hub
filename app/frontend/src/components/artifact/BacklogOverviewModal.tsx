import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { tryParseBacklog, tryParseQATests, mergeQaTests, type BacklogData, type QATestSuite } from '@pap/shared';
import { type FeatureArtifactRef } from '../../utils/feature-artifacts';
import { BacklogView } from './BacklogView';
import { QATestsView } from './QATestsView';
import { tryParseEpicFeatures, type EpicFeaturesData } from './EpicFeaturesView';
import { ArtifactTabShell } from './ArtifactPrimitives';
import { copyToClipboard } from '../../utils/markdown';
import { buildPrdMaps } from '../../utils/artifact-to-markdown';

interface StoriesTestsProps {
  featureButtons: FeatureArtifactRef[];
  initiativeTitle?: string;
  // The epic_feature_planner artifact ("Epic/Features" button) — carries per-phase epic
  // titles/deliverables and per-feature rationale/PRD refs/dependencies that the refinement
  // stage's own backlog artifacts don't repeat. Optional: the Stories tab still renders
  // (as a single epic) without it, just without that extra planning detail.
  epicFeaturesArtifactId?: number | null;
  /** PRD artifact id — used to load FR/NFR text for hover tooltips on prdRef badges. */
  prdArtifactId?: number | null;
  /** Unified whole-backlog QA suite artifact ("epic_qa" stage) — the current architecture's
   *  single test-suite source, preferred over merging the legacy per-feature qaArtifactId
   *  entries in featureButtons when present. */
  epicQaArtifactId?: number | null;
}

interface Props extends StoriesTestsProps {
  onClose: () => void;
  workflowId?: string;
}

/** Merge each feature's isolated artifact (epic + its own single-feature array) into one epic + multi-feature backlog. */
export function mergeBacklogs(parsed: Array<{ num: number; data: BacklogData }>): BacklogData | null {
  if (parsed.length === 0) return null;
  const sorted = [...parsed].sort((a, b) => a.num - b.num);
  return {
    epic: sorted.find(p => p.data.epic)?.data.epic,
    features: sorted.flatMap(p => p.data.features ?? []),
  };
}

/**
 * Read-only Stories/Tests tab view that merges every approved per-feature backlog + QA
 * artifact, growing as each feature refinement is approved. Embeddable — no modal chrome of
 * its own — so it can be reused both inside BacklogOverviewModal's drawer and inside the
 * artifact viewer's read of the final backlog_merge artifact (the same merge, rendered the
 * same way wherever it's viewed).
 */
export function BacklogStoriesTests({ featureButtons, initiativeTitle, epicFeaturesArtifactId, prdArtifactId, epicQaArtifactId }: StoriesTestsProps) {
  const [tab, setTab] = useState<'stories' | 'tests'>('stories');
  const [backlog, setBacklog] = useState<BacklogData | null>(null);
  const [qa, setQa] = useState<QATestSuite | null>(null);
  const [epicFeatures, setEpicFeatures] = useState<EpicFeaturesData | null>(null);
  const [frMap, setFrMap] = useState<Record<string, string>>({});
  const [nfrMap, setNfrMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Stable keys so the fetch only re-runs when the actual set of artifact ids changes,
  // not on every parent re-render (featureButtons is rebuilt fresh each render).
  const ticketKey = featureButtons.filter(f => f.ticketArtifactId).map(f => `${f.num}:${f.ticketArtifactId}`).join(',');
  const qaKey = featureButtons.filter(f => f.qaArtifactId).map(f => `${f.num}:${f.qaArtifactId}`).join(',');

  useEffect(() => {
    let stale = false;
    setLoading(true);

    const ticketTargets = featureButtons.filter(f => f.ticketArtifactId);
    const qaTargets = featureButtons.filter(f => f.qaArtifactId);

    Promise.all([
      Promise.all(ticketTargets.map(f =>
        api.getArtifactContent(f.ticketArtifactId!)
          .then(({ content }) => ({ num: f.num, data: tryParseBacklog(content) }))
          .catch(() => null)
      )),
      Promise.all(qaTargets.map(f =>
        api.getArtifactContent(f.qaArtifactId!)
          .then(({ content }) => ({ num: f.num, data: tryParseQATests(content) }))
          .catch(() => null)
      )),
      epicFeaturesArtifactId
        ? api.getArtifactContent(epicFeaturesArtifactId).then(({ content }) => tryParseEpicFeatures(content)).catch(() => null)
        : Promise.resolve(null),
      prdArtifactId
        ? api.getArtifactContent(prdArtifactId).then(({ content }) => content).catch(() => null)
        : Promise.resolve(null),
      // Current architecture: one unified QA suite for the whole backlog, not per feature.
      // Preferred over the legacy per-feature qaTargets merge below when both exist.
      epicQaArtifactId
        ? api.getArtifactContent(epicQaArtifactId).then(({ content }) => tryParseQATests(content)).catch(() => null)
        : Promise.resolve(null),
    ]).then(([ticketResults, qaResults, epicFeaturesResult, prdContent, epicQaResult]) => {
      if (stale) return;
      const validTickets = ticketResults.filter((r): r is { num: number; data: BacklogData } => !!r?.data);
      const validQa = qaResults.filter((r): r is { num: number; data: QATestSuite } => !!r?.data);
      setBacklog(mergeBacklogs(validTickets));
      setQa(epicQaResult ?? mergeQaTests(validQa));
      setEpicFeatures(epicFeaturesResult);
      if (prdContent) {
        const { frMap: frs, nfrMap: nfrs } = buildPrdMaps(prdContent);
        setFrMap(frs);
        setNfrMap(nfrs);
      }
    }).finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [ticketKey, qaKey, epicFeaturesArtifactId, prdArtifactId, epicQaArtifactId]);

  const totalStories = backlog?.features?.reduce((sum, f) => sum + (f.stories?.length ?? 0), 0) ?? 0;
  const totalTests = qa?.test_cases.length ?? 0;

  // Feature -> phase label, from epicFeatures' consecutive per-phase feature counts (each
  // phase owns N features by position, same convention CompletedInitiativeDetail uses).
  // Powers QATestsView's "Phase" grouping toggle for this pre-approval preview.
  const phaseByFeatureKey: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    if (!epicFeatures?.phases?.length) return map;
    let featureIdx = 0;
    for (const phase of epicFeatures.phases) {
      const count = phase.features?.length ?? 0;
      for (let i = featureIdx; i < featureIdx + count; i++) map[`F${i + 1}`] = phase.label;
      featureIdx += count;
    }
    return map;
  })();

  const tabs = [
    { id: 'stories', label: 'Stories', count: totalStories > 0 ? totalStories : undefined },
    { id: 'tests', label: 'Tests', count: totalTests > 0 ? totalTests : undefined },
  ];

  return (
    <ArtifactTabShell tabs={tabs} activeTab={tab} onTabChange={t => setTab(t as 'stories' | 'tests')}>
      {loading ? (
        <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
      ) : tab === 'stories' ? (
        backlog && (backlog.features?.length ?? 0) > 0 ? (
          <BacklogView data={backlog} initiativeTitle={initiativeTitle} epicFeatures={epicFeatures} frMap={frMap} nfrMap={nfrMap} />
        ) : (
          <p className="text-sm text-surface-400 italic">No features approved yet.</p>
        )
      ) : qa && qa.test_cases.length > 0 ? (
        <QATestsView data={qa} frMap={frMap} phaseByFeatureKey={phaseByFeatureKey} phaseOrder={epicFeatures?.phases?.map(p => p.label) ?? []} />
      ) : (
        <p className="text-sm text-surface-400 italic">No QA tests approved yet.</p>
      )}
    </ArtifactTabShell>
  );
}

/**
 * Drawer chrome around BacklogStoriesTests — opened from the pipeline terminal's bottom-bar
 * "Stories/Tests" button.
 */
export function BacklogOverviewModal({ onClose, workflowId, ...storiesTestsProps }: Props) {
  const [toast, setToast] = useState<string | null>(null);

  const handleShare = () => {
    if (!workflowId) return;
    const url = `${window.location.origin}${window.location.pathname}?workflowId=${workflowId}`;
    copyToClipboard(url);
    setToast('Link copied!');
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} />

      <div className="relative h-full bg-surface-50 dark:bg-surface-800 shadow-xl flex flex-col overflow-hidden w-full max-w-4xl">
        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Stories &amp; Tests</h2>
          <div className="flex items-center gap-1">
            {workflowId && (
              <button
                onClick={handleShare}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                  toast === 'Link copied!'
                    ? 'border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                    : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600 hover:text-surface-700 dark:hover:text-surface-200'
                }`}
                title="Copy shareable link"
              >
                {toast === 'Link copied!' ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Link copied!
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share
                  </>
                )}
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <BacklogStoriesTests {...storiesTestsProps} />
      </div>
    </div>
  );
}
