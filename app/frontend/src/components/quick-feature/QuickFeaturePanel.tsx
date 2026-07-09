import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useConfigStore } from '../../stores/configStore';
import { useModelStore } from '../../stores/modelStore';
import type { QuickFeatureResult, QuickFR, QuickStory, QuickFeatureHistoryEntry } from '../../services/api/quickFeature';
import { FieldLabel } from '../common/FieldLabel';
import { AcceptanceCriteriaConsole, Chevron, DotLabel } from '../artifact/ArtifactPrimitives';
import { FeatureKeyBadge } from '../artifact/EpicFeaturesView';
import { PlatformTags } from '../artifact/BacklogView';

// ── Constants ──────────────────────────────────────────────────────────────────

const POINT_LABEL: Record<number, string> = {
  1: 'Trivial', 2: 'Simple', 3: 'Small', 5: 'Medium', 8: 'Complex',
};

type StreamKey = 'backend' | 'web' | 'ios' | 'android';
type PlatformChoice = 'web' | 'mobile';

const STREAM_ORDER: StreamKey[] = ['backend', 'web', 'ios', 'android'];

function platformToStreams(choice: PlatformChoice): StreamKey[] {
  return choice === 'web' ? ['backend', 'web'] : ['backend', 'ios', 'android'];
}

/** Story-point dot color by size band, mirroring BacklogView's effort dot but keeping its own
 *  thresholds (2/5 vs BacklogView's 5/8) — this flow only ever produces 1/2/3/5/8-point
 *  stories, a narrower Fibonacci range than a full backlog story. */
function pointDotClass(pts: number): { dot: string; text: string } {
  if (pts <= 2) return { dot: 'bg-green-400', text: 'text-green-700 dark:text-green-500' };
  if (pts <= 5) return { dot: 'bg-amber-400', text: 'text-amber-700 dark:text-amber-500' };
  return { dot: 'bg-red-400', text: 'text-red-700 dark:text-red-500' };
}

