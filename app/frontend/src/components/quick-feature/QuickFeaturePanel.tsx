import { useState } from 'react';
import { api } from '../../services/api';
import { useConfigStore } from '../../stores/configStore';
import { useModelStore } from '../../stores/modelStore';
import type { QuickFeatureResult, QuickFR, QuickStory } from '../../services/api/quickFeature';

const POINT_LABEL: Record<number, string> = {
  1: 'Trivial', 2: 'Simple', 3: 'Small', 5: 'Medium', 8: 'Complex',
};

function pointBadgeClass(pts: number): string {
  if (pts <= 2) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (pts <= 5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

function highlightGWT(text: string) {
  const parts = text.split(/(\bGiven\b|\bWhen\b|\bThen\b|\bAnd\b|\bBut\b)/i);
  return parts.map((part, i) =>
    /^(Given|When|Then|And|But)$/i.test(part)
      ? <strong key={i} className="text-gray-900 dark:text-gray-100">{part}</strong>
      : <span key={i}>{part}</span>
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
          <span className="text-xs font-mono text-surface-400 dark:text-surface-500 flex-shrink-0">
            S{index + 1}
          </span>
          <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
            {story.title}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pointBadgeClass(story.storyPoints)}`}>
            {story.storyPoints} {POINT_LABEL[story.storyPoints] ? `· ${POINT_LABEL[story.storyPoints]}` : 'pts'}
          </span>
          <svg
            className={`w-4 h-4 text-surface-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
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

function FRSection({ fr, frIndex }: { fr: QuickFR; frIndex: number }) {
  const totalPoints = fr.stories.reduce((sum, s) => sum + s.storyPoints, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 border border-brand-200 dark:border-brand-700/40">
          {fr.id}
        </span>
        <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">{fr.title}</h3>
        <span className="text-xs text-surface-400 dark:text-surface-500 ml-auto">
          {fr.stories.length} {fr.stories.length === 1 ? 'story' : 'stories'} · {totalPoints} pts
        </span>
      </div>
      <div className="space-y-1.5">
        {fr.stories.map((story, i) => (
          <StoryCard key={i} story={story} index={i} />
        ))}
      </div>
    </div>
  );
}

export function QuickFeaturePanel() {
  const { config } = useConfigStore();
  const { selectedModelId } = useModelStore();
  const isAdoConfigured = config?.integrations?.workItems === 'ado';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [result, setResult] = useState<QuickFeatureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ featureId: number; featureUrl: string; stories: Array<{ id: number; url: string; title: string }> } | null>(null);

  const totalStories = result?.functionalRequirements.reduce((sum, fr) => sum + fr.stories.length, 0) ?? 0;
  const totalPoints = result?.functionalRequirements.reduce(
    (sum, fr) => sum + fr.stories.reduce((s, story) => s + story.storyPoints, 0), 0
  ) ?? 0;

  const handleGenerate = async () => {
    if (!title.trim() || !description.trim() || isGenerating) return;

    setIsGenerating(true);
    setStreamedText('');
    setResult(null);
    setError(null);
    setPushResult(null);

    try {
      await api.generateQuickFeature(
        title.trim(),
        description.trim() || undefined,
        (chunk) => setStreamedText(prev => prev + chunk),
        (r) => setResult(r),
        (err) => setError(err),
        selectedModelId || undefined
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePush = async () => {
    if (!result || isPushing) return;

    setIsPushing(true);
    setError(null);
    try {
      const r = await api.pushQuickFeature(result);
      setPushResult(r);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">

          {/* Input section */}
          <div className="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Feature brief</h2>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                Describe the feature — the AI generates up to 2 FRs with sprint-ready stories.
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
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleGenerate()}
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
              <button
                onClick={handleGenerate}
                disabled={!title.trim() || !description.trim() || isGenerating}
                className="w-full py-2.5 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isGenerating ? (
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

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Streaming output while generating */}
          {isGenerating && streamedText && !result && (
            <div className="p-4 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Thinking...</p>
              <p className="text-sm text-surface-600 dark:text-surface-300 whitespace-pre-wrap leading-relaxed font-mono">
                {streamedText}
              </p>
            </div>
          )}

          {/* Review section */}
          {result && (
            <div className="space-y-5">
              {/* Feature header */}
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
                      <span>{totalPoints} pts total</span>
                      <span className="text-surface-300 dark:text-surface-600">·</span>
                      <span>{result.functionalRequirements.length} FR{result.functionalRequirements.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <p className="text-sm text-surface-600 dark:text-surface-400 mt-2 leading-relaxed">
                    {result.feature.description}
                  </p>
                </div>

                {/* FRs */}
                <div className="px-5 py-4 space-y-5">
                  {result.functionalRequirements.map((fr, i) => (
                    <FRSection key={fr.id} fr={fr} frIndex={i} />
                  ))}
                </div>
              </div>

              {/* Push to ADO */}
              {isAdoConfigured && (
                <div className="flex items-center gap-3">
                  {pushResult ? (
                    <div className="flex items-center gap-3 flex-wrap">
                      <a
                        href={pushResult.featureUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Feature #{pushResult.featureId} — Open in ADO
                      </a>
                      <span className="text-sm text-surface-500 dark:text-surface-400">
                        {pushResult.stories.length} {pushResult.stories.length === 1 ? 'story' : 'stories'} created
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={handlePush}
                      disabled={isPushing}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      {isPushing ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Pushing to ADO...
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
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
