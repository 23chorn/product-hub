import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useConfigStore } from '../../stores/configStore';
import { useAuthStore, canApprove, parseRequiredRoles, ROLE_LABELS } from '../../stores/authStore';
import { api } from '../../services/api';
import { CriticQuestionForm, CriticIssuesPanel } from './CriticQuestionForm';
import { STAGE_LABELS } from '../../constants/stage-labels';
import { tryParseBacklog } from '../../utils/backlog-helpers';
import { BacklogView } from './BacklogView';
import { QATestsView, tryParseQATests } from './QATestsView';
import { TechRefinementView, tryParseTechRefinement } from './TechRefinementView';
import { extractPersonas, PersonaPanel } from './PersonaPanel';
import { PrototypePreview, type PrototypeData } from '../coordinator/PrototypePreview';
import { convertArtifactToMarkdown, isDocumentArtifact } from '../../utils/artifact-to-markdown';
import { ArtifactSyncActions } from './ArtifactSyncActions';
import { CriticReviewFlyout } from './CriticReviewFlyout';
import { RejectConfirmModal } from './RejectConfirmModal';

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
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCriticFlyout, setShowCriticFlyout] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ change_request_id: number; version: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const { user, noAuth } = useAuthStore();

  // Find the pending checkpoint that has this artifact
  const pendingCheckpoint = checkpoints.find(
    c => c.status === 'pending' && c.artifact_id === viewingArtifactId
  );

  const hasApprovePermission = canApprove(user, noAuth, parseRequiredRoles(pendingCheckpoint?.required_role));

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
      const actor = user?.name ?? user?.username;
      const byNote = actor ? ` by **${actor}**` : '';
      addCoordinatorMessage({
        role: 'coordinator',
        content: `Checkpoint **${STAGE_LABELS[pendingCheckpoint.stage] ?? pendingCheckpoint.stage}** ${statusLabel}${byNote}.${
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

  const workItemsEnabled = !!(config?.integrations?.workItems && config.integrations.workItems !== 'none');
  const isBacklog = artifactType === 'backlog' || artifactType === 'epic_features';
  // Show push button only when workflow is complete and backlog was approved
  const backlogApproved = isBacklog && checkpoints.some(c => c.stage === 'story_decomposition' && c.status === 'approved');
  const workflowComplete = activeWorkflow?.status === 'complete';
  const showPushButton = isBacklog && workItemsEnabled && backlogApproved && workflowComplete;

  const isQATests = artifactType === 'qa_tests';
  const qaApproved = isQATests && checkpoints.some(c => c.status === 'approved');
  const showTestPlanButton = isQATests && workItemsEnabled && qaApproved && workflowComplete;

  // Wiki sync button for research, PRD, and architecture documents
  const isWikiDocument = ['analyst', 'research', 'prd', 'architecture'].includes(artifactType);
  const showWikiSyncButton = isWikiDocument && workItemsEnabled && workflowComplete;

  const emitMessage = (content: string) =>
    addCoordinatorMessage({ role: 'coordinator', content, timestamp: Date.now() });

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

  // Find the approved checkpoint for this artifact (for the "Approved by" note)
  const approvedCheckpoint = !pendingCheckpoint
    ? checkpoints.find(c => c.artifact_id === viewingArtifactId && c.status === 'approved')
    : null;

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
              <ArtifactSyncActions
                artifactType={artifactType}
                activeWorkflow={activeWorkflow}
                showPushButton={showPushButton}
                showTestPlanButton={showTestPlanButton}
                showWikiSyncButton={showWikiSyncButton}
                onMessage={emitMessage}
                onError={setError}
              />
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
                      if (artifactType === 'backlog' || artifactType === 'epic_features' || artifactType === 'prototype') {
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
            const backlogData = content && (artifactType === 'backlog' || artifactType === 'epic_features') ? tryParseBacklog(content) : null;
            const techData = content && artifactType === 'backlog' && !backlogData ? tryParseTechRefinement(content) : null;
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
                      if (techData) return <TechRefinementView data={techData} />;
                      const qaData = artifactType === 'qa_tests' ? tryParseQATests(content) : null;
                      if (qaData) return <QATestsView data={qaData} />;
                      // JSON artifact types that failed to parse — render as code block with warning
                      if (artifactType === 'qa_tests' || artifactType === 'backlog' || artifactType === 'epic_features') {
                        return (
                          <div className="space-y-3">
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                              <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                              </svg>
                              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                                This artifact appears incomplete — the stage was likely interrupted mid-stream. Retry the stage to regenerate a complete output.
                              </p>
                            </div>
                            <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 overflow-auto whitespace-pre-wrap break-words leading-relaxed">{content}</pre>
                          </div>
                        );
                      }
                      if (artifactType === 'prototype') {
                        try {
                          const protoData: PrototypeData = JSON.parse(content);
                          if (protoData.files && activeWorkflow) {
                            return (
                              <PrototypePreview
                                prototype={protoData}
                                workflowId={activeWorkflow.id}
                                onClose={() => setViewingArtifactId(null)}
                                onUpdate={() => {}}
                              />
                            );
                          }
                        } catch { /* fall through to raw view */ }
                      }
                      // Document artifacts are stored as JSON but rendered as markdown via the converter.
                      if (isDocumentArtifact(artifactType)) {
                        const md = convertArtifactToMarkdown(artifactType, content);
                        if (md !== null) {
                          return (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
                            </div>
                          );
                        }
                      }
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
                  <CriticReviewFlyout
                    issues={criticData.issues ?? []}
                    questions={criticData.questions ?? []}
                    onClose={() => setShowCriticFlyout(false)}
                  />
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

          {/* Approved-by note (shown when this artifact's checkpoint is already approved) */}
          {approvedCheckpoint && !isEditing && (
            <div className={`px-4 pb-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
              <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>
                Approved
                {approvedCheckpoint.resolved_by_name && (
                  <> by <strong className="text-slate-700 dark:text-slate-300">{approvedCheckpoint.resolved_by_name}</strong></>
                )}
                {approvedCheckpoint.resolved_at && (
                  <> · {new Date(approvedCheckpoint.resolved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                )}
              </span>
            </div>
          )}

          {/* Action buttons (only for pending checkpoints, hidden while editing) */}
          {pendingCheckpoint && !isEditing && (
            <div className={`px-4 pb-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 space-y-2 ${isFullscreen ? 'mx-auto w-full max-w-4xl' : ''}`}>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

              {/* Permission lock — shown when user lacks the required role */}
              {!hasApprovePermission && (
                <div className="flex items-center gap-2 py-2 text-xs text-slate-400 dark:text-slate-500">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>
                    Approval requires{' '}
                    <strong className="text-slate-300">
                      {pendingCheckpoint.required_role
                        ? (ROLE_LABELS[pendingCheckpoint.required_role] ?? pendingCheckpoint.required_role)
                        : 'a specific role'}
                    </strong>
                  </span>
                </div>
              )}

              {hasApprovePermission && showReviseForm && !showSidePanel ? (
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
              ) : hasApprovePermission && !showSidePanel ? (
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
        <RejectConfirmModal
          loading={resolveLoading}
          onCancel={() => setShowRejectConfirm(false)}
          onConfirm={() => resolve('rejected')}
        />
      )}
    </div>
  );
}