function formatRelativeTime(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StoryCard({ story, index }: { story: QuickStory; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const pointColor = pointDotClass(story.storyPoints);
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Chevron expanded={expanded} className="w-3.5 text-surface-400" />
          <FeatureKeyBadge label={`S${index + 1}`} />
          <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{story.title}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
          {story.platform && <PlatformTags platform={story.platform} />}
          <DotLabel
            dotClass={pointColor.dot}
            textClass={pointColor.text}
            label={`${story.storyPoints}${POINT_LABEL[story.storyPoints] ? ` · ${POINT_LABEL[story.storyPoints].toLowerCase()}` : ''}`}
          />
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
              <p className="text-[10px] font-mono font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-widest mb-2">
                acceptance criteria
              </p>
              <AcceptanceCriteriaConsole items={story.acceptanceCriteria} />
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
        <FeatureKeyBadge label={fr.id} />
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{fr.title}</h3>
        <span className="text-xs font-mono text-surface-400 dark:text-surface-500 ml-auto">
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
  const breakdown = STREAM_ORDER.map(key => {
    const matching = allStories.filter(s => s.platform === key);
    if (matching.length === 0) return null;
    return { key, stories: matching.length, points: matching.reduce((s, st) => s + st.storyPoints, 0) };
  }).filter(Boolean) as Array<{ key: StreamKey; stories: number; points: number }>;

  if (breakdown.length === 0) return null;
  return (
    <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 flex flex-wrap gap-3">
      {breakdown.map(({ key, stories, points }) => (
        <div key={key} className="flex items-center gap-2">
          <PlatformTags platform={key} />
          <span className="text-xs font-mono text-surface-500 dark:text-surface-400">
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
      <div className="bg-surface-50 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-widest mb-1">feature</p>
              <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100">{result.feature.title}</h3>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 text-xs font-mono text-surface-500 dark:text-surface-400">
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              feature #{pushResult.featureId} — open in ADO
            </a>
          ) : (
            <button onClick={onPush} disabled={isPushing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-mono font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors">
              {isPushing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  pushing…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  push to ADO →
                </>
              )}
            </button>
          )
        )}
        {!pushResult && (
          <button onClick={onRevise}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            revise →
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
        className="w-full flex items-center gap-3 px-4 py-3 bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-left">
        <Chevron expanded={expanded} className="w-3.5 text-surface-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-surface-800 dark:text-surface-200 truncate">{entry.title}</p>
          <p className="text-xs font-mono text-surface-500 dark:text-surface-400 mt-0.5">
            {totalStories} stories · {entry.result.functionalRequirements.length} FR{entry.result.functionalRequirements.length !== 1 ? 's' : ''}
            <span className="mx-1.5 text-surface-300 dark:text-surface-600">·</span>
            {formatRelativeTime(entry.pushedAt)}
          </p>
        </div>
        {entry.adoFeatureUrl && (
          <a href={entry.adoFeatureUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs font-mono font-medium text-brand-600 dark:text-brand-400 hover:underline flex-shrink-0">
            #{entry.adoFeatureId}
          </a>
        )}
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
              <p className="text-[10px] font-mono font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-widest mb-2">ado stories</p>
              <div className="flex flex-wrap gap-2">
                {entry.adoStories.map(s => (
                  <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
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
          <div className="bg-brand-50/60 dark:bg-brand-900/20 rounded-lg border border-brand-200 dark:border-brand-800 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-mono font-semibold text-brand-700 dark:text-brand-300">
                <span className="text-brand-500">&gt;</span> quick feature
              </h2>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                Describe the feature — the AI generates 1–3 FRs with one story per stream per requirement.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <FieldLabel>feature title <span className="text-red-500">*</span></FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && canGenerate && runGenerate()}
                  placeholder="e.g. user profile editing with avatar upload"
                  className="w-full px-3 py-2 rounded-md border border-brand-300 dark:border-brand-600 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  disabled={isGenerating}
                />
              </div>

              <div>
                <FieldLabel>context <span className="text-red-500">*</span></FieldLabel>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="constraints, scope limits, technical notes, or anything the PM should know…"
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-brand-300 dark:border-brand-600 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                  disabled={isGenerating}
                />
              </div>

              {/* Platform toggle */}
              <div>
                <FieldLabel>platform</FieldLabel>
                <div className="inline-flex rounded-md border border-brand-300 dark:border-brand-600 overflow-hidden">
                  {(['web', 'mobile'] as PlatformChoice[]).map(choice => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setPlatformChoice(choice)}
                      className={`px-4 py-1.5 text-xs font-mono font-semibold transition-colors ${
                        platformChoice === choice
                          ? 'bg-brand-600 text-white'
                          : 'bg-surface-50 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                      }`}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-1.5">
                  {platformChoice === 'web' ? 'generates backend + web stories' : 'generates backend + iOS + android stories'}
                </p>
              </div>

              <button
                onClick={() => runGenerate()}
                disabled={!canGenerate}
                className="w-full py-2.5 px-4 rounded-md text-sm font-mono font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isGenerating && !isRevising ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    generating…
                  </span>
                ) : result ? 'regenerate →' : 'generate feature →'}
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
              <p className="text-xs font-mono font-medium text-surface-500 dark:text-surface-400 mb-2">thinking…</p>
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
                <div ref={revisionRef} className="bg-surface-50 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3">
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">What should change?</p>
                  <textarea
                    autoFocus
                    value={revisionFeedback}
                    onChange={e => setRevisionFeedback(e.target.value)}
                    placeholder="e.g. split FR1 into two separate requirements, add a story for error handling, make story points more conservative…"
                    rows={3}
                    className="w-full px-3 py-2 rounded-md border border-brand-300 dark:border-brand-600 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReviseSubmit}
                      disabled={!revisionFeedback.trim() || isGenerating}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      {isGenerating ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          revising…
                        </>
                      ) : 'revise →'}
                    </button>
                    <button
                      onClick={() => { setIsRevising(false); setRevisionFeedback(''); }}
                      className="px-4 py-2 rounded-lg text-sm font-mono font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                    >
                      cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500">recently pushed</h3>
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
