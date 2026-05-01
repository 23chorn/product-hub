import { useState } from 'react';
import { api } from '../services/api';
import { useConfigStore } from '../stores/configStore';
import { useModelStore } from '../stores/modelStore';

interface FormattedStory {
  title: string;
  persona: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string[];
  storyPoints: number;
  complexityRationale: string;
}

interface QuickTicketPanelProps {
  onClose: () => void;
}

const POINT_LABEL: Record<number, string> = {
  1: 'Trivial',
  2: 'Simple',
  3: 'Small',
  5: 'Medium',
  8: 'Complex',
  13: 'Large',
};

function storyPointBadgeClass(pts: number): string {
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

export function QuickTicketPanel({ onClose }: QuickTicketPanelProps) {
  const { config } = useConfigStore();
  const { selectedModelId } = useModelStore();
  const isAdoConfigured = config?.integrations?.workItems === 'ado';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [story, setStory] = useState<FormattedStory | null>(null);
  const [aiEstimateDevHours, setAiEstimateDevHours] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ id: number; url: string } | null>(null);

  const handleSubmit = async () => {
    if (!title.trim() || isStreaming) return;

    setIsStreaming(true);
    setStreamedText('');
    setStory(null);
    setAiEstimateDevHours(null);
    setError(null);
    setPushResult(null);

    try {
      await api.estimateTicket(
        title.trim(),
        description.trim() || undefined,
        (chunk) => setStreamedText(prev => prev + chunk),
        ({ story: s, aiEstimateDevHours: h }) => {
          setStory(s);
          setAiEstimateDevHours(h);
        },
        (err) => setError(err),
        selectedModelId || undefined
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsStreaming(false);
    }
  };

  const handlePushToAdo = async () => {
    if (!story || isPushing) return;

    setIsPushing(true);
    setError(null);
    try {
      const result = await api.pushTicketToAdo({
        title: story.title,
        persona: story.persona,
        goal: story.goal,
        benefit: story.benefit,
        acceptanceCriteria: story.acceptanceCriteria,
        storyPoints: story.storyPoints,
        aiEstimateDevHours: aiEstimateDevHours ?? undefined,
      });
      setPushResult(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Quick Ticket</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Format a ticket and get an AI complexity estimate</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Input form */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Ticket title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
              placeholder="e.g. Add CSV export to reports page"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Additional context <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Technical notes, constraints, or any extra detail..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isStreaming}
            className="w-full py-2 px-4 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            {isStreaming ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analysing...
              </span>
            ) : 'Format & Estimate'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Streaming text (while processing, before result parses) */}
        {isStreaming && streamedText && !story && (
          <div className="p-4 bg-gray-50 dark:bg-gray-700/40 rounded-lg border border-gray-200 dark:border-gray-600">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Analysing...</p>
            <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{streamedText}</p>
          </div>
        )}

        {/* Formatted result */}
        {story && (
          <div className="space-y-4">
            {/* Estimate badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${storyPointBadgeClass(story.storyPoints)}`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                {story.storyPoints} {POINT_LABEL[story.storyPoints] ? `— ${POINT_LABEL[story.storyPoints]}` : 'pts'}
              </span>

              {aiEstimateDevHours !== null && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  AI Est. Dev: {aiEstimateDevHours}h
                </span>
              )}
            </div>

            {/* Complexity rationale */}
            {story.complexityRationale && (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic leading-relaxed">{story.complexityRationale}</p>
            )}

            {/* Story card */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
              {/* Title bar */}
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{story.title}</p>
              </div>

              {/* User story body */}
              <div className="px-4 py-3 space-y-1.5 border-b border-gray-200 dark:border-gray-600">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">As a</span> {story.persona}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">I want</span> {story.goal}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">So that</span> {story.benefit}
                </p>
              </div>

              {/* Acceptance Criteria */}
              {story.acceptanceCriteria.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2.5">
                    Acceptance Criteria
                  </p>
                  <ol className="space-y-2.5">
                    {story.acceptanceCriteria.map((ac, i) => (
                      <li key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                        <span className="font-semibold text-gray-900 dark:text-gray-100 mr-1">AC {i + 1}:</span>
                        {highlightGWT(ac)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            {/* Push to ADO */}
            {isAdoConfigured && (
              <div>
                {pushResult ? (
                  <a
                    href={pushResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Created #{pushResult.id} — Open in ADO
                  </a>
                ) : (
                  <button
                    onClick={handlePushToAdo}
                    disabled={isPushing}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {isPushing ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Creating...
                      </>
                    ) : 'Push to ADO'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
