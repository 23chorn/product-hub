import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useConfigStore } from '../../stores/configStore';
import { useModelStore } from '../../stores/modelStore';
import type { QuickFeatureResult, QuickFR, QuickStory, QuickFeatureHistoryEntry } from '../../services/api/quickFeature';

// ── Constants ──────────────────────────────────────────────────────────────────

const POINT_LABEL: Record<number, string> = {
  1: 'Trivial', 2: 'Simple', 3: 'Small', 5: 'Medium', 8: 'Complex',
};

type StreamKey = 'backend' | 'web' | 'ios' | 'android';
type PlatformChoice = 'web' | 'mobile';

const STREAMS: Array<{ key: StreamKey; label: string }> = [
  { key: 'backend', label: 'Backend' },
  { key: 'web',     label: 'Web' },
  { key: 'ios',     label: 'iOS' },
  { key: 'android', label: 'Android' },
];

const STREAM_COLOR: Record<StreamKey, { badge: string }> = {
  backend: { badge: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300' },
  web:     { badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' },
  ios:     { badge: 'bg-slate-100 text-slate-800 dark:bg-slate-700/60 dark:text-slate-300' },
  android: { badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
};

function platformToStreams(choice: PlatformChoice): StreamKey[] {
  return choice === 'web' ? ['backend', 'web'] : ['backend', 'ios', 'android'];
}

function pointBadgeClass(pts: number): string {
  if (pts <= 2) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (pts <= 5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

function highlightGWT(text: string) {
  const parts = text.split(/(\bGiven\b|\bWhen\b|\bThen\b|\bAnd\b|\bBut\b)/i);
  return parts.map((part, i) =>
    /^(Given|When|Then|And|But)$/i.test(part)
      ? <strong key={i} className="text-surface-900 dark:text-surface-100">{part}</strong>
      : <span key={i}>{part}</span>
  );
}

function formatRelativeTime(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StreamBadge({ platform }: { platform: string }) {
  const stream = STREAMS.find(s => s.key === platform);
  if (!stream) return null;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STREAM_COLOR[stream.key].badge}`}>
      {stream.label}
    </span>
  );
}

function StoryCard({ story, index }: { story: QuickStory; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-750 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono text-surface-400 dark:text-surface-500 flex-shrink-0">S{index + 1}</span>
          <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{story.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {story.platform && <StreamBadge platform={story.platform} />}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pointBadgeClass(story.storyPoints)}`}>
            {story.storyPoints}{POINT_LABEL[story.storyPoints] ? ` · ${POINT_LABEL[story.storyPoints]}` : ''}
          </span>
          <svg className={`w-4 h-4 text-surface-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-surface-200 dark:border-surface-700 px-4 py-3 bg-surface-50 dark:bg-surface-900/40 space-y-3">
          <div className="space-y-1">
            <p className="text-sm text-surface-700 dark:text-surface-300">
              <span className="font-semibold text-surface-900 dark:text-surface-100">As a</span> {story.persona}
            </p>
            <p className="text-sm text-surface-700 dark:text-surface-300">
              <span className="font-semibold text-surface-900 dark:text-surface-100">I want</span> {story.goal}
            </p>
            <p className="text-sm text-surface-700 dark:text-surface-300">
              <span className="font-semibold text-surface-900 dark:text-surface-100">So that</span> {story.benefit}
            </p>
          </div>
          {story.acceptanceCriteria.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wide mb-2">
                Acceptance Criteria
              </p>
              <ol className="space-y-2">
                {story.acceptanceCriteria.map((ac, i) => (
                  <li key={i} className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed">
                    <span className="font-semibold text-surface-900 dark:text-surface-100 mr-1">AC {i + 1}:</span>
                    {highlightGWT(ac)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FRSection({ fr }: { fr: QuickFR }) {
  const totalPoints = fr.stories.reduce((sum, s) => sum + s.storyPoints, 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 border border-brand-200 dark:border-brand-700/40">
          {fr.id}
        </span>
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{fr.title}</h3>
        <span className="text-xs text-surface-400 dark:text-surface-500 ml-auto">
          {fr.stories.length} {fr.stories.length === 1 ? 'story' : 'stories'} · {totalPoints} pts
        </span>
      </div>
      <div className="space-y-1.5">
        {fr.stories.map((story, i) => <StoryCard key={i} story={story} index={i} />)}
      </div>
    </div>
  );
}

function StreamBreakdown({ result }: { result: QuickFeatureResult }) {
  const allStories = result.functionalRequirements.flatMap(fr => fr.stories);
  const breakdown = STREAMS.map(({ key, label }) => {
    const matching = allStories.filter(s => s.platform === key);
    if (matching.length === 0) return null;
    return { key, label, stories: matching.length, points: matching.reduce((s, st) => s + st.storyPoints, 0) };
  }).filter(Boolean) as Array<{ key: StreamKey; label: string; stories: number; points: number }>;

  if (breakdown.length === 0) return null;
  return (
    <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 flex flex-wrap gap-3">
      {breakdown.map(({ key, label, stories, points }) => (
        <div key={key} className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STREAM_COLOR[key].badge}`}>{label}</span>
          <span className="text-xs text-surface-500 dark:text-surface-400">
            {stories} {stories === 1 ? 'story' : 'stories'} · {points} pts
          </span>
        </div>
      ))}
    </div>
  );
}

