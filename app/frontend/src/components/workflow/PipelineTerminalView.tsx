import { useRef, useEffect, useMemo, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useModelStore } from '../../stores/modelStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { deriveFeatureButtons } from '../../utils/feature-artifacts';
import { StageRow } from './StageRow';
import { tryParseEpicFeatures, toPhases } from '../artifact/EpicFeaturesView';
import { STAGE_LABELS, STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import type { StageStatus, CoordinatorMessage } from '../../stores/workflowStore';
import { DancingCreature } from './pipeline-terminal/DancingCreature';
import { StageGroupHeader } from './pipeline-terminal/StageGroupHeader';
import { EventRow } from './pipeline-terminal/EventRow';
import { CheckpointRow, isStaleRecoveryCheckpoint } from './pipeline-terminal/CheckpointRow';
import { AuditTrailPanel } from './AuditTrailPanel';
import { RestartConfirmModal } from './RestartConfirmModal';
import { BacklogOverviewModal } from '../artifact/BacklogOverviewModal';
import { PageHeaderTitle } from '../common/PageHeaderTitle';
import { PageHeaderActions } from '../common/PageHeaderActions';
import { CommentsPanel } from '../initiative/CommentsPanel';

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  coordinatorMessages: CoordinatorMessage[];
  isRunning: boolean;
  onCheckpointResolved: (result: any) => void;
  onBack: () => void;
  onShowCRForm?: () => void;
  showCRButton?: boolean;
  pendingDiffCount?: number;
  onShowDiffPanel?: () => void;
}

