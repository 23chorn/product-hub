import { useState, useEffect, useCallback } from 'react';
import { MarkdownContent } from '../common/MarkdownContent';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useConfigStore } from '../../stores/configStore';
import { useAuthStore, canApprove, parseRequiredRoles, ROLE_LABELS } from '../../stores/authStore';
import { api } from '../../services/api';
import { CriticQuestionForm, CriticIssuesPanel } from './CriticQuestionForm';
import { OpenQuestionsPanel } from './OpenQuestionsPanel';
import { ARTIFACT_TYPE_LABELS, STAGE_LABELS } from '../../constants/stage-labels';
import { tryParseBacklog, isBacklogArtifactType } from '@pap/shared';
import { extractPersonas, PersonaPanel } from './PersonaPanel';
import { parseOpenQuestions, type OpenQuestion } from '../../utils/artifact-to-markdown';
import { ArtifactSyncActions } from './ArtifactSyncActions';
import { CriticReviewFlyout } from './CriticReviewFlyout';
import { ApproveConfirmModal } from './ApproveConfirmModal';
import { RejectConfirmModal } from './RejectConfirmModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { useCheckpointActions } from '../../hooks/useCheckpointActions';
import { renderStructuredArtifact } from './ArtifactContentView';
import { FigmaDesignActions, FigmaScreenPreviewer } from './FigmaDesignActions';
import { parseFigmaDesignContent } from '../../utils/figma-design';
import { copyToClipboard } from '../../utils/markdown';