function FeatureReview({
  result, isAdoConfigured, isPushing, pushResult, onPush, onRevise,
}: {
  result: QuickFeatureResult;
  isAdoConfigured: boolean;
  isPushing: boolean;
  pushResult: { featureId: number; featureUrl: string; stories: Array<{ id: number; url: string; title: string }> } | null;
  onPush: () => void;
  onRevise: () => void;
}) {
  const allStories = result.functionalRequirements.flatMap(fr => fr.stories);
  const totalStories = allStories.length;
  const totalPoints = allStories.reduce((s, st) => s + st.storyPoints, 0);

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wide mb-1">Feature</p>
              <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">{result.feature.title}</h3>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 text-xs text-surface-500 dark:text-surface-400">
              <span>{totalStories} stories</span>
              <span className="text-surface-300 dark:text-surface-600">·</span>
              <span>{totalPoints} pts</span>
              <span className="text-surface-300 dark:text-surface-600">·</span>
              <span>{result.functionalRequirements.length} FR{result.functionalRequirements.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-2 leading-relaxed">{result.feature.description}</p>
        </div>
        <StreamBreakdown result={result} />
        <div className="px-5 py-4 space-y-5">
          {result.functionalRequirements.map(fr => <FRSection key={fr.id} fr={fr} />)}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {isAdoConfigured && (
          pushResult ? (
            <a href={pushResult.featureUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Feature #{pushResult.featureId} — Open in ADO
            </a>
          ) : (
            <button onClick={onPush} disabled={isPushing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors">
              {isPushing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Pushing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Push to ADO
                </>
              )}
            </button>
          )
        )}
        {!pushResult && (
          <button onClick={onRevise}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Revise
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryEntry({ entry }: { entry: QuickFeatureHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const totalStories = entry.result.functionalRequirements.reduce((sum, fr) => sum + fr.stories.length, 0);
  return (
    <div className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
      <button onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-750 transition-colors text-left">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-surface-800 dark:text-surface-200 truncate">{entry.title}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            {totalStories} stories · {entry.result.functionalRequirements.length} FR{entry.result.functionalRequirements.length !== 1 ? 's' : ''}
            <span className="mx-1.5 text-surface-300 dark:text-surface-600">·</span>
            {formatRelativeTime(entry.pushedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {entry.adoFeatureUrl && (
            <a href={entry.adoFeatureUrl} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
              #{entry.adoFeatureId}
            </a>
          )}
          <svg className={`w-4 h-4 text-surface-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-surface-200 dark:border-surface-700 px-4 py-4 bg-surface-50 dark:bg-surface-900/30 space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
            {entry.result.feature.description}
          </p>
          <StreamBreakdown result={entry.result} />
          <div className="space-y-4">
            {entry.result.functionalRequirements.map(fr => <FRSection key={fr.id} fr={fr} />)}
          </div>
          {entry.adoStories.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wide mb-2">ADO Stories</p>
              <div className="flex flex-wrap gap-2">
                {entry.adoStories.map(s => (
                  <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
                    <span className="text-surface-400">#{s.id}</span>
                    <span className="truncate max-w-[160px]">{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function QuickFeaturePanel() {
  const { config } = useConfigStore();
  const { selectedModelId } = useModelStore();
  const isAdoConfigured = config?.integrations?.workItems === 'ado';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [platformChoice, setPlatformChoice] = useState<PlatformChoice>('web');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [result, setResult] = useState<QuickFeatureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ featureId: number; featureUrl: string; stories: Array<{ id: number; url: string; title: string }> } | null>(null);

  const [isRevising, setIsRevising] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const revisionRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [history, setHistory] = useState<QuickFeatureHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    api.getQuickFeatureHistory()
      .then(h => setHistory(h))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);


  const openRevise = () => {
    setIsRevising(true);
    // Scroll to revise panel after render
    setTimeout(() => {
      revisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const runGenerate = async (opts?: { previousResult?: QuickFeatureResult; revisionFeedback?: string }) => {
    if (!title.trim() || !description.trim() || isGenerating) return;
    setIsGenerating(true);
    setStreamedText('');
    setError(null);
    if (!opts?.previousResult) {
      setResult(null);
      setPushResult(null);
    }
    try {
      await api.generateQuickFeature(
        title.trim(),
        description.trim(),
        chunk => setStreamedText(prev => prev + chunk),
        r => { setResult(r); setIsRevising(false); setRevisionFeedback(''); },
        err => setError(err),
        { model: selectedModelId || undefined, enabledStreams: platformToStreams(platformChoice), ...opts }
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReviseSubmit = () => {
    if (!revisionFeedback.trim() || !result) return;
    setPushResult(null);
    runGenerate({ previousResult: result, revisionFeedback });
  };

  const handlePush = async () => {
    if (!result || isPushing) return;
    setIsPushing(true);
    setError(null);
    try {
      const r = await api.pushQuickFeature(title.trim(), description.trim(), result);
      setPushResult(r);
      setHistory(prev => [{
        id: r.id,
        title: title.trim(),
        description: description.trim(),
        result,
        adoFeatureId: r.featureId,
        adoFeatureUrl: r.featureUrl,
        adoStories: r.stories,
        pushedAt: Math.floor(Date.now() / 1000),
      }, ...prev]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPushing(false);
    }
  };

  const canGenerate = title.trim() && description.trim() && !isGenerating;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">

          {/* Input form */}
          <div className="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Feature brief</h2>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                Describe the feature — the AI generates 1–3 FRs with one story per stream per requirement.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Feature title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && canGenerate && runGenerate()}
                  placeholder="e.g. User profile editing with avatar upload"
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  disabled={isGenerating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Context <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Constraints, scope limits, technical notes, or anything the PM should know..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                  disabled={isGenerating}
                />
              </div>

              {/* Platform toggle */}
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Platform
                </label>
                <div className="inline-flex rounded-lg border border-surface-300 dark:border-surface-600 overflow-hidden">
                  {(['web', 'mobile'] as PlatformChoice[]).map(choice => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setPlatformChoice(choice)}
                      className={`px-4 py-1.5 text-xs font-semibold transition-colors ${
                        platformChoice === choice
                          ? 'bg-brand-600 text-white'
                          : 'bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700'
                      }`}
                    >
                      {choice === 'web' ? 'Web' : 'Mobile'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-1.5">
                  {platformChoice === 'web' ? 'Generates Backend + Web stories' : 'Generates Backend + iOS + Android stories'}
                </p>
              </div>

              <button
                onClick={() => runGenerate()}
                disabled={!canGenerate}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isGenerating && !isRevising ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </span>
                ) : result ? 'Regenerate' : 'Generate feature'}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {isGenerating && streamedText && !result && (
            <div className="p-4 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Thinking...</p>
              <p className="text-sm text-surface-600 dark:text-surface-300 whitespace-pre-wrap leading-relaxed font-mono">{streamedText}</p>
            </div>
          )}

          {result && (
            <>
              <FeatureReview
                result={result}
                isAdoConfigured={isAdoConfigured}
                isPushing={isPushing}
                pushResult={pushResult}
                onPush={handlePush}
                onRevise={openRevise}
              />

              {isRevising && (
                <div ref={revisionRef} className="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3">
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">What should change?</p>
                  <textarea
                    autoFocus
                    value={revisionFeedback}
                    onChange={e => setRevisionFeedback(e.target.value)}
                    placeholder="e.g. Split FR1 into two separate requirements, add a story for error handling, make story points more conservative..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReviseSubmit}
                      disabled={!revisionFeedback.trim() || isGenerating}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      {isGenerating ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Revising...
                        </>
                      ) : 'Revise'}
                    </button>
                    <button
                      onClick={() => { setIsRevising(false); setRevisionFeedback(''); }}
                      className="px-4 py-2 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">Recently pushed</h3>
              <div className="space-y-2">
                {history.map(entry => <HistoryEntry key={entry.id} entry={entry} />)}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
