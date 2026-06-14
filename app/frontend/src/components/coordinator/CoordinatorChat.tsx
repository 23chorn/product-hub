import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useWorkflowStore, type WorkflowEvent, type WorkflowStatus, type CoordinatorMessage } from '../../stores/workflowStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { ContextDiffPanel } from './ContextDiffPanel';
import { STAGE_LABELS, TOGGLEABLE_STAGES } from '../../constants/stage-labels';
import { stripReadyMarker, extractReadyPayload } from '../../utils/coordinator-helpers';
import { ConversationHeader } from './ConversationHeader';
import { PrototypePreview, type PrototypeData } from './PrototypePreview';
import { api } from '../../services/api';
import { eventToMessage } from '../../utils/event-to-message';
import { ChatInputArea } from './ChatInputArea';
import { PrototypeActions } from './PrototypeActions';
import { ChangeRequestSection } from './ChangeRequestSection';
import { PipelineTerminalView } from '../workflow/PipelineTerminalView';
import { ConversationMessageList } from './ConversationMessageList';
import { StageConfirmationCard } from './StageConfirmationCard';
import { MidWorkflowMessageInput } from './MidWorkflowMessageInput';

export function CoordinatorChat() {
  const {
    activeWorkflow, stageSequence, completedStages, currentStage, pendingStage, checkpoints,
    applyWorkflowStatus, resetWorkflow, setViewingArtifactId,
    planningPhase, planningSessionId,
    setPlanningPhase, setPlanningSessionId,
    coordinatorMessages, addCoordinatorMessage, appendToLastCoordinatorMessage, replaceLastCoordinatorMessage,
    isStreaming, setIsStreaming,
    lastEventId, setLastEventId,
  } = useWorkflowStore();
  const { selectedItem } = useSessionStore();
  const { config } = useConfigStore();

  // Filter stages based on server config (agents/config.yaml enabled_stages)
  const configEnabledStages = config?.stages?.enabledStages;
  const availableStages = TOGGLEABLE_STAGES.filter(
    s => s.key === 'curator' || !configEnabledStages || configEnabledStages[s.key] !== false
  );

  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>(
    () => Object.fromEntries(TOGGLEABLE_STAGES.map(s => [s.key, true]))
  );
  const [pendingLaunchData, setPendingLaunchData] = useState<{ enrichedContext: string; kbQueries: string[] } | null>(null);
  const [stageRationale, setStageRationale] = useState<string | null>(null);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [, setStageStale] = useState(false);
  // Change request state
  const [showCRForm, setShowCRForm] = useState(false);
  const [crType, setCRType] = useState('correction');
  const [crDescription, setCRDescription] = useState('');
  const [crAssessment, setCRAssessment] = useState<{ affected_stages: string[]; summary: string } | null>(null);
  const [crConfirmedStages, setCRConfirmedStages] = useState<Record<string, boolean>>({});
  const [crLoading, setCRLoading] = useState(false);
  const { activeCR, setActiveCR, clearActiveCR } = useWorkflowStore();
  // Prototype state
  const [prototypeData, setPrototypeData] = useState<PrototypeData | null>(null);
  const [showPrototype, setShowPrototype] = useState(false);
  const [animFrame, setAnimFrame] = useState(0);
  const [criticActiveStage, setCriticActiveStage] = useState<string | null>(null);
  const [revisingStage, setRevisingStage] = useState<string | null>(null);
  const [lastActivityMs, setLastActivityMs] = useState(() => Date.now());
  const lastEventTimeRef = useRef(Date.now());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = replyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  const itemId = selectedItem?.id ?? '';
  const hasWorkflow = activeWorkflow !== null;
  const isComplete = activeWorkflow?.status === 'complete';
  const isAtCheckpoint = activeWorkflow?.status === 'paused_at_checkpoint';
  const isGathering = planningPhase === 'gathering';
  const isConfirming = planningPhase === 'confirming';
  const isLaunching = planningPhase === 'launching';

  const { pendingDiffCount, setPendingDiffCount } = useWorkflowStore();

  // When workflow completes, check for existing prototype
  useEffect(() => {
    if (!isComplete || !activeWorkflow) return;
    api.getPrototype(activeWorkflow.id).then(proto => {
      if (proto) setPrototypeData(proto as PrototypeData);
    });
  }, [isComplete, activeWorkflow?.id]);

  // When workflow completes, check for pending context diffs from the curator
  useEffect(() => {
    if (!isComplete) return;
    api.getPendingContextDiffs()
      .then(({ diffs }) => {
        setPendingDiffCount(diffs.length);
        if (diffs.length > 0) setShowDiffPanel(true);
      })
      .catch(() => {});
  }, [isComplete]);

  // Scroll to bottom whenever messages or checkpoint state change
  // Use instant scroll on initial load, smooth for subsequent updates
  const hasInitialScrolled = useRef(false);
  useEffect(() => {
    if (!coordinatorMessages.length) {
      hasInitialScrolled.current = false;
      return;
    }
    const behavior = hasInitialScrolled.current ? 'smooth' : 'instant';
    messagesEndRef.current?.scrollIntoView({ behavior });
    hasInitialScrolled.current = true;
  }, [coordinatorMessages, activeWorkflow?.status, checkpoints, showCRForm, crAssessment]);

  // Track which pending checkpoint we've already auto-opened, to avoid re-opening after user closes
  const autoOpenedCheckpointRef = useRef<number | null>(null);

  // Reset auto-open ref when workflow changes
  useEffect(() => {
    autoOpenedCheckpointRef.current = null;
  }, [activeWorkflow?.id]);

  // ── Auto-open viewer when a pending checkpoint appears ───────────────────
  // Reactive to store state — fires on initial restore (App.tsx), poll updates, or any status change
  useEffect(() => {
    if (activeWorkflow?.status !== 'paused_at_checkpoint') return;
    const pending = checkpoints.find(c => c.status === 'pending');
    if (!pending?.artifact_id) return;
    if (pending.id === autoOpenedCheckpointRef.current) return;
    autoOpenedCheckpointRef.current = pending.id;

    if (pending.stage === 'prototype') {
      // Auto-open the prototype preview
      api.getPrototype(activeWorkflow!.id).then(data => {
        if (data) { setPrototypeData(data as PrototypeData); setShowPrototype(true); }
      }).catch(() => {});
    } else {
      setViewingArtifactId(pending.artifact_id);
    }
  }, [activeWorkflow?.status, activeWorkflow?.id, checkpoints, setViewingArtifactId]);

  // ── Event polling: fetch new workflow events and append narration ────────
  // Use refs for values the poll reads — avoids stale closures without causing effect recreation
  const lastEventIdRef = useRef(lastEventId);
  useEffect(() => { lastEventIdRef.current = lastEventId; }, [lastEventId]);

  const workflowIdRef = useRef(activeWorkflow?.id);
  const planningPhaseRef = useRef(planningPhase);
  useEffect(() => { workflowIdRef.current = activeWorkflow?.id; }, [activeWorkflow?.id]);
  useEffect(() => { planningPhaseRef.current = planningPhase; }, [planningPhase]);

  useEffect(() => {
    const wfId = activeWorkflow?.id;
    if (!wfId || planningPhase !== 'idle') return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      // Read current workflow ID from ref (handles edge case where ID changed)
      const currentId = workflowIdRef.current;
      if (!currentId) return;

      // Check if workflow is complete — stop polling
      const currentWorkflow = useWorkflowStore.getState().activeWorkflow;
      if (currentWorkflow?.status === 'complete') return;

      // 1. Fetch new events
      try {
        const { events } = await api.getWorkflowEvents(currentId, lastEventIdRef.current);

        if (!cancelled && events.length > 0) {
          for (const event of events) {
            if (event.event_type === 'user_input' || event.event_type === 'cos_response') continue;

            const msg = eventToMessage(event);
            if (!msg) continue;

            // Track critic / revision pipeline states
            if (event.event_type === 'stage_progress' && event.stage &&
                event.summary.toLowerCase().includes('quality review')) {
              // Quality review started — critic takes over display; revision window ends
              setCriticActiveStage(event.stage);
              setRevisingStage(null);
            } else if (event.event_type === 'critic_verdict') {
              setCriticActiveStage(null);
              // Auto-revise triggered — mark stage as revising until next review starts
              if (event.summary.includes('Auto-revising')) {
                setRevisingStage(event.stage ?? null);
              } else {
                setRevisingStage(null);
              }
            } else if (event.event_type === 'stage_completed') {
              setRevisingStage(null);
            }

            // Progress events replace the previous progress message (live-updating status line)
            if (event.event_type === 'stage_progress') {
              const messages = useWorkflowStore.getState().coordinatorMessages;
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.role === 'coordinator' && lastMsg.isProgress) {
                replaceLastCoordinatorMessage({ ...msg, isProgress: true });
              } else {
                addCoordinatorMessage({ ...msg, isProgress: true });
              }
            } else {
              addCoordinatorMessage(msg);
            }
          }

          const maxId = Math.max(...events.map((e: WorkflowEvent) => e.id));
          setLastEventId(maxId);
          lastEventIdRef.current = maxId;
          const nowMs = Date.now();
          lastEventTimeRef.current = nowMs;
          setLastActivityMs(nowMs);
          setStageStale(false);
        }
      } catch (err) {
        console.warn('[POLL] Event fetch failed:', err);
      }

      // 2. Always refresh workflow status (independent of events — don't let event errors block status updates)
      try {
        if (cancelled) return;
        const status = await api.getWorkflowStatus(currentId);
        if (cancelled) return;
        applyWorkflowStatus(status);

        // 3. Staleness detection: active workflow with no events for 90s
        // (heartbeat fires every 45s, so 90s means two missed heartbeats — genuinely stuck)
        const wf = status.workflow;
        if (wf.status === 'active' && wf.current_stage) {
          const elapsed = Date.now() - lastEventTimeRef.current;
          setStageStale(elapsed > 90_000);
        } else {
          setStageStale(false);
        }
      } catch (err) {
        console.warn('[POLL] Status fetch failed:', err);
      }
    };

    // Poll immediately, then every 2 seconds for more responsive updates
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeWorkflow?.id, planningPhase]);

  // ── Reconstruct narration from events on page reload ──────────────────────
  useEffect(() => {
    if (!activeWorkflow || coordinatorMessages.length > 0) return;
    if (planningPhase !== 'idle') return;

    api.getWorkflowEvents(activeWorkflow.id).then(({ events }) => {
      const msgs: Array<CoordinatorMessage> = [];
      for (const event of events) {
        if (event.event_type === 'user_input') {
          msgs.push({ role: 'human', content: event.summary, timestamp: event.created_at });
        } else if (event.event_type === 'cos_response') {
          msgs.push({ role: 'coordinator', content: event.summary, timestamp: event.created_at });
        } else if (event.event_type === 'stage_progress') {
          // On replay, collapse progress events — only keep the latest one per stage
          let lastIdx = -1;
          for (let j = msgs.length - 1; j >= 0; j--) { if (msgs[j].isProgress) { lastIdx = j; break; } }
          const progressMsg: CoordinatorMessage = { role: 'coordinator', content: event.summary, timestamp: event.created_at, isProgress: true };
          if (lastIdx >= 0) {
            msgs[lastIdx] = progressMsg;
          } else {
            msgs.push(progressMsg);
          }
        } else {
          // Non-progress event after progress → clear the progress flag so it doesn't get replaced
          const msg = eventToMessage(event);
          if (msg) msgs.push(msg);
        }
      }
      if (msgs.length > 0) {
        const store = useWorkflowStore.getState();
        store.clearCoordinatorMessages();
        msgs.forEach(m => store.addCoordinatorMessage(m));
        const maxId = Math.max(...events.map((e: WorkflowEvent) => e.id));
        store.setLastEventId(maxId);
      }
    }).catch(() => {});
  }, [activeWorkflow?.id]);

  // ── Pipeline animation clock ──────────────────────────────────────────────
  useEffect(() => {
    if (!hasWorkflow || planningPhase !== 'idle' || isComplete || isAtCheckpoint) return;
    const t = setInterval(() => setAnimFrame(f => (f + 1) % 40), 120);
    return () => clearInterval(t);
  }, [hasWorkflow, planningPhase, isComplete, isAtCheckpoint]);

  // ── Submit goal → open coordinator planning session ───────────────────────
  // ── Reply to coordinator / mid-workflow message ─────────────────────────
  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || isStreaming) return;
    const message = reply.trim();
    setReply('');
    if (replyRef.current) replyRef.current.style.height = 'auto';
    setError(null);
    setIsStreaming(true);

    addCoordinatorMessage({ role: 'human', content: message, timestamp: Date.now() });
    addCoordinatorMessage({ role: 'coordinator', content: '', timestamp: Date.now() });

    // Mid-workflow message
    if (hasWorkflow && planningPhase === 'idle') {
      try {
        await api.sendWorkflowMessage(
          activeWorkflow!.id,
          message,
          (chunk) => appendToLastCoordinatorMessage(chunk),
          (_fullContent) => { setIsStreaming(false); },
          (err) => { setError(err); setIsStreaming(false); }
        );
      } catch (err: any) {
        setError(err.message ?? 'Failed to send message');
        setIsStreaming(false);
      }
      return;
    }

    // Pre-workflow planning reply
    if (!planningSessionId) return;
    try {
      await api.replyToCoordinator(
        planningSessionId,
        message,
        (chunk) => appendToLastCoordinatorMessage(chunk),
        (fullContent) => {
          setIsStreaming(false);
          const payload = extractReadyPayload(fullContent);
          if (payload.enrichedContext) handleCoordinatorReady(payload.enrichedContext, payload.kbQueries, payload.recommendedStages, payload.stageRationale);
        },
        (err) => { setError(err); setIsStreaming(false); },
        undefined,
        (cleaned) => replaceLastCoordinatorMessage(cleaned),
      );
    } catch (err: any) {
      setError(err.message ?? 'Failed to send reply');
      setIsStreaming(false);
    }
  }

  // ── Called when COORDINATOR_READY is received — enter confirming phase ──────
  function handleCoordinatorReady(enrichedContext: string, kbQueries: string[] = [], recommendedStages: string[] | null = null, rationale: string | null = null) {
    // Apply recommended stages if provided; otherwise keep all stages enabled
    if (recommendedStages && recommendedStages.length > 0) {
      const recommended = new Set(recommendedStages);
      setEnabledStages(Object.fromEntries(
        availableStages.map(s => [s.key, recommended.has(s.key)])
      ));
    } else {
      setEnabledStages(Object.fromEntries(availableStages.map(s => [s.key, true])));
    }
    setStageRationale(rationale);
    setPendingLaunchData({ enrichedContext, kbQueries });
    setPlanningPhase('confirming');
  }

  // ── Launch workflow after user confirms stages ────────────────────────────
  async function handleLaunchWorkflow(originalGoal: string, enrichedContext: string, kbQueries: string[] = []) {
    setPlanningPhase('launching');
    try {
      const selectedStages = availableStages.filter(s => enabledStages[s.key]).map(s => s.key);
      const result = await api.startWorkflow(itemId || undefined, originalGoal, enrichedContext, selectedStages, undefined, planningSessionId, kbQueries);
      const status = await api.getWorkflowStatus(result.workflowId);
      applyWorkflowStatus(status);
      setPlanningPhase('idle');
      setPlanningSessionId(null);
      localStorage.removeItem('coordinatorPlanningSessionId');

      addCoordinatorMessage({
        role: 'coordinator',
        content: `Workflow started. Running ${status.workflow.stage_sequence ? JSON.parse(status.workflow.stage_sequence).length : '?'} stages autonomously. I'll keep you updated.`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to start workflow');
      setPlanningPhase('gathering');
    }
  }

  // ── Find artifacts for "View output" buttons ──────────────────────────────
  function getArtifactForStage(stage: string): number | null {
    // Use the latest checkpoint for this stage (last in array) — not the first,
    // which may be an outdated revision.
    const cp = checkpoints
      .filter(c => c.stage === stage && c.artifact_id)
      .at(-1);
    return cp?.artifact_id ?? null;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // ── Conversation view (planning, active workflow, or complete) ──────────
  const rawGoal = activeWorkflow?.goal.includes('\n\n[Coordinator context]\n\n')
    ? activeWorkflow.goal.split('\n\n[Coordinator context]\n\n')[0]
    : activeWorkflow?.goal;
  const displayGoal = activeWorkflow?.summary || rawGoal;

  // The user's original goal is the first human message in the planning
  // conversation — used to launch the workflow from the confirm screen.
  const plannedGoal = coordinatorMessages.find((m) => m.role === 'human')?.content ?? '';

  // Input only shown during coordinator planning Q&A
  const showInput = !isLaunching && !isConfirming && isGathering;
  // Mid-workflow message is available but collapsed by default
  const showMidWorkflowToggle = hasWorkflow && !isComplete && !isGathering && !isLaunching;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <ConversationHeader
        isComplete={isComplete}
        isLaunching={isLaunching}
        isGathering={isGathering}
        isAtCheckpoint={isAtCheckpoint}
        hasWorkflow={hasWorkflow}
        currentStage={currentStage}
        displayGoal={displayGoal}
        itemId={activeWorkflow?.item_id}
        estimatedCost={activeWorkflow?.estimated_cost}
        totalStages={stageSequence.length}
        completedCount={completedStages.length}
        onCancel={resetWorkflow}
        stageSequence={stageSequence}
        completedStages={completedStages}
        pendingStage={pendingStage}
        workflowStatus={activeWorkflow?.status}
        animFrame={animFrame}
        criticActiveStage={criticActiveStage}
        revisingStage={revisingStage}
        lastActivityMs={lastActivityMs}
      />

      {/* ── Active workflow: terminal pipeline view ── */}
      {hasWorkflow && planningPhase === 'idle' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <PipelineTerminalView
            coordinatorMessages={coordinatorMessages}
            isRunning={!isComplete}
            onCheckpointResolved={(result: { workflow: WorkflowStatus; status: string; warning?: string }) => {
              applyWorkflowStatus(result.workflow);
              addCoordinatorMessage({
                role: 'coordinator',
                content: result.status === 'approved'
                  ? `Stage approved — moving to next step.`
                  : result.status === 'rejected'
                  ? `Stage rejected — workflow ended.`
                  : `Revision requested.`,
                timestamp: Date.now(),
              });
            }}
            onBack={() => { localStorage.removeItem('coordinatorPlanningSessionId'); resetWorkflow(); }}
          />

          {/* Completion / CR / streaming footer */}
          {(isComplete || isStreaming || showDiffPanel) && (
            <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800/60 bg-white dark:bg-[#0d1117] px-4 py-3 space-y-3 max-h-72 overflow-y-auto">
              {/* Active streaming message */}
              {isStreaming && (() => {
                const lastMsg = coordinatorMessages[coordinatorMessages.length - 1];
                if (!lastMsg || lastMsg.role !== 'coordinator' || lastMsg.eventType || lastMsg.isProgress) return null;
                const content = stripReadyMarker(lastMsg.content);
                if (!content) return (
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                    thinking…
                  </div>
                );
                return (
                  <div className="rounded border border-slate-700/40 bg-slate-800/30 px-3 py-2 text-xs font-sans">
                    <div className="prose prose-xs dark:prose-invert max-w-none [&_p]:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
                    </div>
                  </div>
                );
              })()}

              {/* Context diff panel */}
              {showDiffPanel && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
                  <ContextDiffPanel onClose={() => {
                    setShowDiffPanel(false);
                    api.getPendingContextDiffs().then(({ diffs }) => setPendingDiffCount(diffs.length)).catch(() => {});
                  }} />
                </div>
              )}

              {/* Completion actions */}
              {isComplete && (
                <div className="space-y-3">
                  {pendingDiffCount > 0 && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => setShowDiffPanel(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors font-sans"
                      >
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">{pendingDiffCount}</span>
                        Review Context Updates
                      </button>
                    </div>
                  )}
                  {!showCRForm && !crAssessment && (
                    <PrototypeActions
                      prototypeData={prototypeData}
                      onShowCRForm={() => setShowCRForm(true)}
                      onViewPrototype={() => setShowPrototype(true)}
                    />
                  )}
                  <ChangeRequestSection
                    showForm={showCRForm}
                    crType={crType}
                    onCRTypeChange={setCRType}
                    crDescription={crDescription}
                    onCRDescriptionChange={setCRDescription}
                    crAssessment={crAssessment && activeCR ? crAssessment : null}
                    crConfirmedStages={crConfirmedStages}
                    onToggleConfirmedStage={(stage) => setCRConfirmedStages(prev => ({ ...prev, [stage]: !prev[stage] }))}
                    crLoading={crLoading}
                    onSubmitAssess={async () => {
                      if (!crDescription.trim() || !activeWorkflow) return;
                      setCRLoading(true); setError(null);
                      try {
                        const cr = await api.createChangeRequest(activeWorkflow.id, crType, crDescription.trim());
                        setActiveCR({ id: cr.id, status: cr.status });
                        addCoordinatorMessage({ role: 'coordinator', content: '', timestamp: Date.now() });
                        setIsStreaming(true);
                        await api.assessChangeRequest(
                          cr.id,
                          (text: string) => appendToLastCoordinatorMessage(text),
                          (a: { affected_stages: string[]; summary: string }) => {
                            const affected = a.affected_stages ?? [];
                            setCRAssessment({ affected_stages: affected, summary: a.summary ?? '' });
                            setCRConfirmedStages(Object.fromEntries(affected.map((s: string) => [s, true])));
                            replaceLastCoordinatorMessage({ role: 'coordinator', content: a.summary ?? '', timestamp: Date.now() });
                          },
                          () => { setIsStreaming(false); setCRLoading(false); },
                          (err: string) => setError(err),
                        );
                      } catch (err: any) {
                        setError(err.response?.data?.error ?? err.message ?? 'Failed to assess'); setCRLoading(false);
                      }
                    }}
                    onApplyChanges={async () => {
                      if (!activeCR || !activeWorkflow) return;
                      setCRLoading(true); setError(null);
                      const confirmedList = Object.entries(crConfirmedStages).filter(([, v]) => v).map(([k]) => k);
                      try {
                        const result = await api.executeChangeRequest(activeCR.id, confirmedList);
                        applyWorkflowStatus(result);
                        clearActiveCR(); setCRAssessment(null); setCRConfirmedStages({}); setCRDescription(''); setCRType('correction'); setShowCRForm(false);
                        addCoordinatorMessage({ role: 'coordinator', content: `Change request applied to: ${confirmedList.map((s: string) => STAGE_LABELS[s] ?? s).join(', ')}.`, timestamp: Date.now() });
                      } catch (err: any) {
                        setError(err.response?.data?.error ?? err.message ?? 'Failed to execute');
                      } finally { setCRLoading(false); }
                    }}
                    onCancel={() => { clearActiveCR(); setCRAssessment(null); setCRConfirmedStages({}); setCRDescription(''); setCRType('correction'); setShowCRForm(false); }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Planning / confirming / launching: conversation messages ── */}
      {(!hasWorkflow || planningPhase !== 'idle') && (
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-2">
        {(isGathering || isConfirming || isLaunching) && (
          <ConversationMessageList
            coordinatorMessages={coordinatorMessages}
            isStreaming={isStreaming}
            getArtifactForStage={getArtifactForStage}
            onViewArtifact={setViewingArtifactId}
          />
        )}

        {/* Stage confirmation card — shown after coordinator signals ready */}
        {isConfirming && pendingLaunchData && (
          <StageConfirmationCard
            availableStages={availableStages}
            enabledStages={enabledStages}
            onToggleStage={(key) => setEnabledStages(prev => ({ ...prev, [key]: !prev[key] }))}
            stageRationale={stageRationale}
            onLaunch={() => handleLaunchWorkflow(plannedGoal, pendingLaunchData.enrichedContext, pendingLaunchData.kbQueries)}
          />
        )}


        {/* Context Diff Review Panel (planning branch) */}
        {showDiffPanel && (!hasWorkflow || planningPhase !== 'idle') && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
            <ContextDiffPanel onClose={() => {
              setShowDiffPanel(false);
              api.getPendingContextDiffs()
                .then(({ diffs }) => setPendingDiffCount(diffs.length))
                .catch(() => {});
            }} />
          </div>
        )}

        {/* Completion: reiteration options (planning branch — normally idle uses terminal footer) */}
        {isComplete && (!hasWorkflow || planningPhase !== 'idle') && (
          <div className="pt-4 space-y-3">
            {/* Context updates button */}
            {pendingDiffCount > 0 && (
              <div className="flex justify-center">
                <button
                  onClick={() => setShowDiffPanel(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">
                    {pendingDiffCount}
                  </span>
                  Review Context Updates
                </button>
              </div>
            )}
            {/* Change Request + Prototype buttons */}
            {!showCRForm && !crAssessment && (
              <PrototypeActions
                prototypeData={prototypeData}
                onShowCRForm={() => setShowCRForm(true)}
                onViewPrototype={() => setShowPrototype(true)}
              />
            )}

            {/* CR form + assessment */}
            <ChangeRequestSection
              showForm={showCRForm}
              crType={crType}
              onCRTypeChange={setCRType}
              crDescription={crDescription}
              onCRDescriptionChange={setCRDescription}
              crAssessment={crAssessment && activeCR ? crAssessment : null}
              crConfirmedStages={crConfirmedStages}
              onToggleConfirmedStage={(stage) => setCRConfirmedStages(prev => ({ ...prev, [stage]: !prev[stage] }))}
              crLoading={crLoading}
              onSubmitAssess={async () => {
                if (!crDescription.trim() || !activeWorkflow) return;
                setCRLoading(true);
                setError(null);
                try {
                  const cr = await api.createChangeRequest(activeWorkflow.id, crType, crDescription.trim());
                  setActiveCR({ id: cr.id, status: cr.status });

                  addCoordinatorMessage({
                    role: 'coordinator',
                    content: '',
                    timestamp: Date.now(),
                  });
                  setIsStreaming(true);
                  await api.assessChangeRequest(
                    cr.id,
                    (chunk) => appendToLastCoordinatorMessage(chunk),
                    (assessment) => {
                      setCRAssessment(assessment);
                      setCRConfirmedStages(
                        Object.fromEntries(assessment.affected_stages.map(s => [s, true]))
                      );
                      setActiveCR({ id: cr.id, status: 'assessed', impactAssessment: assessment });
                    },
                    () => setIsStreaming(false),
                    (err) => { setError(err); setIsStreaming(false); },
                    (cleaned) => replaceLastCoordinatorMessage(cleaned),
                  );
                  setShowCRForm(false);
                } catch (err: any) {
                  setError(err.response?.data?.error ?? err.message ?? 'Failed to create change request');
                } finally {
                  setCRLoading(false);
                }
              }}
              onApplyChanges={async () => {
                const stages = Object.entries(crConfirmedStages)
                  .filter(([, v]) => v)
                  .map(([k]) => k);
                if (stages.length === 0 || !activeWorkflow || !activeCR) return;
                setCRLoading(true);
                setError(null);
                try {
                  await api.executeChangeRequest(activeCR.id, stages);
                  const result = await api.getWorkflowStatus(activeWorkflow.id);
                  applyWorkflowStatus(result);
                  addCoordinatorMessage({
                    role: 'coordinator',
                    content: `Applying changes to ${stages.map(s => STAGE_LABELS[s] ?? s).join(', ')}. Checkpoints will appear for review.`,
                    timestamp: Date.now(),
                  });
                  setCRAssessment(null);
                  setCRConfirmedStages({});
                  setCRDescription('');
                } catch (err: any) {
                  setError(err.response?.data?.error ?? err.message ?? 'Failed to execute change request');
                } finally {
                  setCRLoading(false);
                }
              }}
              onCancel={async () => {
                if (crAssessment && activeCR) {
                  try { await api.cancelChangeRequest(activeCR.id); } catch { /* ignore */ }
                  setCRAssessment(null);
                  setCRConfirmedStages({});
                  setCRDescription('');
                  clearActiveCR();
                } else {
                  setShowCRForm(false);
                  setCRDescription('');
                  setCRType('correction');
                }
              }}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      </div>
      )}{/* end planning/confirming/launching messages */}

      {/* Planning input — only shown during coordinator Q&A */}
      {showInput && (
        <ChatInputArea
          reply={reply}
          onReplyChange={setReply}
          isStreaming={isStreaming}
          error={error}
          onClearError={() => setError(null)}
          onSubmit={handleSendReply}
          textareaRef={replyRef}
          onAutoResize={autoResize}
          hasWorkflow={hasWorkflow}
        />
      )}

      {/* Mid-workflow: collapsed "Message coordinator" toggle */}
      {showMidWorkflowToggle && (
        <MidWorkflowMessageInput
          reply={reply}
          onReplyChange={setReply}
          isStreaming={isStreaming}
          error={error}
          onClearError={() => setError(null)}
          onSubmit={handleSendReply}
          textareaRef={replyRef}
          onAutoResize={autoResize}
        />
      )}

      {/* Error display when no input is visible */}
      {error && !showInput && !showMidWorkflowToggle && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 flex-shrink-0">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-slate-400 hover:text-slate-600">✕</button>
        </div>
      )}
      {/* Prototype preview overlay */}
      {showPrototype && prototypeData && (
        <PrototypePreview
          prototype={prototypeData}
          workflowId={activeWorkflow!.id}
          onClose={() => setShowPrototype(false)}
          onUpdate={(updated) => setPrototypeData(updated)}
        />
      )}
    </div>
  );
}