export function PipelineTerminalView({ coordinatorMessages, isRunning, onCheckpointResolved, onBack, onShowCRForm, showCRButton, pendingDiffCount, onShowDiffPanel }: Props) {
  const {
    activeWorkflow,
    stageSequence,
    currentStage,
    completedStages,
    pendingStage,
    pendingStages,
    inProgressStages,
    checkpoints,
    productArea,
    strategicTheme,
    applyWorkflowStatus,
    clearCoordinatorMessages,
    setLastEventId,
    setViewingArtifactId,
  } = useWorkflowStore();
  const { selectedItem } = useSessionStore();
  const { agentModels } = useModelStore();
  const { realUser, noAuth } = useAuthStore();
  const isAdmin = noAuth || realUser?.is_admin;
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventScrollRef = useRef<HTMLDivElement>(null);
  // Event-log section elements, keyed by stage name — lets a left-pane stage row
  // scroll the matching right-pane section to the top of the log.
  const stageSectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollToStageSection = (stageName: string) => {
    stageSectionRefs.current.get(stageName)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [generalExpanded, setGeneralExpanded] = useState(false);
  const [crExpanded, setCrExpanded] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showBacklogOverview, setShowBacklogOverview] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ id: number; type: string; stage: string | null; created_at: number }>>([]);
  // 0-based feature index → phase label (e.g. "MVP", "Phase 1") that feature belongs to.
  const [featurePhaseLabels, setFeaturePhaseLabels] = useState<string[]>([]);

  useEffect(() => {
    setStopping(false);
  }, [activeWorkflow?.id, activeWorkflow?.status]);

  // Fetch artifacts for the workflow
  useEffect(() => {
    if (!activeWorkflow) return;
    const fetchArtifacts = async () => {
      try {
        const result = await api.getWorkflowArtifacts(activeWorkflow.id);
        setArtifacts(result.artifacts);
      } catch (err) {
        console.error('Failed to fetch artifacts:', err);
      }
    };
    fetchArtifacts();
    // Poll for new artifacts while workflow is active
    if (activeWorkflow.status === 'active') {
      const interval = setInterval(fetchArtifacts, 3000);
      return () => clearInterval(interval);
    }
  }, [activeWorkflow?.id, activeWorkflow?.status]);

  // Latest epic_features artifact id — used as the effect dependency below so the
  // content fetch only re-runs when a new epic_features artifact actually appears
  // (e.g. on first creation or a revision), not on every artifacts poll tick.
  const epicFeaturesArtifactId = useMemo(() => {
    const matches = artifacts.filter(a => a.type === 'epic_features');
    if (matches.length === 0) return null;
    return matches.reduce((latest, a) => (a.created_at > latest.created_at ? a : latest), matches[0]).id;
  }, [artifacts]);

  // Resolve which phase each feature belongs to, for the "Refinement - F1" stage rows.
  useEffect(() => {
    if (!epicFeaturesArtifactId) {
      setFeaturePhaseLabels([]);
      return;
    }
    api.getArtifactContent(epicFeaturesArtifactId)
      .then(({ content }) => {
        const parsed = tryParseEpicFeatures(content);
        if (!parsed) {
          setFeaturePhaseLabels([]);
          return;
        }
        const labels: string[] = [];
        for (const phase of toPhases(parsed)) {
          for (const _feature of phase.features ?? []) labels.push(phase.label);
        }
        setFeaturePhaseLabels(labels);
      })
      .catch(() => setFeaturePhaseLabels([]));
  }, [epicFeaturesArtifactId]);

  // Auto-scroll event log. On first mount (e.g. returning to this initiative
  // from another page) snap straight to the bottom with no animation — the
  // most recent event is the most relevant content. After that, only scroll
  // for new messages if the user is already near the bottom, so we don't yank
  // them away from whatever they'd scrolled up to read.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    const el = eventScrollRef.current;
    if (!el) return;
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [coordinatorMessages.length]);

  // Poll workflow status while running
  useEffect(() => {
    if (!activeWorkflow || activeWorkflow.status === 'complete') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.getWorkflowStatus(activeWorkflow.id);
        if (!cancelled) applyWorkflowStatus(status);
      } catch { /* ignore */ }
    };
    const t = setInterval(poll, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeWorkflow?.id, activeWorkflow?.status]);

  if (!activeWorkflow) return null;

  const isComplete = activeWorkflow.status === 'complete';
  const isWorkflowActive = activeWorkflow.status === 'active';
  const isDemoWorkflow = (() => {
    try {
      const policies = JSON.parse(activeWorkflow.policy_overrides ?? '{}') as Record<string, string>;
      return policies.demo_mode === 'true' || policies.demo_auto_approve === 'true';
    } catch {
      return false;
    }
  })();
  const canRestartDemo = !!isAdmin && isDemoWorkflow;
  // A stop OR a checkpoint rejection both emit a 'workflow_cancelled' event and mark
  // the workflow complete (see requestCancel). Treat the workflow as stopped whenever
  // that event is present — matching the home card's cancelledSet — rather than relying
  // on it being the *last* terminal event, since a rejected flow can emit a trailing
  // 'workflow_complete' that would otherwise flip the header back to "complete".
  const isCancelled = isComplete && coordinatorMessages.some(m => m.eventType === 'workflow_cancelled');

  const handleStop = async () => {
    if (stopping || isComplete) return;
    setStopping(true);
    try {
      await api.cancelWorkflow(activeWorkflow.id);
    } catch {
      // Ignore transient failures; restore the button state immediately.
    } finally {
      setStopping(false);
    }
  };

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      const status = await api.restartWorkflow(activeWorkflow.id);
      clearCoordinatorMessages();
      setLastEventId(0);
      setArtifacts([]);
      applyWorkflowStatus(status);
      setRestarting(false);
      setShowRestartConfirm(false);
    } catch {
      setRestarting(false);
    }
  };

  const handleRetryStage = async () => {
    if (!activeWorkflow) return;
    try {
      const status = await api.retryWorkflowStage(activeWorkflow.id);
      applyWorkflowStatus(status);
    } catch (err) {
      console.error('Failed to retry stage:', err);
    }
  };

  // Synthetic QA sub-stages (story_decomposition_F<n>_qa) get their own approved
  // checkpoint but are never added to stage_sequence (see the comment below on
  // deriveQaSubStageStatus), so they must be excluded here too — otherwise they
  // inflate the numerator past the denominator and the percentage exceeds 100%.
  const stageSequenceSet = new Set(stageSequence);
  const total = stageSequence.length;
  const doneCount = completedStages.filter(s => stageSequenceSet.has(s)).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const statuses: StageStatus[] = stageSequence.map(s =>
    deriveStageStatus(s, currentStage, completedStages, pendingStage, activeWorkflow.status, inProgressStages, pendingStages)
  );
  const statusByStage = new Map(stageSequence.map((s, i) => [s, statuses[i]]));

  // Keep story_decomposition in the roadmap as a pending placeholder. Once epic_feature_planner
  // is approved, injectFeatureDecompositionStages replaces it with story_decomposition_F1…Fn,
  // so the single row naturally expands into per-feature rows in the next status poll.
  const roadmapStages = stageSequence;

  // Group coordinator messages by stage (null stage → 'general')
  const eventsByStage = new Map<string, CoordinatorMessage[]>();
  for (const msg of coordinatorMessages) {
    const key = msg.stage ?? 'general';
    const arr = eventsByStage.get(key) ?? [];
    arr.push(msg);
    eventsByStage.set(key, arr);
  }

  // Lifecycle events shown as a pinned banner at the top of the event log.
  // workflow_cancelled is excluded — it belongs in the main timeline, not tucked
  // away behind the collapsed "general" toggle.
  const LIFECYCLE_EVENT_TYPES = new Set(['workflow_started', 'reiteration']);
  const CR_EVENT_TYPES = new Set(['cr_created', 'cr_assessed', 'cr_stage_started', 'cr_stage_completed', 'cr_complete']);
  const generalEvents = eventsByStage.get('general') ?? [];
  const topLifecycleEvents = generalEvents.filter(m => LIFECYCLE_EVENT_TYPES.has(m.eventType ?? ''));
  const crEvents = generalEvents.filter(m => CR_EVENT_TYPES.has(m.eventType ?? ''));
  const bottomGeneralEvents = generalEvents.filter(m => !LIFECYCLE_EVENT_TYPES.has(m.eventType ?? '') && !CR_EVENT_TYPES.has(m.eventType ?? '') && !!m.eventType);

  // Stages to show in the event log (exclude stages with no events yet if pending)
  // Also inject QA checkpoint stages right after their parent refinement stages
  const baseActiveStages = stageSequence.filter(s => {
    const status = deriveStageStatus(s, currentStage, completedStages, pendingStage, activeWorkflow.status, inProgressStages, pendingStages);
    return status !== 'pending' || eventsByStage.has(s);
  });

  // story_decomposition_F*_qa is never a literal stage_sequence member (it's a synthetic
  // sub-stage tracked only via its checkpoint), so it has no entry in `statuses`. Derive its
  // status from the checkpoint directly. Per-feature refinement no longer produces its own
  // QA checkpoint at all (QA is generated once, at epic level, after every feature is
  // approved — see runMultiAgentFeatureStage) — this only still matches a real checkpoint
  // for workflows that started before that change, via the branches below or the
  // eventsByStage fallback in the injection loop.
  const deriveQaSubStageStatus = (qaStage: string): StageStatus => {
    if (checkpoints.some(c => c.stage === qaStage && c.status === 'pending')) return 'at-checkpoint';
    if (checkpoints.some(c => c.stage === qaStage && c.status === 'approved')) return 'complete';
    return 'pending';
  };

  // Inject QA checkpoint stages after refinement stages — QA sub-stages only exist
  // for the per-feature multi-agent refinement stages (story_decomposition_F<n>), so
  // skip every other stage to avoid showing a bogus "QA Tests — initialising…" row
  // under whichever stage happens to be in progress.
  const FEATURE_REFINEMENT_STAGE_RE = /^story_decomposition_F\d+$/;
  const activeStages: string[] = [];
  for (const stage of baseActiveStages) {
    activeStages.push(stage);
    if (!FEATURE_REFINEMENT_STAGE_RE.test(stage)) continue;
    const qaStage = `${stage}_qa`;
    const qaStatus = deriveQaSubStageStatus(qaStage);
    if (qaStatus !== 'pending' || eventsByStage.has(qaStage)) {
      activeStages.push(qaStage);
    }
  }

  // Per-feature artifact ids (ticket + QA), shared by the bottom-bar "Stories/Tests" button
  // and the merged overview it opens.
  const featureButtons = deriveFeatureButtons(checkpoints);

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-[#0d1117] font-mono">
      {/* ── Left: stage list ───────────────────────────────────── */}
      <div className="w-96 flex-shrink-0 flex flex-col border-r border-surface-200 dark:border-surface-800/80">
        {/* Scrollable content: agent stage rows + post-completion pipeline section */}
        <div className="flex-1 overflow-y-auto">
          {/* Agent stage rows */}
          <div className="flex flex-col px-2 py-2">
            {roadmapStages.map((stageName, idx) => {
              const status = statusByStage.get(stageName)!;
              const checkpoint = checkpoints.find(c => c.stage === stageName && c.status === 'pending');
              const latestApproved = checkpoints.filter(c => c.stage === stageName && c.status === 'approved').at(-1);
              const completedAt = latestApproved?.resolved_at ?? latestApproved?.created_at ?? null;
              const featureMatch = stageName.match(/^story_decomposition_F(\d+)$/);
              const phaseLabel = featureMatch ? featurePhaseLabels[parseInt(featureMatch[1], 10) - 1] : undefined;
              const isPlaceholderRefinement = stageName === 'story_decomposition';
              return (
                <StageRow
                  key={stageName}
                  stageName={stageName}
                  index={idx}
                  status={status}
                  prevStatus={idx > 0 ? statusByStage.get(roadmapStages[idx - 1]) : undefined}
                  checkpoint={checkpoint}
                  latestApproved={latestApproved}
                  completedAt={completedAt}
                  agentModel={agentModels[stageName]}
                  onViewArtifact={setViewingArtifactId}
                  isLast={idx === roadmapStages.length - 1}
                  phaseLabel={phaseLabel}
                  customLabel={isPlaceholderRefinement ? 'Refinement' : undefined}
                  onSelect={() => scrollToStageSection(stageName)}
                  compact
                />
              );
            })}
          </div>
        </div>

        {/* Creature lives outside the scrollable area */}
        {!isComplete && <DancingCreature />}

        {/* Progress */}
        <div className="px-3 py-2 border-t border-surface-200 dark:border-surface-800/40 flex-shrink-0">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-surface-500 dark:text-surface-600">
              {isComplete ? 'complete' : `${doneCount}/${total}`}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-surface-500 dark:text-surface-600">{isComplete ? 100 : pct}%</span>
            </div>
          </div>
          <div className="h-0.5 bg-surface-200 dark:bg-surface-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isComplete ? 'bg-green-500' : 'bg-brand-500'}`}
              style={{ width: `${isComplete ? 100 : pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Right: event log ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <PageHeaderTitle>
          <button
            onClick={onBack}
            className="flex-shrink-0 text-[11px] text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors font-mono"
          >
            ← back
          </button>
          <span className="text-surface-300 dark:text-surface-700/60 text-xs select-none">│</span>
          <span className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight">
            {activeWorkflow.summary ?? activeWorkflow.goal.split('\n')[0].slice(0, 70)}
          </span>
          {selectedItem?.description && (
            <button
              onClick={() => setShowDescription(true)}
              title="View initial description"
              className="flex-shrink-0 p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          {productArea && (
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400">
              {productArea}
            </span>
          )}
          {strategicTheme && (
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              {strategicTheme}
            </span>
          )}
          {isRunning && !isComplete && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
              live
            </span>
          )}
          {isComplete && !isCancelled && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              complete
            </span>
          )}
          {isCancelled && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              stopped
            </span>
          )}
        </PageHeaderTitle>
        <PageHeaderActions>
          {isAdmin && isWorkflowActive && !isComplete && (
            <button
              onClick={handleRetryStage}
              title="Retry current stage from the beginning"
              className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-surface-300 dark:border-surface-700/50 text-surface-500 dark:text-surface-400 hover:text-amber-600 dark:hover:text-amber-500 hover:border-amber-400 dark:hover:border-amber-700 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              retry
            </button>
          )}
          <button
            onClick={() => setShowAudit(true)}
            title="Activity — who reviewed each stage"
            className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-surface-300 dark:border-surface-700/50 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            activity
          </button>
          <button
            onClick={() => setShowComments(v => !v)}
            title="Initiative log — notes and decisions"
            className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border transition-colors ${showComments ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400' : 'border-surface-300 dark:border-surface-700/50 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            log
          </button>
          {isWorkflowActive && (
            <button
              onClick={handleStop}
              disabled={stopping}
              title="Stop workflow"
              className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-red-300 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {stopping && (
                <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              <>■ stop</>
            </button>
          )}
        </PageHeaderActions>

        {/* Events */}
        <div ref={eventScrollRef} className="flex-1 overflow-y-auto px-0 py-2">
          {/* Lifecycle events pinned at the top (collapsible) */}
          {topLifecycleEvents.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setGeneralExpanded(e => !e)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-600 hover:text-surface-500 dark:hover:text-surface-500 transition-colors text-left"
              >
                <svg
                  className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${generalExpanded ? 'rotate-90' : ''}`}
                  fill="currentColor" viewBox="0 0 6 10"
                >
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                general
                {!generalExpanded && (
                  <span className="ml-1 normal-case tracking-normal font-normal text-surface-300 dark:text-surface-700">
                    ({topLifecycleEvents.length})
                  </span>
                )}
              </button>
              {generalExpanded && topLifecycleEvents.map((msg, i) => (
                <EventRow key={i} msg={msg} />
              ))}
            </div>
          )}

          {/* Per-stage sections */}
          {activeStages.map(stageName => {
            const stageIdx = stageSequence.indexOf(stageName);
            // A synthetic "_qa" sub-stage (see deriveQaSubStageStatus above) has no
            // stage_sequence entry of its own — derive its status from its checkpoint/parent
            // instead of the (nonexistent) statuses[] slot.
            const isQaSubStage = stageIdx === -1 && stageName.endsWith('_qa');
            const status = isQaSubStage ? deriveQaSubStageStatus(stageName) : (stageIdx >= 0 ? statuses[stageIdx] : 'pending');
            const msgs = eventsByStage.get(stageName) ?? [];
            // Each section (a refinement stage and its QA sub-stage) hosts its own
            // independent checkpoint card, keyed to its own exact stage name — the QA
            // approval no longer gets folded into its parent refinement stage's card.
            const isAtCheckpoint = status === 'at-checkpoint';

            const pendingCp = checkpoints.find(c => c.stage === stageName && c.status === 'pending');
            const approvedCp = checkpoints.filter(c => c.stage === stageName && c.status === 'approved').at(-1);
            // Stale-recovery checkpoints may carry a critic artifact_id — exclude them
            // from both the fallback scan and the pending checkpoint's own artifact_id.
            const anyWithArtifact = checkpoints
              .filter(c => c.stage === stageName && c.artifact_id !== null && !isStaleRecoveryCheckpoint(c.coordinator_action))
              .at(-1);
            const pendingArtifactId = pendingCp && !isStaleRecoveryCheckpoint(pendingCp.coordinator_action)
              ? pendingCp.artifact_id : null;
            const stageArtifactId = approvedCp?.artifact_id ?? pendingArtifactId ?? anyWithArtifact?.artifact_id ?? null;

            return (
              <div
                key={stageName}
                ref={el => {
                  if (el) stageSectionRefs.current.set(stageName, el);
                  else stageSectionRefs.current.delete(stageName);
                }}
              >
                <StageGroupHeader
                  stageName={stageName}
                  status={status}
                  artifactId={stageArtifactId}
                  onViewOutput={setViewingArtifactId}
                />
                {msgs.map((msg, i) => (
                  <EventRow key={i} msg={msg} />
                ))}
                {status === 'in-progress' && msgs.length === 0 && (
                  <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] text-surface-500 dark:text-surface-600">
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    initialising…
                  </div>
                )}
                {status === 'in-progress' && msgs.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-1 text-[10px] text-brand-600 animate-pulse">
                    <span className="w-1 h-1 rounded-full bg-brand-600" />
                    processing…
                  </div>
                )}
                {isAtCheckpoint && (
                  <CheckpointRow stageName={stageName} onResolved={onCheckpointResolved} />
                )}
              </div>
            );
          })}

          {/* Post-workflow events (board_synced, workflow_complete, etc.) */}
          {bottomGeneralEvents.map((msg, i) => (
            <EventRow key={i} msg={msg} />
          ))}

          {/* Empty state */}
          {coordinatorMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <div className="text-3xl opacity-40">⚙</div>
              <p className="text-sm text-surface-500 dark:text-surface-600 font-mono">workflow initialising…</p>
            </div>
          )}

          {isComplete && (
            <div className="px-4 py-3 space-y-2 border-t border-surface-200 dark:border-surface-800/60 mt-2">
              {/* Completion header row */}
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-2 text-xs font-mono ${isCancelled ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCancelled ? 'bg-red-500' : 'bg-green-500'}`} />
                  {isCancelled ? 'workflow stopped' : 'workflow complete'}
                </div>
                <div className="flex items-center gap-2">
                  {isComplete && isAdmin && (
                    <button
                      onClick={() => setShowRestartConfirm(true)}
                      disabled={restarting}
                      className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded border border-brand-400 dark:border-brand-600 text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {restarting ? (
                        <>
                          <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          restarting…
                        </>
                      ) : (isComplete && canRestartDemo ? '↺ restart demo' : '↺ restart from beginning')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Change Requests section (collapsible, pinned at bottom) */}
          {crEvents.length > 0 && (
            <div className="mt-2 mb-1">
              <button
                onClick={() => setCrExpanded(e => !e)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-600 hover:text-surface-500 dark:hover:text-surface-500 transition-colors text-left"
              >
                <svg
                  className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${crExpanded ? 'rotate-90' : ''}`}
                  fill="currentColor" viewBox="0 0 6 10"
                >
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                change requests
                {!crExpanded && (
                  <span className="ml-1 normal-case tracking-normal font-normal text-surface-300 dark:text-surface-700">
                    ({crEvents.length})
                  </span>
                )}
              </button>
              {crExpanded && crEvents.map((msg, i) => (
                <EventRow key={i} msg={msg} />
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Artifacts section (sticky at bottom of right panel) */}
        {(artifacts.length > 0 || showCRButton || (pendingDiffCount ?? 0) > 0) && (() => {
          // Group by artifact.type — unique per stage and collision-safe even when two
          // stages share the same session mode (e.g. solution_architect + api_spec both
          // use mode='architecture', but their types are 'architecture' and 'api_spec').
          const latestByType = new Map<string, typeof artifacts[0]>();
          artifacts.forEach(artifact => {
            const key = artifact.type ?? 'unknown';
            const existing = latestByType.get(key);
            if (!existing || artifact.created_at > existing.created_at) {
              latestByType.set(key, artifact);
            }
          });

          // "Tickets" button is for the Epic/Feature shells only (epic_feature_planner).
          const TICKET_TYPES = new Set(['epic_features']);
          const ticketCandidates = Array.from(latestByType.values())
            .filter(a => TICKET_TYPES.has(a.type ?? ''))
            .sort((a, b) => b.created_at - a.created_at);
          const ticketArtifact = ticketCandidates[0] ?? null;

          const regularArtifacts = Array.from(latestByType.values())
            .filter(a => !TICKET_TYPES.has(a.type ?? '') && a.type !== 'backlog' && a.type !== 'qa_tests'
              && !/^backlog_F\d+$/.test(a.type ?? '') && a.type !== 'epic_qa');

          const hasArtifacts = regularArtifacts.length > 0 || !!ticketArtifact || featureButtons.length > 0;
          return (
            <div className="flex-shrink-0 border-t border-surface-200 dark:border-surface-700/60 bg-white dark:bg-[#0d1117] px-2 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {regularArtifacts.map((artifact) => {
                  const stageLabel = STAGE_SHORT_LABELS[artifact.type ?? ''] ?? STAGE_SHORT_LABELS[artifact.stage ?? ''] ?? STAGE_LABELS[artifact.stage ?? ''] ?? artifact.type;
                  return (
                    <button
                      key={artifact.id}
                      onClick={() => setViewingArtifactId(artifact.id)}
                      className="px-2.5 py-1 text-xs font-medium rounded bg-surface-100 dark:bg-surface-800/60 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60 transition-colors"
                    >
                      {stageLabel}
                    </button>
                  );
                })}
                {ticketArtifact && (
                  <button
                    onClick={() => setViewingArtifactId(ticketArtifact.id)}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-surface-100 dark:bg-surface-800/60 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60 transition-colors"
                  >
                    Epic/Features
                  </button>
                )}
                {featureButtons.length > 0 && (
                  <button
                    onClick={() => setShowBacklogOverview(true)}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-surface-100 dark:bg-surface-800/60 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700/60 transition-colors"
                  >
                    Stories/Tests
                  </button>
                )}
                {showCRButton && onShowCRForm && (
                  <>
                    {hasArtifacts && <span className="text-surface-300 dark:text-surface-700 select-none">·</span>}
                    <button
                      onClick={onShowCRForm}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-cyan-300 dark:border-cyan-700 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors"
                    >
                      Change Request
                    </button>
                  </>
                )}
                {(pendingDiffCount ?? 0) > 0 && onShowDiffPanel && (
                  <>
                    {(hasArtifacts || (showCRButton && !!onShowCRForm)) && <span className="text-surface-300 dark:text-surface-700 select-none">·</span>}
                    <button
                      onClick={onShowDiffPanel}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                    >
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">{pendingDiffCount}</span>
                      Context Updates
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Comments panel (third pane, collapsible) ─────────── */}
      {showComments && selectedItem && (
        <CommentsPanel itemId={selectedItem.id} />
      )}

      {showAudit && (
        <AuditTrailPanel workflowId={activeWorkflow.id} onClose={() => setShowAudit(false)} />
      )}

      {showBacklogOverview && (
        <BacklogOverviewModal
          featureButtons={featureButtons}
          initiativeTitle={activeWorkflow.summary ?? activeWorkflow.goal.split('\n')[0]}
          epicFeaturesArtifactId={epicFeaturesArtifactId}
          workflowId={activeWorkflow.id}
          onClose={() => setShowBacklogOverview(false)}
        />
      )}

      {showRestartConfirm && (
        <RestartConfirmModal
          isDemo={canRestartDemo}
          loading={restarting}
          onCancel={() => setShowRestartConfirm(false)}
          onConfirm={handleRestart}
        />
      )}

      {showDescription && selectedItem?.description && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50" onClick={() => setShowDescription(false)}>
          <div className="w-full max-w-2xl mx-4 bg-white dark:bg-surface-900 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Initial Description</h3>
              <button
                onClick={() => setShowDescription(false)}
                className="p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 max-h-96 overflow-y-auto">
              <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{selectedItem.description}</p>
            </div>
            <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 flex justify-end">
              <button
                onClick={() => setShowDescription(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
