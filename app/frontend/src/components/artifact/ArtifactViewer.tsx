import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownContent } from '../common/MarkdownContent';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useConfigStore } from '../../stores/configStore';
import { useAuthStore, canApprove, parseRequiredRoles, ROLE_LABELS } from '../../stores/authStore';
import { api } from '../../services/api';
import { CriticIssuesPanel } from './CriticQuestionForm';
import { QuestionsReviewPanel } from './QuestionsReviewPanel';
import { PanelChromeHeader, Chevron } from './ArtifactPrimitives';
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
import { parseFigmaDesignContent, removeFigmaScreen } from '../../utils/figma-design';
import { copyToClipboard, printArtifact } from '../../utils/markdown';
import { buildPrdMaps } from '../../utils/artifact-to-markdown';
import { deriveEpicFeaturesArtifactId } from '../../utils/feature-artifacts';
import { tryParseEpicFeatures, toPhases } from './EpicFeaturesView';
import { SplitArtifactPane } from './SplitArtifactPane';
import { SplitViewButton } from './SplitViewButton';

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
  const [pendingDelete, setPendingDelete] = useState<{ itemLabel: string; run: () => string } | null>(null);
  const [showRevisionSummary, setShowRevisionSummary] = useState(false);
  const [figmaLinks, setFigmaLinks] = useState<Record<string, string>>({});
  const [frMap, setFrMap] = useState<Record<string, string>>({});
  const [nfrMap, setNfrMap] = useState<Record<string, string>>({});
  const [phaseByFeatureKey, setPhaseByFeatureKey] = useState<Record<string, string>>({});
  const [phaseOrder, setPhaseOrder] = useState<string[]>([]);
  const [splitArtifactId, setSplitArtifactId] = useState<number | null>(null);
  const setFigmaLink = (key: string, value: string) => setFigmaLinks(prev => ({ ...prev, [key]: value }));

  const { user, noAuth } = useAuthStore();
  const printRef = useRef<HTMLDivElement>(null);

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
    setSplitArtifactId(null);
    if (!viewingArtifactId) { setContent(null); setError(null); setVersionInfo(null); return; }

    let stale = false;
    setLoading(true);
    setError(null);
    setVersionInfo(null);
    setFigmaLinks({});
    setFrMap({});
    setNfrMap({});
    setPhaseByFeatureKey({});
    setPhaseOrder([]);

    // Load PRD artifact in parallel (non-blocking) to populate FR/NFR tooltip maps.
    const prdCheckpoint = checkpoints.find(c => c.stage === 'pm_prd' && c.artifact_id != null);
    if (prdCheckpoint?.artifact_id) {
      api.getArtifactContent(prdCheckpoint.artifact_id).then(({ content: prdContent }) => {
        if (stale) return;
        const { frMap: frs, nfrMap: nfrs } = buildPrdMaps(prdContent);
        setFrMap(frs);
        setNfrMap(nfrs);
      }).catch(() => {});
    }

    // Load epic_features artifact in parallel (non-blocking) to power the QA tests view's
    // "Phase" grouping toggle — otherwise a direct qa_tests artifact view has no way to know
    // which phase each feature's test cases belong to.
    const epicFeaturesArtifactId = deriveEpicFeaturesArtifactId(checkpoints);
    if (epicFeaturesArtifactId) {
      api.getArtifactContent(epicFeaturesArtifactId).then(({ content: epicFeaturesContent }) => {
        if (stale) return;
        const epicFeatures = tryParseEpicFeatures(epicFeaturesContent);
        if (!epicFeatures) return;
        const map: Record<string, string> = {};
        let featureIdx = 0;
        const phases = toPhases(epicFeatures);
        for (const phase of phases) {
          const count = phase.features?.length ?? 0;
          for (let i = featureIdx; i < featureIdx + count; i++) map[`F${i + 1}`] = phase.label;
          featureIdx += count;
        }
        setPhaseByFeatureKey(map);
        setPhaseOrder(phases.map(p => p.label));
      }).catch(() => {});
    }

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

  const isFigmaDesign = artifactType === 'figma_design' || pendingCheckpoint?.stage === 'figma_design';
  const figmaDesign = isFigmaDesign ? parseFigmaDesignContent(content) : null;
  const isPrintable = !!(content && !loading && !isEditing && !isFigmaDesign && !isBacklog && artifactType !== 'prototype' && artifactType !== 'qa_tests');

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

  // Delete buttons only render while actively reviewing a pending checkpoint with approve
  // permission — undefined here hides them for read-only/historical/no-permission views.
  const requestDeleteIfAllowed = (pendingCheckpoint && hasApprovePermission) ? requestDelete : undefined;

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

  const hasIssues = (criticData?.issues?.length ?? 0) > 0;
  const hasQuestions = (criticData?.questions?.length ?? 0) > 0;
  const hasCriticData = hasIssues || hasQuestions;

  // Parse open (unresolved) questions from the PRD artifact content
  const openQuestions: OpenQuestion[] = (artifactType === 'prd' && content && pendingCheckpoint)
    ? parseOpenQuestions(content)
    : [];
  const hasOpenQuestions = openQuestions.length > 0;

  // Revise opens one combined questions panel whenever there's anything to answer (Flint's
  // critic questions and/or the document's own open questions) — otherwise the plain
  // freeform textarea fallback further down.
  const showQuestionsPanel = showReviseForm && (hasQuestions || hasOpenQuestions);
  const showSidePanel = showQuestionsPanel;

  // The review flyout fills whatever backdrop space is actually free to the left of the
  // drawer (drawerMaxWidthRem must track the container's own max-w-* class below) rather
  // than a fixed width — clamped so it never shrinks below a usable size or sprawls
  // unreadably wide on ultra-wide monitors.
  const drawerMaxWidthRem = splitArtifactId ? 100 : 56;
  const reviewFlyoutWidth = `clamp(380px, calc((100vw - min(100vw, ${drawerMaxWidthRem}rem)) / 2), 40rem)`;

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/50"
        onClick={() => setViewingArtifactId(null)}
      />

      {/* Side-by-side container — widens only for the split-view companion pane (an
          intentional in-flow pane). The questions/issues review panels are flyouts anchored
          to the drawer's own left edge (see below), so they never resize the modal or sit
          over the document — they slide out into the backdrop area instead. */}
      <div className={`relative flex h-full transition-all duration-200 ${
        splitArtifactId ? 'w-full max-w-[100rem]' : 'w-full max-w-4xl'
      }`}>
        {/* Split-view companion pane — shows a second document (e.g. the PRD) beside the
            one being reviewed. Read-only; its own close button clears splitArtifactId. */}
        {splitArtifactId && (
          <SplitArtifactPane artifactId={splitArtifactId} onClose={() => setSplitArtifactId(null)} />
        )}

        {/* Artifact drawer — right side (or only panel). Its wrapper is `relative` with no
            overflow clipping so the questions flyout below can render just outside its left
            edge instead of overlapping the document content. */}
        <div className="relative flex-1 min-w-0 h-full">
          {/* Combined questions flyout — Flint's critic questions + the document's own open
              questions in one list, tagged by source (see QuestionsReviewPanel), plus the
              issues panel when toggled. Anchored via right-full so it slides out over the
              backdrop to the left of the drawer, never covering the document. */}
          {showQuestionsPanel && (
            <div className="absolute top-0 right-full h-full flex z-20">
              {showIssuesPanel && hasIssues && (
                <div className="w-[340px] h-full bg-surface-50 dark:bg-surface-800 shadow-xl flex flex-col border-r border-surface-200 dark:border-surface-700">
                  <PanelChromeHeader
                    label="issues flagged"
                    meta={`${criticData.issues.length} issue${criticData.issues.length !== 1 ? 's' : ''}`}
                    onClose={() => setShowIssuesPanel(false)}
                  />
                  <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                    <CriticIssuesPanel issues={criticData.issues} />
                  </div>
                </div>
              )}
              <div className="w-[520px] h-full bg-surface-50 dark:bg-surface-900 shadow-xl flex flex-col border-r border-surface-200 dark:border-surface-700">
                <PanelChromeHeader
                  label="questions to review"
                  meta={`${(criticData?.questions?.length ?? 0) + openQuestions.length} to answer`}
                  actions={hasIssues && !showIssuesPanel && (
                    <button
                      onClick={() => setShowIssuesPanel(true)}
                      className="font-mono text-[10px] uppercase tracking-wide px-2 py-1 rounded border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors normal-case"
                    >
                      View {criticData.issues.length} issue{criticData.issues.length !== 1 ? 's' : ''}
                    </button>
                  )}
                />
                <div className="flex-1 min-h-0 px-4 py-3 flex flex-col">
                  <QuestionsReviewPanel
                    criticQuestions={criticData?.questions ?? []}
                    openQuestions={openQuestions}
                    onSubmit={(fb) => resolve('revised', fb)}
                    onCancel={() => { setShowReviseForm(false); setShowIssuesPanel(false); setFeedback(''); }}
                    loading={resolveLoading}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Review flyout — read-only peek at Flint's issues/questions + the document's open
              questions, without entering the interactive review panel. Anchored the same way
              (right-full, outside the drawer) so it never overlays the document — true both
              while a checkpoint is pending review and afterward on an approved artifact. */}
          {showCriticFlyout && (hasCriticData || hasOpenQuestions) && !showSidePanel && (
            <div className="absolute top-0 right-full h-full z-20" style={{ width: reviewFlyoutWidth }}>
              <CriticReviewFlyout
                issues={criticData?.issues ?? []}
                questions={criticData?.questions ?? []}
                openQuestions={openQuestions}
                onClose={() => setShowCriticFlyout(false)}
              />
            </div>
          )}

        <div className="h-full bg-surface-50 dark:bg-surface-800 shadow-xl flex flex-col overflow-hidden">
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
              <SplitViewButton excludeArtifactId={viewingArtifactId} selectedId={splitArtifactId} onSelect={setSplitArtifactId} />
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
              {isPrintable && (
                <button
                  onClick={() => printRef.current && printArtifact(printRef.current, ARTIFACT_TYPE_LABELS[artifactType] ?? artifactType)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
                  title="Export as PDF"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export PDF
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
              {(hasCriticData || hasOpenQuestions) && !showSidePanel && (
                <button
                  onClick={() => setShowCriticFlyout(f => !f)}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                    showCriticFlyout
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400'
                      : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600'
                  }`}
                  title="Toggle review panel"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Review
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
                      <div className="mb-4 rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 overflow-hidden">
                        <button
                          onClick={() => setShowRevisionSummary(v => !v)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 font-mono text-[10px]"
                        >
                          <span className="text-brand-500 dark:text-brand-400 flex-shrink-0">✦</span>
                          <span className="font-semibold uppercase tracking-widest text-surface-500 dark:text-surface-400">
                            ai revision summary
                          </span>
                          <Chevron expanded={showRevisionSummary} className="w-3 text-surface-400 ml-auto" />
                        </button>
                        {showRevisionSummary && (
                          <div className="px-3.5 pb-3 pt-2 border-t border-surface-200 dark:border-surface-700">
                            <MarkdownContent className="[&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">{revisionSummary}</MarkdownContent>
                          </div>
                        )}
                      </div>
                    )}
                    {loading ? (
                      <p className="text-sm text-surface-400 animate-pulse">Loading...</p>
                    ) : isEditing ? (
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full flex-1 min-h-0 text-sm font-mono resize-none bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        spellCheck={false}
                      />
                    ) : isFigmaDesign && figmaDesign && content ? (
                      <FigmaScreenPreviewer
                        figmaDesign={figmaDesign}
                        links={figmaLinks}
                        onLinkChange={setFigmaLink}
                        readonly={pendingCheckpoint?.stage !== 'figma_design'}
                        onDeleteScreen={requestDeleteIfAllowed ? (screenIndex) => {
                          const screen = figmaDesign.screens[screenIndex];
                          if (!screen) return;
                          requestDeleteIfAllowed(`screen "${screen.name}"`, () => removeFigmaScreen(content, screenIndex));
                        } : undefined}
                      />
                    ) : content ? <div ref={printRef}>{renderStructuredArtifact(content, {
                      artifactType,
                      activeWorkflow,
                      checkpoints,
                      pendingCheckpoint,
                      hasApprovePermission,
                      resolveLoading,
                      frMap,
                      nfrMap,
                      phaseByFeatureKey,
                      phaseOrder,
                      rerunStage,
                      onClose: () => setViewingArtifactId(null),
                      requestDelete: requestDeleteIfAllowed,
                    })}</div> : error ? (
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
                {/* Persona panel — positioned absolutely so it doesn't affect content centering */}
                {showPersonaPanel && (
                  <div className="absolute top-0 right-0 w-80 h-full overflow-y-auto border-l border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-3">
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
                    className="w-full text-sm resize-none rounded-lg border border-amber-300 dark:border-amber-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                  {hasOpenQuestions && (
                    <p className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
                      {openQuestions.length} open question{openQuestions.length !== 1 ? 's' : ''} on this document — Revise to answer them
                    </p>
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
