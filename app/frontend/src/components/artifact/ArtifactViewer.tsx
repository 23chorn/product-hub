import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useConfigStore } from '../../stores/configStore';
import { api } from '../../services/api';
import { CriticQuestionForm, CriticIssuesPanel } from './CriticQuestionForm';
import { STAGE_LABELS } from '../../constants/stage-labels';
import { tryParseBacklog } from '../../utils/backlog-helpers';
import { BacklogView } from './BacklogView';
import { extractPersonas, PersonaPanel } from './PersonaPanel';

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
  const [pushResult, setPushResult] = useState<{ epicUrl: string; featureCount?: number; storyCount?: number; created?: number; updated?: number; synced?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCriticFlyout, setShowCriticFlyout] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ change_request_id: number; version: number } | null>(null);
  const [hasAdoMappings, setHasAdoMappings] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Find the pending checkpoint that has this artifact
  const pendingCheckpoint = checkpoints.find(
    c => c.status === 'pending' && c.artifact_id === viewingArtifactId
  );

  useEffect(() => {
    if (!viewingArtifactId) { setContent(null); setError(null); setVersionInfo(null); return; }

    let stale = false;
    setLoading(true);
    setError(null);
    setVersionInfo(null);

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

    // Fetch CR version info (non-blocking — badge is decorative)
    api.getArtifactVersionInfo(viewingArtifactId)
      .then((info) => { if (!stale) setVersionInfo(info); })
      .catch(() => {});

    // Check ADO mappings for sync button label
    if (activeWorkflow) {
      api.getAdoMappings(activeWorkflow.id)
        .then(({ hasMappings }) => { if (!stale) setHasAdoMappings(hasMappings); })
        .catch(() => {});
    }

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
      const msg = result.synced
        ? `Backlog synced to board: **${result.updated ?? 0} updated**, **${result.created ?? 0} created**. [View in Azure DevOps](${result.epicUrl})`
        : `Backlog pushed to board: **Epic #${result.epicId}** with ${result.featureCount} features and ${result.storyCount} stories. [View in Azure DevOps](${result.epicUrl})`;
      addCoordinatorMessage({
        role: 'coordinator',
        content: msg,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to push to board');
    } finally {
      setPushLoading(false);
    }
  }

  const isDirty = isEditing && editContent !== content;

  const handleSave = useCallback(async (andApprove: boolean) => {
    if (!viewingArtifactId || !isDirty) return;
    setIsSaving(true);
    setError(null);
    try {
      const cpId = andApprove && pendingCheckpoint ? pendingCheckpoint.id : undefined;
      const result = await api.saveArtifactContent(viewingArtifactId, editContent, cpId);

      setContent(editContent);
      setIsEditing(false);

      if (result.workflowStatus && activeWorkflow) {
        applyWorkflowStatus(result.workflowStatus);
        addCoordinatorMessage({
          role: 'coordinator',
          content: `Artifact edited and approved. Advancing to next stage.`,
          timestamp: Date.now(),
        });
        setViewingArtifactId(null);
      } else {
        setSaveToast('Saved');
        setTimeout(() => setSaveToast(null), 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [viewingArtifactId, isDirty, editContent, pendingCheckpoint, activeWorkflow]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !isSaving) handleSave(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditing, isDirty, isSaving, handleSave]);

  // Parse critic data from the checkpoint associated with this artifact (pending or approved)
  const artifactCheckpoint = pendingCheckpoint
    ?? checkpoints.find(c => c.artifact_id === viewingArtifactId && c.coordinator_action);
  const criticData = (() => {
    try {
      return artifactCheckpoint?.coordinator_action
        ? JSON.parse(artifactCheckpoint.coordinator_action)?.critic ?? null
        : null;
    } catch { return null; }
  })();
  const showSidePanel = showReviseForm && criticData?.questions?.length > 0;
  const hasIssues = (criticData?.issues?.length ?? 0) > 0;
  const hasQuestions = (criticData?.questions?.length ?? 0) > 0;
  const hasCriticData = hasIssues || hasQuestions;

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
          <div className="w-[340px] flex-shrink-0 bg-white dark:bg-slate-800 shadow-xl flex flex-col border-r border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Issues Flagged
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {criticData.issues.length} issue{criticData.issues.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setShowIssuesPanel(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
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
          <div className="w-[520px] flex-shrink-0 bg-slate-50 dark:bg-slate-900 shadow-xl flex flex-col border-r border-slate-200 dark:border-slate-700">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Flint's Review
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
        <div className="flex-1 bg-white dark:bg-slate-800 shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {STAGE_LABELS[artifactType] ?? (artifactType || 'Artifact')}
                </h2>
                {versionInfo && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                    v{versionInfo.version + 1} (CR #{versionInfo.change_request_id})
                  </span>
                )}
              </div>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white transition-colors"
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
                      {hasAdoMappings ? 'Sync to Board' : 'Push to Board'}
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
                  {pushResult.synced
                    ? `Synced (${pushResult.updated ?? 0} updated, ${pushResult.created ?? 0} new)`
                    : `View in Board (${pushResult.featureCount}F / ${pushResult.storyCount}S)`
                  }
                </a>
              )}
              {hasCriticData && !showSidePanel && (
                <button
                  onClick={() => setShowCriticFlyout(f => !f)}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                    showCriticFlyout
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                  title="Toggle Flint's review"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Flint's Review
                </button>
              )}
              {content && !loading && (
                <button
                  onClick={() => {
                    if (isEditing) {
                      setIsEditing(false);
                      setEditContent('');
                    } else {
                      // Pretty-print JSON for backlog/prototype so it's readable
                      let formatted = content;
                      if (artifactType === 'backlog' || artifactType === 'prototype') {
                        try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { /* use as-is */ }
                      }
                      setEditContent(formatted);
                      setIsEditing(true);
                    }
                  }}
                  className={`p-1 rounded transition-colors ${
                    isEditing
                      ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                  title={isEditing ? 'Exit edit mode' : 'Edit artifact'}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setIsFullscreen(f => !f)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
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
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
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
              <div className="flex-1 min-h-0 relative">
                {/* Content — always takes full width, centered with max-w in fullscreen */}
                <div className={`h-full ${isEditing ? 'flex flex-col px-4 py-4' : 'overflow-y-auto px-4 py-4'}`}>
                  <div className={`${isEditing ? 'flex-1 min-h-0 flex flex-col' : ''} ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
                    {loading ? (
                      <p className="text-sm text-slate-400 animate-pulse">Loading...</p>
                    ) : isEditing ? (
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full flex-1 min-h-0 text-sm font-mono resize-none bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        spellCheck={false}
                      />
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
                      <p className="text-sm text-slate-400 italic">No content available.</p>
                    )}
                  </div>
                </div>
                {/* Critic flyout — positioned absolutely on the left */}
                {showCriticFlyout && hasCriticData && !showSidePanel && (
                  <div className="absolute top-0 left-0 w-[380px] h-full overflow-y-auto border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg flex flex-col z-10">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Flint's Review</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {hasIssues && <>{criticData.issues.length} issue{criticData.issues.length !== 1 ? 's' : ''}</>}
                          {hasIssues && hasQuestions && ' · '}
                          {hasQuestions && <>{criticData.questions.length} question{criticData.questions.length !== 1 ? 's' : ''}</>}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowCriticFlyout(false)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                      {hasIssues && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Issues</p>
                          <CriticIssuesPanel issues={criticData.issues} />
                        </div>
                      )}
                      {hasQuestions && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Questions</p>
                          <div className="space-y-2">
                            {criticData.questions.map((q: string, i: number) => (
                              <div key={i} className="text-sm rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                <span className="text-xs font-medium text-slate-400 dark:text-slate-500 mr-1">Q{i + 1}:</span>
                                <div className="mt-1 text-slate-800 dark:text-slate-200 prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{q}</ReactMarkdown>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Persona panel — positioned absolutely so it doesn't affect content centering */}
                {showPersonaPanel && (
                  <div className="absolute top-0 right-0 w-80 h-full overflow-y-auto border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                    <PersonaPanel personas={extractPersonas(backlogData)} />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Save bar (editing mode) */}
          {isEditing && (
            <div className={`px-4 pb-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 space-y-2 ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              {saveToast && <p className="text-xs text-green-600 dark:text-green-400">{saveToast}</p>}
              <div className="flex gap-2">
                {pendingCheckpoint ? (
                  <button
                    onClick={() => handleSave(true)}
                    disabled={!isDirty || isSaving}
                    className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {isSaving ? 'Saving...' : 'Save & Approve'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSave(false)}
                    disabled={!isDirty || isSaving}
                    className="flex-1 py-2 px-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                )}
                <button
                  onClick={() => { setIsEditing(false); setEditContent(''); setError(null); }}
                  disabled={isSaving}
                  className="py-2 px-3 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action buttons (only for pending checkpoints, hidden while editing) */}
          {pendingCheckpoint && !isEditing && (
            <div className={`px-4 pb-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 space-y-2 ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

              {showReviseForm && !showSidePanel ? (
                /* Plain textarea fallback for checkpoints without critic questions */
                <div className="space-y-2">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What needs to change? Be specific."
                    rows={3}
                    className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolve('revised', feedback)}
                      disabled={!feedback.trim() || resolveLoading}
                      className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {resolveLoading ? 'Sending...' : 'Send Revision'}
                    </button>
                    <button
                      onClick={() => { setShowReviseForm(false); setFeedback(''); }}
                      disabled={resolveLoading}
                      className="py-2 px-3 text-sm text-slate-500 hover:text-slate-700 transition-colors"
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
                    className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setShowReviseForm(true)}
                    disabled={resolveLoading}
                    className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
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
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">End this workflow?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
              Rejecting will permanently end this workflow. All completed stages are preserved, but no further stages will run. You can start a new workflow with a fresh goal afterward.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectConfirm(false)}
                disabled={resolveLoading}
                className="flex-1 py-2 px-3 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => resolve('rejected')}
                disabled={resolveLoading}
                className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-lg transition-colors"
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
