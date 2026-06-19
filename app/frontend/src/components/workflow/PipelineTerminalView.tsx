import { useRef, useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { StageRow } from './StageRow';
import { STAGE_LABELS, STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import type { StageStatus, CoordinatorMessage } from '../../stores/workflowStore';
import { PipelineStatusSection } from './PipelineStatusSection';
import { DemoProjectSection } from './DemoProjectSection';
import { DancingCreature } from './pipeline-terminal/DancingCreature';
import { StageGroupHeader } from './pipeline-terminal/StageGroupHeader';
import { EventRow } from './pipeline-terminal/EventRow';
import { CheckpointRow, isStaleRecoveryCheckpoint } from './pipeline-terminal/CheckpointRow';
import { AuditTrailPanel } from './AuditTrailPanel';

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
  const { agentModels } = useModelStore();
  const { isDemoMode: demoModeEnabled } = useSettingsStore();
  const { realUser } = useAuthStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [demoConfigured, setDemoConfigured] = useState<boolean>(false);
  const [generalExpanded, setGeneralExpanded] = useState(false);
  const [crExpanded, setCrExpanded] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ id: number; type: string; stage: string | null; created_at: number }>>([]);

  // Demo sections only show when demo mode is enabled in settings AND DEMO_PROJECT_PATH is configured
  const isDemoMode = demoModeEnabled && demoConfigured;

  // Check once whether the demo pipeline is configured
  useEffect(() => {
    if (!activeWorkflow) return;
    api.getDemoRunStatus(activeWorkflow.id)
      .then(s => setDemoConfigured(s.configured))
      .catch(() => {});
  }, [activeWorkflow?.id]);

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

  // Auto-scroll event log
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
  const canRestartDemo = !!realUser?.is_admin && isDemoWorkflow;
  const lastTerminalEvent = [...coordinatorMessages]
    .reverse()
    .find(m => m.eventType === 'workflow_cancelled' || m.eventType === 'workflow_complete');
  const isCancelled = isComplete && lastTerminalEvent?.eventType === 'workflow_cancelled';

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
    } catch {
      setRestarting(false);
    }
  };

  const total = stageSequence.length;
  const doneCount = completedStages.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const statuses: StageStatus[] = stageSequence.map(s =>
    deriveStageStatus(s, currentStage, completedStages, pendingStage, activeWorkflow.status, inProgressStages, pendingStages)
  );

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

  // Inject QA checkpoint stages after refinement stages
  const activeStages: string[] = [];
  for (const stage of baseActiveStages) {
    activeStages.push(stage);
    // Check if there's a QA checkpoint for this refinement stage
    const qaCheckpoint = checkpoints.find(c => c.stage === `${stage}_qa` && c.status === 'pending');
    if (qaCheckpoint) {
      activeStages.push(`${stage}_qa`);
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-[#0d1117] font-mono">
      {/* ── Left: stage list ───────────────────────────────────── */}
      <div className="w-96 flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800/80">
        {/* Title bar — fixed h-10 matches right-pane header exactly */}
        <div className="flex items-center h-10 px-3 bg-slate-50 dark:bg-[#161b22] border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">pipeline</span>
        </div>

        {/* Progress */}
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800/40 flex-shrink-0">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-slate-500 dark:text-slate-600">
              {isComplete ? 'complete' : `${doneCount}/${total}`}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-600">{pct}%</span>
            </div>
          </div>
          <div className="h-0.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isComplete ? 'bg-green-500' : 'bg-teal-500'}`}
              style={{ width: `${isComplete ? 100 : pct}%` }}
            />
          </div>
        </div>

        {/* Scrollable content: agent stage rows + post-completion pipeline section */}
        <div className="flex-1 overflow-y-auto">
          {/* Agent stage rows */}
          <div className="flex flex-col px-2 py-2">
            {stageSequence.map((stageName, idx) => {
              const status = statuses[idx];
              const checkpoint = checkpoints.find(c => c.stage === stageName && c.status === 'pending');
              const latestApproved = checkpoints.filter(c => c.stage === stageName && c.status === 'approved').at(-1);
              const completedAt = latestApproved?.resolved_at ?? latestApproved?.created_at ?? null;
              return (
                <StageRow
                  key={stageName}
                  stageName={stageName}
                  index={idx}
                  status={status}
                  prevStatus={idx > 0 ? statuses[idx - 1] : undefined}
                  checkpoint={checkpoint}
                  latestApproved={latestApproved}
                  completedAt={completedAt}
                  agentModel={agentModels[stageName]}
                  onViewArtifact={setViewingArtifactId}
                  isLast={idx === stageSequence.length - 1}
                  compact
                />
              );
            })}
          </div>

          {/* Post-completion: code + test pipeline (demo-only) */}
          {isComplete && isDemoMode && (
            <div className="px-2 pb-3">
              <PipelineStatusSection workflowId={activeWorkflow.id} />
            </div>
          )}
        </div>

        {/* Creature lives outside the scrollable area */}
        {!isComplete && <DancingCreature />}
      </div>

      {/* ── Right: event log ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Log header */}
        <div className="flex items-center justify-between h-10 px-4 bg-slate-50 dark:bg-[#161b22] border-b border-slate-200 dark:border-slate-700/60 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="flex-shrink-0 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors font-mono"
            >
              ← back
            </button>
            <span className="text-slate-300 dark:text-slate-700/60 text-xs select-none">│</span>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">
              {activeWorkflow.summary ?? activeWorkflow.goal.split('\n')[0].slice(0, 70)}
            </span>
            {productArea && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400">
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
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowAudit(true)}
              title="Activity — who reviewed each stage"
              className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              activity
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
          </div>
        </div>

        {/* Events */}
        <div className="flex-1 overflow-y-auto px-0 py-2">
          {/* Lifecycle events pinned at the top (collapsible) */}
          {topLifecycleEvents.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setGeneralExpanded(e => !e)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-500 transition-colors text-left"
              >
                <svg
                  className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${generalExpanded ? 'rotate-90' : ''}`}
                  fill="currentColor" viewBox="0 0 6 10"
                >
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                general
                {!generalExpanded && (
                  <span className="ml-1 normal-case tracking-normal font-normal text-slate-300 dark:text-slate-700">
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
            const status = stageIdx >= 0 ? statuses[stageIdx] : 'pending';
            const msgs = eventsByStage.get(stageName) ?? [];
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
              <div key={stageName}>
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
                  <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] text-slate-500 dark:text-slate-600">
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    initialising…
                  </div>
                )}
                {status === 'in-progress' && msgs.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-1 text-[10px] text-teal-600 animate-pulse">
                    <span className="w-1 h-1 rounded-full bg-teal-600" />
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
              <p className="text-sm text-slate-500 dark:text-slate-600 font-mono">workflow initialising…</p>
            </div>
          )}

          {isComplete && (
            <div className="px-4 py-3 space-y-2 border-t border-slate-200 dark:border-slate-800/60 mt-2">
              {/* Completion header row */}
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-2 text-xs font-mono ${isCancelled ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCancelled ? 'bg-red-500' : 'bg-green-500'}`} />
                  {isCancelled ? 'workflow stopped' : 'workflow complete'}
                </div>
                <div className="flex items-center gap-2">
                  {isComplete && (
                    <button
                      onClick={handleRestart}
                      disabled={restarting}
                      className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded border border-teal-400 dark:border-teal-600 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

              {/* Terminal output (demo-only) */}
              {isDemoMode && <DemoProjectSection workflowId={activeWorkflow.id} />}
            </div>
          )}

          {/* Change Requests section (collapsible, pinned at bottom) */}
          {crEvents.length > 0 && (
            <div className="mt-2 mb-1">
              <button
                onClick={() => setCrExpanded(e => !e)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-500 transition-colors text-left"
              >
                <svg
                  className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${crExpanded ? 'rotate-90' : ''}`}
                  fill="currentColor" viewBox="0 0 6 10"
                >
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                change requests
                {!crExpanded && (
                  <span className="ml-1 normal-case tracking-normal font-normal text-slate-300 dark:text-slate-700">
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
          // Group by stage, keep only the latest per stage
          const latestByStage = new Map<string, typeof artifacts[0]>();
          artifacts.forEach(artifact => {
            const stage = artifact.stage ?? 'unknown';
            const existing = latestByStage.get(stage);
            if (!existing || artifact.created_at > existing.created_at) {
              latestByStage.set(stage, artifact);
            }
          });

          // "Tickets" button is for the Epic/Feature shells only (epic_feature_planner).
          // artifact.stage = s.mode (session mode), not the workflow stage name:
          //   epic_feature_planner → mode 'epic_features'
          //   story_decomposition_F* → mode 'backlog' (handled per-feature below instead)
          const TICKET_MODES = new Set(['epic_features']);
          const ticketCandidates = Array.from(latestByStage.values())
            .filter(a => TICKET_MODES.has(a.stage ?? ''))
            .sort((a, b) => b.created_at - a.created_at);
          const ticketArtifact = ticketCandidates[0] ?? null;

          // Per-feature Tickets + QA Tests buttons — one pair per feature, shown once that
          // feature's checkpoint is approved. checkpoints is oldest-first, so a later approval
          // naturally overwrites an earlier one as we walk through.
          const FEATURE_STAGE_RE = /^story_decomposition_F(\d+)$/;
          const FEATURE_QA_STAGE_RE = /^story_decomposition_F(\d+)_qa$/;
          const featureButtonsMap = new Map<number, { num: number; ticketArtifactId?: number; qaArtifactId?: number }>();
          checkpoints.forEach(c => {
            if (c.status !== 'approved' || !c.artifact_id) return;
            const storyMatch = FEATURE_STAGE_RE.exec(c.stage);
            if (storyMatch) {
              const num = parseInt(storyMatch[1], 10);
              featureButtonsMap.set(num, { ...(featureButtonsMap.get(num) ?? { num }), ticketArtifactId: c.artifact_id });
              return;
            }
            const qaMatch = FEATURE_QA_STAGE_RE.exec(c.stage);
            if (qaMatch) {
              const num = parseInt(qaMatch[1], 10);
              featureButtonsMap.set(num, { ...(featureButtonsMap.get(num) ?? { num }), qaArtifactId: c.artifact_id });
            }
          });
          const featureButtons = Array.from(featureButtonsMap.values()).sort((a, b) => a.num - b.num);

          const regularArtifacts = Array.from(latestByStage.values())
            .filter(a => !TICKET_MODES.has(a.stage ?? '') && a.stage !== 'backlog' && a.type !== 'qa_tests');

          const hasArtifacts = regularArtifacts.length > 0 || !!ticketArtifact || featureButtons.length > 0;
          return (
            <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0d1117] px-2 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {regularArtifacts.map((artifact) => {
                  const stageLabel = STAGE_SHORT_LABELS[artifact.stage ?? ''] ?? STAGE_LABELS[artifact.stage ?? ''] ?? artifact.type;
                  return (
                    <button
                      key={artifact.id}
                      onClick={() => setViewingArtifactId(artifact.id)}
                      className="px-2.5 py-1 text-xs font-medium rounded bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
                    >
                      {stageLabel}
                    </button>
                  );
                })}
                {ticketArtifact && (
                  <button
                    onClick={() => setViewingArtifactId(ticketArtifact.id)}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
                  >
                    Epic/Features
                  </button>
                )}
                {featureButtons.map(f => (
                  <span key={f.num} className="inline-flex items-center gap-1">
                    {f.ticketArtifactId && (
                      <button
                        onClick={() => setViewingArtifactId(f.ticketArtifactId!)}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
                      >
                        F{f.num} Tickets
                      </button>
                    )}
                    {f.qaArtifactId && (
                      <button
                        onClick={() => setViewingArtifactId(f.qaArtifactId!)}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 transition-colors"
                      >
                        F{f.num} QA Tests
                      </button>
                    )}
                  </span>
                ))}
                {showCRButton && onShowCRForm && (
                  <>
                    {hasArtifacts && <span className="text-slate-300 dark:text-slate-700 select-none">·</span>}
                    <button
                      onClick={onShowCRForm}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                    >
                      Change Request
                    </button>
                  </>
                )}
                {(pendingDiffCount ?? 0) > 0 && onShowDiffPanel && (
                  <>
                    {(hasArtifacts || (showCRButton && !!onShowCRForm)) && <span className="text-slate-300 dark:text-slate-700 select-none">·</span>}
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

      {showAudit && (
        <AuditTrailPanel workflowId={activeWorkflow.id} onClose={() => setShowAudit(false)} />
      )}
    </div>
  );
}
