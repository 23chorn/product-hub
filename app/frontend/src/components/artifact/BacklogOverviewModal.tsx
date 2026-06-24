import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { tryParseBacklog, type BacklogData } from '../../utils/backlog-helpers';
import { BacklogView } from './BacklogView';
import { tryParseQATests, QATestsView } from './QATestsView';

type QATestSuite = NonNullable<ReturnType<typeof tryParseQATests>>;

export interface FeatureArtifactRef {
  num: number;
  ticketArtifactId?: number;
  qaArtifactId?: number;
}

interface Props {
  featureButtons: FeatureArtifactRef[];
  initiativeTitle?: string;
  onClose: () => void;
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

/** Merge each feature's standalone QA suite into one combined test-case list. */
function mergeQaTests(parsed: Array<{ num: number; data: QATestSuite }>): QATestSuite | null {
  if (parsed.length === 0) return null;
  const sorted = [...parsed].sort((a, b) => a.num - b.num);
  const test_cases = sorted.flatMap(p => p.data.test_cases ?? []);
  return { suite: 'Combined QA Test Suite', test_cases, coverage: { total: test_cases.length } };
}

/**
 * Read-only overview that merges every approved per-feature backlog + QA artifact into one
 * "Stories" and "Tests" view, growing as each feature refinement is approved. Replaces the
 * old per-feature button pairs (one Tickets + one QA Tests button per feature).
 */
export function BacklogOverviewModal({ featureButtons, initiativeTitle, onClose }: Props) {
  const [tab, setTab] = useState<'stories' | 'tests'>('stories');
  const [backlog, setBacklog] = useState<BacklogData | null>(null);
  const [qa, setQa] = useState<QATestSuite | null>(null);
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
    ]).then(([ticketResults, qaResults]) => {
      if (stale) return;
      const validTickets = ticketResults.filter((r): r is { num: number; data: BacklogData } => !!r?.data);
      const validQa = qaResults.filter((r): r is { num: number; data: QATestSuite } => !!r?.data);
      setBacklog(mergeBacklogs(validTickets));
      setQa(mergeQaTests(validQa));
    }).finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [ticketKey, qaKey]);

  const totalStories = backlog?.features?.reduce((sum, f) => sum + (f.stories?.length ?? 0), 0) ?? 0;
  const totalTests = qa?.test_cases.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-2xl h-full bg-white dark:bg-surface-800 shadow-xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Stories &amp; Tests</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
          <button
            onClick={() => setTab('stories')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              tab === 'stories'
                ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-500'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
            }`}
          >
            Stories{totalStories > 0 && <span className="ml-1 opacity-60">({totalStories})</span>}
          </button>
          <button
            onClick={() => setTab('tests')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              tab === 'tests'
                ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-500'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
            }`}
          >
            Tests{totalTests > 0 && <span className="ml-1 opacity-60">({totalTests})</span>}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
          ) : tab === 'stories' ? (
            backlog && (backlog.features?.length ?? 0) > 0 ? (
              <BacklogView data={backlog} initiativeTitle={initiativeTitle} />
            ) : (
              <p className="text-sm text-surface-400 italic">No features approved yet.</p>
            )
          ) : qa && qa.test_cases.length > 0 ? (
            <QATestsView data={qa} />
          ) : (
            <p className="text-sm text-surface-400 italic">No QA tests approved yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
