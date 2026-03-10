import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkflowStore } from '../stores/workflowStore';
import { api } from '../services/api';

const STAGE_LABELS: Record<string, string> = {
  analyst:            'Analyst Research',
  pm_prd:             'Product Requirements Document',
  solution_architect: 'Solution Architecture',
  pm_backlog:         'Backlog',
  critic:             'Critic Review',
  curator:            'Context Curation',
};

// ── Backlog JSON types ──────────────────────────────────────────────────────

interface BacklogStory {
  title: string;
  persona?: string;
  goal?: string;
  benefit?: string;
  acceptanceCriteria?: string[];
  agentContext?: string;
}

interface BacklogFeature {
  title: string;
  description?: string;
  phase?: string;
  stories: BacklogStory[];
}

interface BacklogData {
  epic: {
    title: string;
    description?: string;
    businessValue?: string;
    prdLink?: string;
  };
  features: BacklogFeature[];
}

function tryParseBacklog(content: string): BacklogData | null {
  try {
    // Strip code fences if present
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed?.epic && Array.isArray(parsed?.features)) return parsed as BacklogData;
    return null;
  } catch {
    return null;
  }
}

function BacklogView({ data }: { data: BacklogData }) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());

  const toggleStory = (key: string) => {
    setExpandedStories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const totalStories = data.features.reduce((sum, f) => sum + f.stories.length, 0);

  return (
    <div className="space-y-4">
      {/* Epic header */}
      <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Epic</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.features.length} feature{data.features.length !== 1 ? 's' : ''} · {totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
          </span>
        </div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{data.epic.title}</h3>
        {data.epic.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{data.epic.description}</p>
        )}
        {data.epic.businessValue && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">{data.epic.businessValue}</p>
        )}
      </div>

      {/* Features */}
      {data.features.map((feature, fi) => (
        <div key={fi} className="rounded-lg border border-gray-200 dark:border-gray-700">
          {/* Feature header */}
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-400">Feature</span>
              {feature.phase && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  feature.phase === 'MVP'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {feature.phase}
                </span>
              )}
            </div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{feature.title}</h4>
            {feature.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{feature.description}</p>
            )}
          </div>

          {/* Stories */}
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {feature.stories.map((story, si) => {
              const key = `${fi}-${si}`;
              const isExpanded = expandedStories.has(key);

              return (
                <div key={si} className="px-4 py-2.5">
                  <button
                    onClick={() => toggleStory(key)}
                    className="w-full text-left flex items-start gap-2 group"
                  >
                    <svg
                      className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">S{fi + 1}.{si + 1}</span>
                        <span className="text-sm text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {story.title}
                        </span>
                      </div>
                      {story.persona && !isExpanded && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{story.persona}</p>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="ml-5.5 mt-2 space-y-2 pl-4 border-l-2 border-gray-100 dark:border-gray-700">
                      {story.persona && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Persona: </span>
                          <span className="text-xs text-gray-700 dark:text-gray-300">{story.persona}</span>
                        </div>
                      )}
                      {story.goal && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Goal: </span>
                          <span className="text-xs text-gray-700 dark:text-gray-300">{story.goal}</span>
                        </div>
                      )}
                      {story.benefit && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Benefit: </span>
                          <span className="text-xs text-gray-700 dark:text-gray-300">{story.benefit}</span>
                        </div>
                      )}
                      {story.acceptanceCriteria && story.acceptanceCriteria.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Acceptance Criteria:</p>
                          <ul className="space-y-1">
                            {story.acceptanceCriteria.map((ac, ai) => (
                              <li key={ai} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                                <span className="text-green-500 mt-px flex-shrink-0">✓</span>
                                <span>{ac}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {story.agentContext && (
                        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 mt-1">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Agent Context:</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400">{story.agentContext}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ArtifactViewer() {
  const { viewingArtifactId, setViewingArtifactId, checkpoints, activeWorkflow, applyWorkflowStatus, addCoordinatorMessage } = useWorkflowStore();
  const [content, setContent] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Find the pending checkpoint that has this artifact
  const pendingCheckpoint = checkpoints.find(
    c => c.status === 'pending' && c.artifact_id === viewingArtifactId
  );

  useEffect(() => {
    if (!viewingArtifactId) { setContent(null); return; }
    setLoading(true);
    setError(null);
    api.getArtifactContent(viewingArtifactId)
      .then(({ content: c, type: t }) => { setContent(c); setArtifactType(t); })
      .catch(() => { setContent(null); setError('Failed to load artifact'); })
      .finally(() => setLoading(false));
  }, [viewingArtifactId]);

  if (!viewingArtifactId) return null;

  async function resolve(status: 'approved' | 'rejected' | 'revised', fb?: string) {
    if (!pendingCheckpoint || !activeWorkflow) return;
    setResolveLoading(true);
    setError(null);
    try {
      const result = await api.resolveCheckpoint(pendingCheckpoint.id, status, fb);
      applyWorkflowStatus(result.workflow);

      const statusLabel = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'sent for revision';
      addCoordinatorMessage({
        role: 'coordinator',
        content: `Checkpoint **${STAGE_LABELS[pendingCheckpoint.stage] ?? pendingCheckpoint.stage}** ${statusLabel}.${
          result.complete ? ' Workflow complete.' : ''
        }`,
        timestamp: Date.now(),
      });

      setFeedback('');
      setShowReviseForm(false);
      setShowRejectConfirm(false);
      setViewingArtifactId(null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to resolve');
    } finally {
      setResolveLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/50"
        onClick={() => setViewingArtifactId(null)}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {STAGE_LABELS[artifactType] ?? (artifactType || 'Artifact')}
            </h2>
            {pendingCheckpoint && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Awaiting your review
              </p>
            )}
          </div>
          <button
            onClick={() => setViewingArtifactId(null)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
          ) : content ? (() => {
            // Try to render backlog as structured view
            if (artifactType === 'backlog') {
              const backlogData = tryParseBacklog(content);
              if (backlogData) return <BacklogView data={backlogData} />;
            }
            // Default: markdown
            return (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            );
          })() : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No content available.</p>
          )}
        </div>

        {/* Action buttons (only for pending checkpoints) */}
        {pendingCheckpoint && (
          <div className="px-4 pb-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 space-y-2">
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            {showReviseForm ? (
              <div className="space-y-2">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What needs to change? Be specific."
                  rows={3}
                  className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => resolve('revised', feedback)}
                    disabled={!feedback.trim() || resolveLoading}
                    className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {resolveLoading ? 'Sending...' : 'Send Revision'}
                  </button>
                  <button
                    onClick={() => { setShowReviseForm(false); setFeedback(''); }}
                    disabled={resolveLoading}
                    className="py-2 px-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : showRejectConfirm ? (
              <div className="space-y-2">
                <p className="text-xs text-red-600">Rejecting will end the workflow. Are you sure?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => resolve('rejected')}
                    disabled={resolveLoading}
                    className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {resolveLoading ? 'Rejecting...' : 'Yes, Reject'}
                  </button>
                  <button
                    onClick={() => setShowRejectConfirm(false)}
                    className="py-2 px-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => resolve('approved')}
                  disabled={resolveLoading}
                  className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => setShowReviseForm(true)}
                  disabled={resolveLoading}
                  className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Revise
                </button>
                <button
                  onClick={() => setShowRejectConfirm(true)}
                  disabled={resolveLoading}
                  className="flex-1 py-2 px-3 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 text-red-700 dark:text-red-400 text-sm font-medium rounded-lg transition-colors"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