export function ArtifactViewer() {
  const { viewingArtifactId, setViewingArtifactId, checkpoints, activeWorkflow, applyWorkflowStatus, addCoordinatorMessage } = useWorkflowStore();
  const { config } = useConfigStore();
  const [content, setContent] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCriticFlyout, setShowCriticFlyout] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ change_request_id: number; version: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [showOpenQPanel, setShowOpenQPanel] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ itemLabel: string; run: () => string } | null>(null);
  const [showRevisionSummary, setShowRevisionSummary] = useState(false);
  const [figmaLinks, setFigmaLinks] = useState<Record<string, string>>({});
  const setFigmaLink = (key: string, value: string) => setFigmaLinks(prev => ({ ...prev, [key]: value }));

  const { user, noAuth } = useAuthStore();

  // Find the pending checkpoint that has this artifact
  const pendingCheckpoint = checkpoints.find(
    c => c.status === 'pending' && c.artifact_id === viewingArtifactId
  );

  const hasApprovePermission = canApprove(user, noAuth, parseRequiredRoles(pendingCheckpoint?.required_role));

  const { resolveLoading, figmaComplete, rerunStage, resolve } = useCheckpointActions({
    pendingCheckpoint,
    activeWorkflow,
    setError,
    onResolved: () => {
      setFeedback('');
      setShowReviseForm(false);
      setShowApproveConfirm(false);
      setShowRejectConfirm(false);
    },
  });

  useEffect(() => {
    setShowRevisionSummary(false);
    if (!viewingArtifactId) { setContent(null); setError(null); setVersionInfo(null); return; }

    let stale = false;
    setLoading(true);
    setError(null);
    setVersionInfo(null);
    setFigmaLinks({});

    api.getArtifactContent(viewingArtifactId)
      .then(({ content: c, type: t }) => {
        if (!stale) {
          console.log(`[ArtifactViewer] Loaded artifact ${viewingArtifactId}, type="${t}", content length=${c.length}`);
          setContent(c);
          setArtifactType(t);
          if (t === 'figma_design') {
            const parsed = parseFigmaDesignContent(c);
            setFigmaLinks(Object.fromEntries(parsed.screens.map(s => [s.name, s.frame_url ?? ''])));
          }
        }
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

  const workItemsEnabled = !!(config?.integrations?.workItems && config.integrations.workItems !== 'none');
  const isBacklog = isBacklogArtifactType(artifactType) || artifactType === 'epic_features';
  // Show push button only when workflow is complete and backlog was approved
  const backlogApproved = isBacklog && checkpoints.some(c => c.stage === 'story_decomposition' && c.status === 'approved');
  const workflowComplete = activeWorkflow?.status === 'complete';
  const showPushButton = isBacklog && workItemsEnabled && backlogApproved && workflowComplete;

  // Wiki sync button for research, PRD, and architecture documents
  const isWikiDocument = ['analyst', 'research', 'prd', 'architecture'].includes(artifactType);
  const showWikiSyncButton = isWikiDocument && workItemsEnabled && workflowComplete;

  const isFigmaDesign = pendingCheckpoint?.stage === 'figma_design';
  const figmaDesign = isFigmaDesign ? parseFigmaDesignContent(content) : null;

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

  // Opens the delete confirmation for one item; computeNewContent is deferred until the
  // user confirms, so nothing is mutated just by clicking the trash icon.
  const requestDelete = useCallback((itemLabel: string, computeNewContent: () => string) => {
    setPendingDelete({ itemLabel, run: computeNewContent });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete || !viewingArtifactId) return;
    setIsSaving(true);
    setError(null);
    try {
      const newContent = pendingDelete.run();
      // No checkpointId — saves without approving/advancing, same as a plain "Save".
      await api.saveArtifactContent(viewingArtifactId, newContent);
      setContent(newContent);
      setPendingDelete(null);
      setSaveToast('Deleted');
      setTimeout(() => setSaveToast(null), 2000);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to delete');
    } finally {
      setIsSaving(false);
    }
  }, [pendingDelete, viewingArtifactId]);

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

  // Parse critic data — try the directly associated checkpoint first, then fall back to the
  // most recent sibling checkpoint for the same stage (covers error-recovery checkpoints that
  // have no critic field because the revision attempt failed mid-run).
  const artifactCheckpoint = pendingCheckpoint
    ?? checkpoints.find(c => c.artifact_id === viewingArtifactId && c.coordinator_action);
  const criticData = (() => {
    try {
      if (artifactCheckpoint?.coordinator_action) {
        const c = JSON.parse(artifactCheckpoint.coordinator_action)?.critic;
        if (c) return c;
      }
      if (pendingCheckpoint) {
        const sibling = [...checkpoints]
          .sort((a, b) => b.created_at - a.created_at)
          .find(c => c.id !== pendingCheckpoint.id && c.stage === pendingCheckpoint.stage && c.coordinator_action);
        if (sibling?.coordinator_action) {
          const c = JSON.parse(sibling.coordinator_action)?.critic;
          if (c) return c;
        }
      }
      return null;
    } catch { return null; }
  })();
  // AI-written summary of what the latest revision changed — surfaced above the document
  // so a reviewer can confirm their requested changes were addressed before approving.
  const revisionSummary: string | null = (() => {
    try {
      if (artifactCheckpoint?.coordinator_action) {
        const s = JSON.parse(artifactCheckpoint.coordinator_action)?.revision_summary;
        if (typeof s === 'string' && s.trim()) return s.trim();
      }
    } catch { /* ignore */ }
    return null;
  })();

  const showCriticPanel = showReviseForm && (criticData?.questions?.length ?? 0) > 0;
  const showSidePanel = showCriticPanel || showOpenQPanel;
  const hasIssues = (criticData?.issues?.length ?? 0) > 0;
  const hasQuestions = (criticData?.questions?.length ?? 0) > 0;
  const hasCriticData = hasIssues || hasQuestions;

  // Parse open (unresolved) questions from the PRD artifact content
  const openQuestions: OpenQuestion[] = (artifactType === 'prd' && content && pendingCheckpoint)
    ? parseOpenQuestions(content)
    : [];
  const hasOpenQuestions = openQuestions.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/50"
        onClick={() => setViewingArtifactId(null)}
      />

      {/* Side-by-side container — expands as panels are opened */}
      <div className={`relative flex h-full overflow-hidden transition-all duration-200 ${
        showSidePanel && showIssuesPanel ? 'w-full max-w-[90rem]'
          : showSidePanel ? 'w-full max-w-[72rem]'
          : 'w-full max-w-4xl'
      }`}>
        {/* Issues panel — far left, toggled from review header */}
        {showCriticPanel && showIssuesPanel && hasIssues && (
          <div className="w-[340px] flex-shrink-0 bg-white dark:bg-surface-800 shadow-xl flex flex-col border-r border-surface-200 dark:border-surface-700">
            <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  Issues Flagged
                </h2>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                  {criticData.issues.length} issue{criticData.issues.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setShowIssuesPanel(false)}
                className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
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

        {/* Critic review panel — questions, left of artifact */}
        {showCriticPanel && (
          <div className="w-[520px] flex-shrink-0 bg-surface-50 dark:bg-surface-900 shadow-xl flex flex-col border-r border-surface-200 dark:border-surface-700">
            <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  Flint's Review
                </h2>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
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

        {/* Open questions panel — left of artifact, shown when answering PRD open questions */}
        {showOpenQPanel && (
          <div className="w-[520px] flex-shrink-0 bg-surface-50 dark:bg-surface-900 shadow-xl flex flex-col border-r border-surface-200 dark:border-surface-700">
            <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Open Questions</h2>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                {openQuestions.length} question{openQuestions.length !== 1 ? 's' : ''} to resolve
              </p>
            </div>
            <div className="flex-1 min-h-0 px-4 py-3 flex flex-col">
              <OpenQuestionsPanel
                questions={openQuestions}
                onSubmit={(fb) => { setShowOpenQPanel(false); resolve('revised', fb); }}
                onCancel={() => setShowOpenQPanel(false)}
                loading={resolveLoading}
              />
            </div>
          </div>
        )}

        {/* Artifact drawer — right side (or only panel) */}
        <div className="flex-1 bg-white dark:bg-surface-800 shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between flex-shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  {ARTIFACT_TYPE_LABELS[artifactType] ?? STAGE_LABELS[artifactType] ?? (artifactType || 'Artifact')}
                </h2>
                {versionInfo && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400">
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
              {activeWorkflow && (
                <button
                  onClick={() => {
                    const url = `${window.location.origin}${window.location.pathname}?workflowId=${activeWorkflow.id}&artifactId=${viewingArtifactId}`;
                    copyToClipboard(url);
                    setSaveToast('Link copied!');
                    setTimeout(() => setSaveToast(null), 2000);
                  }}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                    saveToast === 'Link copied!'
                      ? 'border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                      : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600 hover:text-surface-700 dark:hover:text-surface-200'
                  }`}
                  title="Copy shareable link"
                >
                  {saveToast === 'Link copied!' ? (
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
              <ArtifactSyncActions
                artifactType={artifactType}
                activeWorkflow={activeWorkflow}
                showPushButton={showPushButton}
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
                      : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600'
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
                      if (isBacklogArtifactType(artifactType) || artifactType === 'epic_features' || artifactType === 'prototype') {
                        try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { /* use as-is */ }
                      }
                      setEditContent(formatted);
                      setIsEditing(true);
                    }
                  }}
                  className={`p-1 rounded transition-colors ${
                    isEditing
                      ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20'
                      : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700'
                  }`}
                  title={isEditing ? 'Exit edit mode' : 'Edit artifact'}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setViewingArtifactId(null)}
                className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          {(() => {
            // backlogData is also computed inside renderStructuredArtifact; kept here only
            // to drive the absolutely-positioned persona panel shown beside the artifact.
            const backlogData = content && isBacklogArtifactType(artifactType) ? tryParseBacklog(content) : null;
            const showPersonaPanel = backlogData && extractPersonas(backlogData).length > 0;

            return (
              <div className="flex-1 min-h-0 relative">
                {/* Content — always takes full width, centered with max-w in fullscreen */}
                <div className={`h-full ${isEditing ? 'flex flex-col px-4 py-4' : isFigmaDesign && figmaDesign && !loading && !error ? 'overflow-hidden flex flex-col' : 'overflow-y-auto px-4 py-4'}`}>
                  <div className={`${isEditing || (isFigmaDesign && figmaDesign && !loading && !error) ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
                    {revisionSummary && !isEditing && (
                      <div className="mb-4 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20 px-3.5 py-3">
                        <button
                          onClick={() => setShowRevisionSummary(v => !v)}
                          className="w-full flex items-center gap-1.5 mb-1.5"
                        >
                          <svg className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                            AI revision summary
                          </h3>
                          <svg
                            className={`w-3.5 h-3.5 text-brand-400 flex-shrink-0 ml-auto transition-transform ${showRevisionSummary ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showRevisionSummary && (
                          <MarkdownContent className="[&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">{revisionSummary}</MarkdownContent>
                        )}
                      </div>
                    )}
                    {loading ? (
                      <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
                    ) : isEditing ? (
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full flex-1 min-h-0 text-sm font-mono resize-none bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        spellCheck={false}
                      />
                    ) : isFigmaDesign && figmaDesign && content ? (
                      <FigmaScreenPreviewer
                        figmaDesign={figmaDesign}
                        links={figmaLinks}
                        onLinkChange={setFigmaLink}
                      />
                    ) : content ? renderStructuredArtifact(content, {
                      artifactType,
                      activeWorkflow,
                      checkpoints,
                      pendingCheckpoint,
                      hasApprovePermission,
                      resolveLoading,
                      rerunStage,
                      onClose: () => setViewingArtifactId(null),
                      requestDelete: (pendingCheckpoint && hasApprovePermission) ? requestDelete : undefined,
                    }) : error ? (
                      <p className="text-sm text-red-500">{error}</p>
                    ) : pendingCheckpoint ? (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <div className="flex-1 space-y-2">
                          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                            No content was produced for this stage — it likely hit an error or ran out of output budget. Retry to regenerate it from scratch.
                          </p>
                          {hasApprovePermission && (
                            <button
                              onClick={rerunStage}
                              disabled={resolveLoading}
                              className="py-1.5 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 text-white text-xs font-medium rounded-md transition-colors"
                            >
                              {resolveLoading ? 'Retrying...' : 'Retry Stage'}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-surface-400 italic">No content available.</p>
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
                  <div className="absolute top-0 right-0 w-80 h-full overflow-y-auto border-l border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3">
                    <PersonaPanel personas={extractPersonas(backlogData)} />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Save bar (editing mode) */}
          {isEditing && (
            <div className={`px-4 pb-4 pt-3 border-t border-surface-200 dark:border-surface-700 flex-shrink-0 space-y-2`}>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              {saveToast && <p className="text-xs text-green-600 dark:text-green-400">{saveToast}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave(false)}
                  disabled={!isDirty || isSaving}
                  className="flex-1 py-2 px-3 bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                {pendingCheckpoint && (
                  <button
                    onClick={() => handleSave(true)}
                    disabled={!isDirty || isSaving}
                    className="py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Save & Approve
                  </button>
                )}
                <button
                  onClick={() => { setIsEditing(false); setEditContent(''); setError(null); }}
                  disabled={isSaving}
                  className="py-2 px-3 text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Approved-by note (shown when this artifact's checkpoint is already approved) */}
          {approvedCheckpoint && !isEditing && (
            <div className={`px-4 pb-3 pt-3 border-t border-surface-200 dark:border-surface-700 flex-shrink-0 flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400`}>
              <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>
                Approved
                {approvedCheckpoint.resolved_by_name && (
                  <> by <strong className="text-surface-700 dark:text-surface-300">{approvedCheckpoint.resolved_by_name}</strong></>
                )}
                {approvedCheckpoint.resolved_at && (
                  <> · {new Date(approvedCheckpoint.resolved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                )}
              </span>
            </div>
          )}

          {/* Action buttons (only for pending checkpoints, hidden while editing) */}
          {pendingCheckpoint && !isEditing && (
            <div className={`px-4 pb-4 pt-3 border-t border-surface-200 dark:border-surface-700 flex-shrink-0 space-y-2`}>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

              {/* Permission lock — shown when user lacks the required role */}
              {!hasApprovePermission && (
                <div className="flex items-center gap-2 py-2 text-xs text-surface-400 dark:text-surface-500">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>
                    Approval requires{' '}
                    <strong className="text-surface-300">
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
                    className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolve('revised', feedback)}
                      disabled={!feedback.trim() || resolveLoading}
                      className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {resolveLoading ? 'Sending...' : 'Send Revision'}
                    </button>
                    <button
                      onClick={() => { setShowReviseForm(false); setFeedback(''); }}
                      disabled={resolveLoading}
                      className="py-2 px-3 text-sm text-surface-500 hover:text-surface-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : hasApprovePermission && figmaDesign && !showSidePanel ? (
                <FigmaDesignActions
                  figmaFileUrl={figmaDesign.figmaFileUrl}
                  screens={figmaDesign.screens}
                  loading={resolveLoading}
                  externalLinks={figmaLinks}
                  onMarkComplete={({ figmaUrl, screenLinks }) => figmaComplete(figmaUrl, undefined, screenLinks)}
                  onRevise={() => setShowReviseForm(true)}
                  onReject={() => setShowRejectConfirm(true)}
                />
              ) : hasApprovePermission && !showSidePanel ? (
                <div className="space-y-2">
                  {/* Answer open questions — shown for PRD artifacts with unresolved questions */}
                  {hasOpenQuestions && (
                    <button
                      onClick={() => setShowOpenQPanel(true)}
                      disabled={resolveLoading}
                      className="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm font-medium rounded-lg transition-colors text-left flex items-center justify-between"
                    >
                      <span>Answer open questions</span>
                      <span className="text-xs font-normal opacity-70">{openQuestions.length} unresolved</span>
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowApproveConfirm(true)}
                      disabled={resolveLoading}
                      className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-surface-300 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setShowReviseForm(true)}
                      disabled={resolveLoading}
                      className="flex-1 py-2 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-surface-300 text-white text-sm font-medium rounded-lg transition-colors"
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
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Approve confirmation modal */}
      {showApproveConfirm && (
        <ApproveConfirmModal
          loading={resolveLoading}
          onCancel={() => setShowApproveConfirm(false)}
          onConfirm={() => resolve('approved')}
        />
      )}

      {/* Reject confirmation modal */}
      {showRejectConfirm && (
        <RejectConfirmModal
          loading={resolveLoading}
          onCancel={() => setShowRejectConfirm(false)}
          onConfirm={() => resolve('rejected')}
        />
      )}

      {/* Delete-item confirmation modal */}
      {pendingDelete && (
        <DeleteConfirmModal
          itemLabel={pendingDelete.itemLabel}
          loading={isSaving}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
