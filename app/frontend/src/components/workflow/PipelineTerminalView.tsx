import { useRef, useEffect, useMemo, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { deriveFeatureButtons, deriveEpicQaArtifactId } from '../../utils/feature-artifacts';
import { splitProductAreas } from '../../utils/product-area';
import { StageRow, StatusIcon } from './StageRow';
import { tryParseEpicFeatures, toPhases } from '../artifact/EpicFeaturesView';
import { STAGE_LABELS, STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import type { StageStatus, CoordinatorMessage } from '../../stores/workflowStore';
import { XCubeTrail } from './pipeline-terminal/XCubeTrail';
import { StageGroupHeader } from './pipeline-terminal/StageGroupHeader';
import { WaveGroupHeader } from './pipeline-terminal/WaveGroupHeader';
import { EventRow } from './pipeline-terminal/EventRow';
import { CheckpointRow, isStaleRecoveryCheckpoint } from './pipeline-terminal/CheckpointRow';
import { BrailleSpinner } from './pipeline-terminal/BrailleSpinner';
import { buildRoadmapTree } from './pipeline-terminal/roadmap-tree';
import { AuditTrailPanel } from './AuditTrailPanel';
import { RestartConfirmModal } from './RestartConfirmModal';
import { ResumeFromStageModal } from './ResumeFromStageModal';
import { RetryConfirmModal } from './RetryConfirmModal';
import { StopConfirmModal } from './StopConfirmModal';
import { BacklogOverviewModal } from '../artifact/BacklogOverviewModal';
import { PageHeaderTitle } from '../common/PageHeaderTitle';
import { PageHeaderActions } from '../common/PageHeaderActions';
import { DescriptionModal } from '../common/DescriptionModal';
import { InfoBadge } from '../common/InfoBadge';
import { StatusBadge } from '../home/StatusBadge';
import type { WorkflowInfo } from '../home/types';
import { CommentsPanel } from '../initiative/CommentsPanel';

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  coordinatorMessages: CoordinatorMessage[];
  onCheckpointResolved: (result: any) => void;
  onBack: () => void;
  onShowCRForm?: () => void;
  showCRButton?: boolean;
  pendingDiffCount?: number;
  onShowDiffPanel?: () => void;
}

export function PipelineTerminalView({ coordinatorMessages, onCheckpointResolved, onBack, onShowCRForm, showCRButton, pendingDiffCount, onShowDiffPanel }: Props) {
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
    pendingBacklogPreview,
    setPendingBacklogPreview,
  } = useWorkflowStore();
  const { selectedItem } = useSessionStore();
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
  const [retryingStage, setRetryingStage] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [generalExpanded, setGeneralExpanded] = useState(false);
  const [crExpanded, setCrExpanded] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [backlogOverviewView, setBacklogOverviewView] = useState<'stories' | 'tests' | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ id: number; type: string; stage: string | null; created_at: number }>>([]);
  // 0-based feature index → phase label (e.g. "MVP", "Phase 1") that feature belongs to.
  const [featurePhaseLabels, setFeaturePhaseLabels] = useState<string[]>([]);
  // 0-based feature index → feature title (e.g. "Checkout flow"), for the roadmap tree's "F1 — <title>" rows.
  const [featureNames, setFeatureNames] = useState<string[]>([]);
  // phase label → epic title (e.g. "MVP" → "Checkout Redesign"), for the roadmap tree's "MVP — <epic>" branch rows.
  const [phaseEpicTitles, setPhaseEpicTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    setStopping(false);
  }, [activeWorkflow?.id, activeWorkflow?.status]);

  // Share-link deep link (?backlogView=stories|tests, see App.tsx) — reopen the same
  // Stories/Tests preview once this workflow's checkpoints (and therefore featureButtons)
  // have loaded, then clear the pending value so it doesn't reopen on later navigation.
  useEffect(() => {
    if (!pendingBacklogPreview || !activeWorkflow) return;
    if (deriveFeatureButtons(checkpoints).length === 0) return;
    setBacklogOverviewView(pendingBacklogPreview);
    setPendingBacklogPreview(null);
  }, [pendingBacklogPreview, activeWorkflow?.id, checkpoints]);

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

  // Latest PRD artifact id — feeds the Stories/Tests preview's FR/NFR hover tooltips
  // (useMergedBacklogData loads it to build frMap/nfrMap). Without this the tooltips
  // silently don't show, since frMap/nfrMap default to empty when prdArtifactId is absent.
  const prdArtifactId = useMemo(() => {
    const matches = artifacts.filter(a => a.type === 'prd');
    if (matches.length === 0) return null;
    return matches.reduce((latest, a) => (a.created_at > latest.created_at ? a : latest), matches[0]).id;
  }, [artifacts]);

  // story_decomposition_F<n> → 1-based wave number, read off epic_feature_planner's
  // injection event (details.waves — see injectFeatureDecompositionStages). The roadmap
  // tree below groups features by phase regardless of which wave scheduled them
  // concurrently, so this is the only place wave membership surfaces — as a small
  // per-row badge rather than by reordering the tree.
  const waveIndexByStage = useMemo(() => {
    const map = new Map<string, number>();
    const injectionMsg = coordinatorMessages.find(
      m => m.stage === 'epic_feature_planner' && Array.isArray(m.details?.waves)
    );
    const waves = injectionMsg?.details?.waves as string[][] | undefined;
    if (!waves) return map;
    waves.forEach((wave, i) => {
      if (wave.length <= 1) return; // nothing parallel to call out
      wave.forEach(stageName => map.set(stageName, i + 1));
    });
    return map;
  }, [coordinatorMessages]);

  // Resolve which phase each feature belongs to, for the "Refinement - F1" stage rows.
  // Also re-fetches on stageSequence changes, not just epicFeaturesArtifactId: a feature
  // added/removed during epic_feature_planner review saves the SAME artifact row in place
  // (same id), so the id alone never signals the edit. stageSequence does change — it's
  // rewritten to the new story_decomposition_F<n> list the moment epic_feature_planner
  // (re)runs — which is exactly when refinement starts and these labels need to be current.
  useEffect(() => {
    if (!epicFeaturesArtifactId) {
      setFeaturePhaseLabels([]);
      setFeatureNames([]);
      setPhaseEpicTitles({});
      return;
    }
    api.getArtifactContent(epicFeaturesArtifactId)
      .then(({ content }) => {
        const parsed = tryParseEpicFeatures(content);
        if (!parsed) {
          setFeaturePhaseLabels([]);
          setFeatureNames([]);
          setPhaseEpicTitles({});
          return;
        }
        const labels: string[] = [];
        const names: string[] = [];
        const epicTitles: Record<string, string> = {};
        for (const phase of toPhases(parsed)) {
          if (phase.epicTitle) epicTitles[phase.label] = phase.epicTitle;
          for (const feature of phase.features ?? []) {
            labels.push(phase.label);
            names.push(feature.title);
          }
        }
        setFeaturePhaseLabels(labels);
        setFeatureNames(names);
        setPhaseEpicTitles(epicTitles);
      })
      .catch(() => {
        setFeaturePhaseLabels([]);
        setFeatureNames([]);
        setPhaseEpicTitles({});
      });
  }, [epicFeaturesArtifactId, stageSequence]);

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
    // checkpoints and artifacts arrive from their own separate fetches, after
    // coordinatorMessages — checkpoint cards grow the scrollable log itself, and the
    // artifacts footer (sibling, sticky) shrinks the log's available height. Without
    // these in the deps, the initial snap fires before that content mounts and leaves
    // a gap at the bottom.
  }, [coordinatorMessages.length, checkpoints.length, artifacts.length]);

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
  // Same WorkflowInfo shape + StatusBadge the Home card uses, so the header pill always
  // agrees with the card on colors/labels and doesn't collapse paused-at-checkpoint into "live".
  const headerWorkflowInfo: WorkflowInfo = {
    id: activeWorkflow.id,
    status: activeWorkflow.status,
    currentStage,
    summary: activeWorkflow.summary,
    isCancelled,
    pendingStage,
  };

  const handleStop = async () => {
    if (stopping || isComplete) return;
    setStopping(true);
    try {
      await api.cancelWorkflow(activeWorkflow.id);
      setShowStopConfirm(false);
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

  const handleResume = async (fromStage: string, feedback: string) => {
    if (resuming) return;
    setResuming(true);
    try {
      const status = await api.reiterateWorkflow(activeWorkflow.id, fromStage, feedback);
      applyWorkflowStatus(status);
      setShowResumeModal(false);
    } catch (err) {
      console.error('Failed to resume workflow from stage:', err);
    } finally {
      setResuming(false);
    }
  };

  const handleRetryStage = async () => {
    if (!activeWorkflow || retryingStage) return;
    setRetryingStage(true);
    try {
      const status = await api.retryWorkflowStage(activeWorkflow.id);
      applyWorkflowStatus(status);
      setShowRetryConfirm(false);
    } catch (err) {
      console.error('Failed to retry stage:', err);
    } finally {
      setRetryingStage(false);
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

  // Stages the workflow has actually reached — i.e. everywhere it's valid to resume from.
  // Can't rely on statuses[] alone: deriveStageStatus only reports 'in-progress' while
  // workflowStatus === 'active', so the stage a stopped workflow was mid-run on (no
  // approved checkpoint yet) would otherwise read as 'pending' and be excluded.
  const currentStageIdx = currentStage ? stageSequence.indexOf(currentStage) : -1;
  const resumableStages = stageSequence
    .filter((s, i) => completedStages.includes(s) || (currentStageIdx >= 0 && i <= currentStageIdx))
    .map(s => ({ stage: s, label: STAGE_LABELS[s] ?? s }));

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
  // Unified whole-backlog QA suite (current architecture) — see deriveEpicQaArtifactId.
  const epicQaArtifactId = deriveEpicQaArtifactId(checkpoints);

  return (
    <div className="flex h-full overflow-hidden font-mono">
      {/* ── Left: stage list ───────────────────────────────────── */}
      <div className="w-[27rem] flex-shrink-0 flex flex-col border-r border-surface-200 dark:border-surface-800/80">
        {/* Scrollable content: agent stage rows + post-completion pipeline section */}
        <div className="flex-1 overflow-y-auto">
          {/* Agent stage rows — a box-drawing tree once features exist, so the
              phase → feature containment is shown structurally instead of a subtitle line. */}
          <div className="flex flex-col px-2 py-2">
            {buildRoadmapTree(roadmapStages, featurePhaseLabels, s => statusByStage.get(s) ?? 'pending', phaseEpicTitles).map((node, idx) => {
              if (node.kind === 'branch') {
                return (
                  <div key={`${node.key}-${idx}`} className="flex items-center gap-1.5 py-1.5">
                    {node.prefix && (
                      <span className="flex-shrink-0 font-mono text-[13px] leading-none text-surface-300 dark:text-surface-700 whitespace-pre select-none">
                        {node.prefix}
                      </span>
                    )}
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      <StatusIcon status={node.status} />
                    </span>
                    <span className="text-[13px] font-mono leading-none text-surface-400 dark:text-surface-600 truncate">
                      {node.label}
                    </span>
                  </div>
                );
              }
              const stageName = node.stageName;
              const status = statusByStage.get(stageName)!;
              const isPlaceholderRefinement = stageName === 'story_decomposition';
              const featureName = node.featureIndex != null ? featureNames[node.featureIndex] : undefined;
              const customLabel = isPlaceholderRefinement
                ? 'Refinement'
                : node.featureIndex != null
                  ? [STAGE_SHORT_LABELS[stageName], featureName].filter(Boolean).join(' — ')
                  : undefined;
              const waveIndex = node.featureIndex != null ? waveIndexByStage.get(stageName) : undefined;
              return (
                <StageRow
                  key={stageName}
                  stageName={stageName}
                  status={status}
                  customLabel={customLabel}
                  onSelect={() => scrollToStageSection(stageName)}
                  treePrefix={node.prefix}
                  badge={waveIndex ? `wave ${waveIndex}` : undefined}
                />
              );
            })}
          </div>
        </div>

        {/* Traveling mark lives outside the scrollable area */}
        {!isComplete && <XCubeTrail />}

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
            className="flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors flex-shrink-0"
          >
            <span aria-hidden="true">&lt;</span> Initiatives
          </button>
          <span className="text-surface-300 dark:text-surface-600">/</span>
          <span className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight">
            {activeWorkflow.summary ?? activeWorkflow.goal.split('\n')[0].slice(0, 70)}
          </span>
          {selectedItem?.description && (
            <button
              onClick={() => setShowDescription(true)}
              title="View initial description"
              className="flex-shrink-0 text-[11px] font-mono text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              [i]
            </button>
          )}
          <StatusBadge wf={headerWorkflowInfo} />
          {productArea && splitProductAreas(productArea).map(area => (
            <InfoBadge key={area} variant="productArea">{area}</InfoBadge>
          ))}
          {strategicTheme && <InfoBadge variant="theme">{strategicTheme}</InfoBadge>}
        </PageHeaderTitle>
        <PageHeaderActions>
          {isAdmin && isWorkflowActive && !isComplete && (
            <button
              onClick={() => setShowRetryConfirm(true)}
              title="Retry current stage from the beginning"
              className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-surface-300 dark:border-surface-700/50 text-surface-500 dark:text-surface-400 hover:text-amber-600 dark:hover:text-amber-500 hover:border-amber-400 dark:hover:border-amber-700 transition-colors"
            >
              <span aria-hidden="true">↻</span> retry
            </button>
          )}
          <button
            onClick={() => setShowAudit(true)}
            title="Activity — who reviewed each stage"
            className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-surface-300 dark:border-surface-700/50 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <span aria-hidden="true">▤</span> activity
          </button>
          <button
            onClick={() => setShowComments(v => !v)}
            title="Initiative log — notes and decisions"
            className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border transition-colors ${showComments ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400' : 'border-surface-300 dark:border-surface-700/50 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
          >
            <span aria-hidden="true">¶</span> log
          </button>
          {isWorkflowActive && (
            <button
              onClick={() => setShowStopConfirm(true)}
              disabled={stopping}
              title="Stop workflow"
              className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-red-300 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {stopping && <BrailleSpinner className="text-[11px]" />}
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
                <span
                  className={`inline-block flex-shrink-0 text-[10px] transition-transform duration-150 ${generalExpanded ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                >
                  ▸
                </span>
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
            const allMsgs = eventsByStage.get(stageName) ?? [];
            // A wave's kickoff event is tagged to its first member stage (see
            // insertEvent('wave_started', ...) in workflow-router.ts) — pull it out of
            // that stage's own event list and render it as a wave-wide banner above
            // this section instead, so it doesn't read as F1-specific narration.
            const waveStartMsg = allMsgs.find(m => m.eventType === 'wave_started');
            const msgs = waveStartMsg ? allMsgs.filter(m => m !== waveStartMsg) : allMsgs;
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
            const stageArtifact = approvedCp?.artifact
              ?? (pendingCp && !isStaleRecoveryCheckpoint(pendingCp.coordinator_action) ? pendingCp.artifact : null)
              ?? anyWithArtifact?.artifact ?? null;

            return (
              <div
                key={stageName}
                ref={el => {
                  if (el) stageSectionRefs.current.set(stageName, el);
                  else stageSectionRefs.current.delete(stageName);
                }}
              >
                {waveStartMsg && <WaveGroupHeader msg={waveStartMsg} featureNames={featureNames} />}
                <StageGroupHeader
                  stageName={stageName}
                  status={status}
                  artifactId={stageArtifactId}
                  onViewOutput={setViewingArtifactId}
                  wikiUrl={stageArtifact?.wiki_url}
                />
                {msgs.map((msg, i) => (
                  <EventRow key={i} msg={msg} />
                ))}
                {status === 'in-progress' && msgs.length === 0 && (
                  <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] text-surface-500 dark:text-surface-600">
                    <BrailleSpinner className="text-[11px]" />
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
                  {isComplete && isAdmin && resumableStages.length > 0 && (
                    <button
                      onClick={() => setShowResumeModal(true)}
                      disabled={resuming}
                      title="Re-enter at an earlier stage, keeping upstream artifacts"
                      className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {resuming ? (
                        <>
                          <BrailleSpinner className="text-[11px]" />
                          resuming…
                        </>
                      ) : '⏵ resume from stage…'}
                    </button>
                  )}
                  {isComplete && isAdmin && (
                    <button
                      onClick={() => setShowRestartConfirm(true)}
                      disabled={restarting}
                      className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded border border-brand-400 dark:border-brand-600 text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {restarting ? (
                        <>
                          <BrailleSpinner className="text-[11px]" />
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
                <span
                  className={`inline-block flex-shrink-0 text-[10px] transition-transform duration-150 ${crExpanded ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                >
                  ▸
                </span>
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
            <div className="flex-shrink-0 border-t border-surface-200 dark:border-surface-700/60 px-2 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {regularArtifacts.map((artifact) => {
                  const stageLabel = STAGE_SHORT_LABELS[artifact.type ?? ''] ?? STAGE_SHORT_LABELS[artifact.stage ?? ''] ?? STAGE_LABELS[artifact.stage ?? ''] ?? artifact.type;
                  return (
                    <button
                      key={artifact.id}
                      onClick={() => setViewingArtifactId(artifact.id)}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 hover:border-surface-400 dark:hover:border-surface-500 transition-colors"
                    >
                      {stageLabel}
                    </button>
                  );
                })}
                {ticketArtifact && (
                  <button
                    onClick={() => setViewingArtifactId(ticketArtifact.id)}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 hover:border-surface-400 dark:hover:border-surface-500 transition-colors"
                  >
                    Epic/Features
                  </button>
                )}
                {featureButtons.length > 0 && (
                  <>
                    <button
                      onClick={() => setBacklogOverviewView('stories')}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 hover:border-surface-400 dark:hover:border-surface-500 transition-colors"
                    >
                      Stories
                    </button>
                    <button
                      onClick={() => setBacklogOverviewView('tests')}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 hover:border-surface-400 dark:hover:border-surface-500 transition-colors"
                    >
                      Tests
                    </button>
                  </>
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

      {backlogOverviewView && (
        <BacklogOverviewModal
          view={backlogOverviewView}
          featureButtons={featureButtons}
          initiativeTitle={activeWorkflow.summary ?? activeWorkflow.goal.split('\n')[0]}
          epicFeaturesArtifactId={epicFeaturesArtifactId}
          epicQaArtifactId={epicQaArtifactId}
          prdArtifactId={prdArtifactId}
          workflowId={activeWorkflow.id}
          onClose={() => setBacklogOverviewView(null)}
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

      {showResumeModal && (
        <ResumeFromStageModal
          stages={resumableStages}
          loading={resuming}
          onCancel={() => setShowResumeModal(false)}
          onConfirm={handleResume}
        />
      )}

      {showRetryConfirm && (
        <RetryConfirmModal
          isWave={inProgressStages.length > 1}
          loading={retryingStage}
          onCancel={() => setShowRetryConfirm(false)}
          onConfirm={handleRetryStage}
        />
      )}

      {showStopConfirm && (
        <StopConfirmModal
          loading={stopping}
          onCancel={() => setShowStopConfirm(false)}
          onConfirm={handleStop}
        />
      )}

      {showDescription && selectedItem?.description && (
        <DescriptionModal description={selectedItem.description} onClose={() => setShowDescription(false)} />
      )}
    </div>
  );
}
