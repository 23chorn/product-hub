import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkflowStore } from '../stores/workflowStore';
import { useConfigStore } from '../stores/configStore';
import { api } from '../services/api';
import { CriticQuestionForm, CriticIssuesPanel } from './CriticQuestionForm';

const STAGE_LABELS: Record<string, string> = {
  analyst:            'Analyst — Sage',
  pm_prd:             'Product Requirements — Rex',
  solution_architect: 'Architect — Atlas',
  pm_backlog:         'Backlog — Pip',
  critic:             'Critic — Flint',
  curator:            'Curator — Ivy',
};

// ── Backlog JSON types ──────────────────────────────────────────────────────

interface BacklogStory {
  title: string;
  persona?: string;
  goal?: string;
  benefit?: string;
  acceptanceCriteria?: string[];
  agentContext?: string;
  effort?: number;
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
    totalEffort?: number;
    sprintsRequired?: number;
    effectiveVelocity?: number;
    stories?: BacklogStory[];
  };
  features?: BacklogFeature[];
}

function tryParseBacklog(content: string): BacklogData | null {
  try {
    // Strip code fences if present
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    // Accept either features array or stories directly on epic
    if (parsed?.epic && (Array.isArray(parsed?.features) || Array.isArray(parsed?.epic?.stories))) return parsed as BacklogData;
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

  // Normalise: stories can be in features[].stories or directly in epic.stories
  const features = data.features ?? [];
  const flatStories = data.epic.stories ?? [];
  const hasFeatures = features.length > 0;

  const totalStories = hasFeatures
    ? features.reduce((sum, f) => sum + f.stories.length, 0)
    : flatStories.length;
  const totalEffort = hasFeatures
    ? features.reduce((sum, f) => sum + f.stories.reduce((s, st) => s + (st.effort ?? 0), 0), 0)
    : flatStories.reduce((s, st) => s + (st.effort ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Epic header */}
      <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Epic</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {hasFeatures && <>{features.length} feature{features.length !== 1 ? 's' : ''} · </>}{totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
            {totalEffort > 0 && <> · {totalEffort} pts</>}
            {data.epic.sprintsRequired != null && (
              <> · {data.epic.sprintsRequired} sprints</>
            )}
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

      {/* Stories renderer — shared between feature-wrapped and flat modes */}
      {(() => {
        const renderStory = (story: BacklogStory, si: number, prefix: string) => {
          const key = `${prefix}-${si}`;
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
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">S{prefix}.{si + 1}</span>
                    <span className="text-sm text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {story.title}
                    </span>
                    {story.effort != null && (
                      <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {story.effort}
                      </span>
                    )}
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
                            <span>{ac.split(/\b(Given|When|Then|And|But)\b/gi).map((part, pi) =>
                              /^(Given|When|Then|And|But)$/i.test(part)
                                ? <span key={pi}>{pi > 1 && <br />}<strong>{part}</strong></span>
                                : <span key={pi}>{part}</span>
                            )}</span>
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
        };

        if (hasFeatures) {
          return features.map((feature, fi) => {
            const featureEffort = feature.stories.reduce((s, st) => s + (st.effort ?? 0), 0);
            return (
              <div key={fi} className="rounded-lg border border-gray-200 dark:border-gray-700">
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
                    {featureEffort > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {featureEffort} pts
                        {data.epic.effectiveVelocity && data.epic.effectiveVelocity > 0 && (
                          <> · {Math.round((featureEffort / data.epic.effectiveVelocity) * 10) / 10} sprints</>
                        )}
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{feature.title}</h4>
                  {feature.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{feature.description}</p>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {feature.stories.map((story, si) => renderStory(story, si, `${fi + 1}`))}
                </div>
              </div>
            );
          });
        }

        // Flat stories — no feature wrapper
        return (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {flatStories.map((story, si) => renderStory(story, si, '1'))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** Extract personas from backlog data for the sidebar panel */
function extractPersonas(data: BacklogData) {
  const map = new Map<string, { count: number; stories: { feature: string; title: string; goal?: string; benefit?: string }[] }>();
  const addStory = (s: BacklogStory, featureTitle: string) => {
    if (s.persona) {
      const entry = map.get(s.persona) ?? { count: 0, stories: [] };
      entry.count++;
      entry.stories.push({ feature: featureTitle, title: s.title, goal: s.goal, benefit: s.benefit });
      map.set(s.persona, entry);
    }
  };
  if (data.features) {
    for (const f of data.features) {
      for (const s of f.stories) addStory(s, f.title);
    }
  }
  if (data.epic.stories) {
    for (const s of data.epic.stories) addStory(s, data.epic.title);
  }
  return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
}

function PersonaPanel({ personas }: { personas: ReturnType<typeof extractPersonas> }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-400 mb-2">
        Personas ({personas.length})
      </p>
      <div className="space-y-1">
        {personas.map(([name, info]) => (
          <div key={name}>
            <button
              onClick={() => setExpanded(expanded === name ? null : name)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <svg
                  className={`w-3 h-3 flex-shrink-0 text-purple-400 transition-transform ${expanded === name ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-xs text-gray-700 dark:text-gray-300 text-left">{name}</span>
              </div>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex-shrink-0">
                {info.count}
              </span>
            </button>
            {expanded === name && (
              <div className="ml-5 mt-1 mb-2 space-y-1.5">
                {info.stories.map((s, i) => (
                  <div key={i} className="text-xs border-l-2 border-purple-200 dark:border-purple-700 pl-2">
                    <p className="font-medium text-gray-700 dark:text-gray-300">{s.title}</p>
                    <p className="text-gray-400 dark:text-gray-500">{s.feature}</p>
                    {s.goal && <p className="text-gray-500 dark:text-gray-400 italic mt-0.5">I want {s.goal}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArtifactViewer() {
  const { viewingArtifactId, setViewingArtifactId, checkpoints, activeWorkflow, applyWorkflowStatus, addCoordinatorMessage } = useWorkflowStore();
  const { config } = useConfigStore();
  const [content, setContent] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<{ epicUrl: string; featureCount: number; storyCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Find the pending checkpoint that has this artifact
  const pendingCheckpoint = checkpoints.find(
    c => c.status === 'pending' && c.artifact_id === viewingArtifactId
  );

  useEffect(() => {
    if (!viewingArtifactId) { setContent(null); setError(null); return; }

    let stale = false;
    setLoading(true);
    setError(null);

    api.getArtifactContent(viewingArtifactId)
      .then(({ content: c, type: t }) => {
        if (!stale) { setContent(c); setArtifactType(t); }
      })
      .catch((err) => {
        if (!stale) {
          setContent(null);
          const detail = err?.response?.data?.error ?? err?.message ?? '';
          setError(`Failed to load artifact${detail ? ': ' + detail : ''}`);
        }
      })
      .finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
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

  const workItemsEnabled = config?.integrations?.workItems && config.integrations.workItems !== 'none';
  const isBacklog = artifactType === 'backlog';
  // Show push button only when workflow is complete and backlog was approved
  const backlogApproved = isBacklog && checkpoints.some(c => c.stage === 'pm_backlog' && c.status === 'approved');
  const workflowComplete = activeWorkflow?.status === 'complete';
  const showPushButton = isBacklog && workItemsEnabled && backlogApproved && workflowComplete;

  async function pushToBoard() {
    if (!activeWorkflow) return;
    setPushLoading(true);
    setError(null);
    try {
      const result = await api.pushToBoard(activeWorkflow.id);
      setPushResult(result);
      addCoordinatorMessage({
        role: 'coordinator',
        content: `Backlog pushed to board: **Epic #${result.epicId}** with ${result.featureCount} features and ${result.storyCount} stories. [View in Azure DevOps](${result.epicUrl})`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to push to board');
    } finally {
      setPushLoading(false);
    }
  }

  // Parse critic data once for layout decisions
  const criticData = (() => {
    try {
      return pendingCheckpoint?.coordinator_action
        ? JSON.parse(pendingCheckpoint.coordinator_action)?.critic ?? null
        : null;
    } catch { return null; }
  })();
  const showSidePanel = showReviseForm && criticData?.questions?.length > 0;
  const hasIssues = (criticData?.issues?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/50"
        onClick={() => { setViewingArtifactId(null); setIsFullscreen(false); }}
      />

      {/* Side-by-side container — expands as panels are opened */}
      <div className={`relative flex h-full overflow-hidden transition-all duration-200 ${
        isFullscreen ? 'w-full'
          : showSidePanel && showIssuesPanel ? 'w-full max-w-[90rem]'
          : showSidePanel ? 'w-full max-w-[72rem]'
          : 'w-full max-w-2xl'
      }`}>
        {/* Issues panel — far left, toggled from review header */}
        {showSidePanel && showIssuesPanel && hasIssues && (
          <div className="w-[340px] flex-shrink-0 bg-white dark:bg-gray-800 shadow-xl flex flex-col border-r border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Issues Flagged
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {criticData.issues.length} issue{criticData.issues.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setShowIssuesPanel(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              <CriticIssuesPanel issues={criticData.issues} />
            </div>
          </div>
        )}

        {/* Review panel — questions, left of artifact */}
        {showSidePanel && (
          <div className="w-[520px] flex-shrink-0 bg-gray-50 dark:bg-gray-900 shadow-xl flex flex-col border-r border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Flint's Review
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {criticData.questions.length} question{criticData.questions.length !== 1 ? 's' : ''} to answer
                </p>
              </div>
              {hasIssues && !showIssuesPanel && (
                <button
                  onClick={() => setShowIssuesPanel(true)}
                  className="text-xs px-2.5 py-1 rounded-md border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                >
                  View {criticData.issues.length} issue{criticData.issues.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 px-4 py-3 flex flex-col">
              <CriticQuestionForm
                questions={criticData.questions}
                onSubmit={(fb) => resolve('revised', fb)}
                onCancel={() => { setShowReviseForm(false); setShowIssuesPanel(false); setFeedback(''); }}
                loading={resolveLoading}
              />
            </div>
          </div>
        )}

        {/* Artifact drawer — right side (or only panel) */}
        <div className="flex-1 bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden">
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
            <div className="flex items-center gap-2">
              {showPushButton && !pushResult && (
                <button
                  onClick={pushToBoard}
                  disabled={pushLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white transition-colors"
                >
                  {pushLoading ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Pushing...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Push to Board
                    </>
                  )}
                </button>
              )}
              {pushResult && (
                <a
                  href={pushResult.epicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  View in Board ({pushResult.featureCount}F / {pushResult.storyCount}S)
                </a>
              )}
              <button
                onClick={() => setIsFullscreen(f => !f)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4M9 15l-5 5m0 0v-4m0 4h4m6-6l5-5m0 0v4m0-4h-4" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => { setViewingArtifactId(null); setIsFullscreen(false); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          {(() => {
            const backlogData = content && artifactType === 'backlog' ? tryParseBacklog(content) : null;
            const showPersonaPanel = isFullscreen && backlogData && extractPersonas(backlogData).length > 0;

            return (
              <div className={`flex-1 min-h-0 flex ${showPersonaPanel ? '' : 'flex-col'}`}>
                <div className={`flex-1 overflow-y-auto px-4 py-4 ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
                  {loading ? (
                    <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
                  ) : content ? (() => {
                    if (backlogData) return <BacklogView data={backlogData} />;
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
                {showPersonaPanel && (
                  <div className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-200 dark:border-gray-700 p-3">
                    <PersonaPanel personas={extractPersonas(backlogData)} />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Action buttons (only for pending checkpoints) */}
          {pendingCheckpoint && (
            <div className={`px-4 pb-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 space-y-2 ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

              {showReviseForm && !showSidePanel ? (
                /* Plain textarea fallback for checkpoints without critic questions */
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
              ) : !showSidePanel ? (
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
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Reject confirmation modal */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRejectConfirm(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">End this workflow?</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              Rejecting will permanently end this workflow. All completed stages are preserved, but no further stages will run. You can start a new workflow with a fresh goal afterward.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectConfirm(false)}
                disabled={resolveLoading}
                className="flex-1 py-2 px-3 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => resolve('rejected')}
                disabled={resolveLoading}
                className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {resolveLoading ? 'Rejecting...' : 'Yes, Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
