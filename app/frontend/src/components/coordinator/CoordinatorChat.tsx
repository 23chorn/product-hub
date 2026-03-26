import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useWorkflowStore, type WorkflowEvent, type CoordinatorMessage } from '../../stores/workflowStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useConfigStore } from '../../stores/configStore';
import { ContextDiffPanel } from './ContextDiffPanel';
import { STAGE_LABELS, TOGGLEABLE_STAGES } from '../../constants/stage-labels';
import { stripReadyMarker, extractReadyPayload, parseCriticData, criticSummaryLine } from '../../utils/coordinator-helpers';
import { InlineCheckpointActions } from './InlineCheckpointActions';
import { ConversationHeader } from './ConversationHeader';
import { PrototypePreview, type PrototypeData } from './PrototypePreview';
import { api } from '../../services/api';
import { eventToMessage } from '../../utils/event-to-message';
import { ChatInputArea } from './ChatInputArea';
import { GoalEntryScreen } from './GoalEntryScreen';
import { PrototypeActions } from './PrototypeActions';
import { ChangeRequestSection } from './ChangeRequestSection';
import { ExtendStagesPanel } from './ExtendStagesPanel';

export function CoordinatorChat() {
  const {
    activeWorkflow, stageSequence, completedStages, currentStage, checkpoints,
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

  const [goal, setGoal] = useState('');
  const [pendingGoal, setPendingGoal] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>(
    () => Object.fromEntries(TOGGLEABLE_STAGES.map(s => [s.key, true]))
  );
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [stageStale, setStageStale] = useState(false);
  // Change request state
  const [showCRForm, setShowCRForm] = useState(false);
  const [crType, setCRType] = useState('correction');
  const [crDescription, setCRDescription] = useState('');
  const [crAssessment, setCRAssessment] = useState<{ affected_stages: string[]; summary: string } | null>(null);
  const [crConfirmedStages, setCRConfirmedStages] = useState<Record<string, boolean>>({});
  const [crLoading, setCRLoading] = useState(false);
  const { activeCR, setActiveCR, clearActiveCR } = useWorkflowStore();
  const [retryLoading, setRetryLoading] = useState(false);
  // Prototype state
  const [prototypeData, setPrototypeData] = useState<PrototypeData | null>(null);
  const [protoLoading, setProtoLoading] = useState(false);
  const [showPrototype, setShowPrototype] = useState(false);
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
          lastEventTimeRef.current = Date.now();
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

        // 3. Staleness detection: active workflow with no events for 3+ minutes
        const wf = status.workflow;
        if (wf.status === 'active' && wf.current_stage) {
          const elapsed = Date.now() - lastEventTimeRef.current;
          setStageStale(elapsed > 3 * 60 * 1000);
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

  // ── Submit goal → open coordinator planning session ───────────────────────
  async function handleSubmitGoal(e: React.FormEvent) {
    e.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || isStreaming) return;
    setError(null);
    setPendingGoal(trimmedGoal);
    setGoal('');
    setPlanningPhase('gathering');
    setIsStreaming(true);

    addCoordinatorMessage({ role: 'human', content: trimmedGoal, timestamp: Date.now() });
    addCoordinatorMessage({ role: 'coordinator', content: '', timestamp: Date.now() });

    try {
      await api.openCoordinatorPlanning(
        trimmedGoal,
        (sessionId) => { setPlanningSessionId(sessionId); localStorage.setItem('coordinatorPlanningSessionId', sessionId); },
        (chunk) => appendToLastCoordinatorMessage(chunk),
        (fullContent) => {
          setIsStreaming(false);
          const payload = extractReadyPayload(fullContent);
          if (payload.enrichedContext) handleLaunchWorkflow(trimmedGoal, payload.enrichedContext, payload.kbQueries);
        },
        (err) => { setError(err); setIsStreaming(false); },
        undefined,
        (cleaned) => replaceLastCoordinatorMessage(cleaned),
      );
    } catch (err: any) {
      setError(err.message ?? 'Failed to contact coordinator');
      setIsStreaming(false);
      setPlanningPhase('idle');
    }
  }

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
          if (payload.enrichedContext) handleLaunchWorkflow(pendingGoal, payload.enrichedContext, payload.kbQueries);
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

  // ── Launch workflow after coordinator signals ready ───────────────────────
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

  // Goal entry form (idle, no workflow, no planning)
  if (!hasWorkflow && !isGathering && !isLaunching) {
    return (
      <GoalEntryScreen
        goal={goal}
        onGoalChange={setGoal}
        onSubmitGoal={handleSubmitGoal}
        availableStages={availableStages}
        enabledStages={enabledStages}
        onToggleStage={(key) => setEnabledStages(prev => ({ ...prev, [key]: !prev[key] }))}
        error={error}
        isStreaming={isStreaming}
      />
    );
  }

  // ── Conversation view (planning, active workflow, or complete) ──────────
  const rawGoal = activeWorkflow?.goal.includes('\n\n[Coordinator context]\n\n')
    ? activeWorkflow.goal.split('\n\n[Coordinator context]\n\n')[0]
    : activeWorkflow?.goal;
  const displayGoal = activeWorkflow?.summary || rawGoal;

  const showInput = !isLaunching && (
    isGathering ||
    (hasWorkflow && !isComplete)
  );

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
        onCancel={resetWorkflow}
      />

      {/* Conversation messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {coordinatorMessages.map((msg, i) => {
          const isCoordinator = msg.role === 'coordinator';
          const displayContent = isCoordinator ? stripReadyMarker(msg.content) : msg.content;
          const isLast = i === coordinatorMessages.length - 1;
          const isEmptyStreaming = isCoordinator && displayContent === '' && isStreaming && isLast;

          // Progress messages render as a compact, updating status line
          if (msg.isProgress) {
            return (
              <div key={i} className="flex justify-start">
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {displayContent}
                </div>
              </div>
            );
          }

          return (
            <div key={i} className={`flex ${isCoordinator ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                isCoordinator
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  : 'bg-blue-600 text-white'
              }`}>
                {isEmptyStreaming ? (
                  <span className="text-gray-400 dark:text-gray-500 animate-pulse text-xs">thinking...</span>
                ) : isCoordinator ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{displayContent}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{displayContent}</p>
                )}
              </div>
            </div>
          );
        })}

        {/* View output buttons for completed stages */}
        {hasWorkflow && completedStages.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {completedStages.map(stage => {
              const artifactId = getArtifactForStage(stage);
              if (!artifactId) return null;
              return (
                <button
                  key={stage}
                  onClick={() => setViewingArtifactId(artifactId)}
                  className="text-xs px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  View {STAGE_LABELS[stage] ?? stage}
                </button>
              );
            })}
          </div>
        )}

        {/* Checkpoint action buttons inline in conversation */}
        {isAtCheckpoint && (() => {
          const pending = checkpoints.find(c => c.status === 'pending');
          if (!pending) return null;
          const pendingCriticData = parseCriticData(pending);
          const summary = criticSummaryLine(pendingCriticData);

          // Prototype checkpoint: show View Prototype button + inline actions
          if (pending.stage === 'prototype') {
            return (
              <div className="pt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const data = await api.getPrototype(activeWorkflow!.id);
                        setPrototypeData(data);
                        setShowPrototype(true);
                      } catch {
                        // prototype may still be generating; ignore
                      }
                    }}
                    className="text-xs px-2.5 py-1 rounded-md border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                  >
                    View Prototype
                  </button>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Review the prototype, then approve, revise, or reject below
                  </span>
                </div>
                <InlineCheckpointActions
                  checkpoint={pending}
                  onResolved={(result) => {
                    applyWorkflowStatus(result.workflow);
                    addCoordinatorMessage({
                      role: 'coordinator',
                      content: `Prototype **${result.status === 'approved' ? 'approved' : result.status === 'rejected' ? 'rejected' : 'sent for revision'}.${result.complete ? ' Workflow complete.' : ''}`,
                      timestamp: Date.now(),
                    });
                  }}
                />
              </div>
            );
          }

          if (pending.artifact_id) {
            return (
              <div className="pt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewingArtifactId(pending.artifact_id!)}
                    className="text-xs px-2.5 py-1 rounded-md border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  >
                    Review output
                  </button>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Approve, revise, or reject from the artifact viewer
                  </span>
                </div>
                {summary && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic pl-0.5">{summary}</p>
                )}
              </div>
            );
          }
          // No artifact — show inline approve/reject buttons
          return (
            <InlineCheckpointActions
              checkpoint={pending}
              onResolved={(result) => {
                applyWorkflowStatus(result.workflow);
                addCoordinatorMessage({
                  role: 'coordinator',
                  content: `Checkpoint **${STAGE_LABELS[pending.stage] ?? pending.stage}** ${result.status === 'approved' ? 'approved' : result.status === 'rejected' ? 'rejected' : 'sent for revision'}.${result.complete ? ' Workflow complete.' : ''}`,
                  timestamp: Date.now(),
                });
              }}
            />
          );
        })()}

        {/* Retry button for stuck stages */}
        {stageStale && !isAtCheckpoint && activeWorkflow && currentStage && (
          <div className="flex items-center gap-3 pt-2 pb-1">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span className="text-xs text-amber-700 dark:text-amber-400">
                {STAGE_LABELS[currentStage] ?? currentStage} appears to be stuck — no activity for 3+ minutes
              </span>
              <button
                onClick={async () => {
                  setRetryLoading(true);
                  try {
                    const result = await api.retryWorkflowStage(activeWorkflow.id);
                    applyWorkflowStatus(result);
                    lastEventTimeRef.current = Date.now();
                    setStageStale(false);
                    addCoordinatorMessage({
                      role: 'coordinator',
                      content: `Retrying **${STAGE_LABELS[currentStage] ?? currentStage}**...`,
                      timestamp: Date.now(),
                    });
                  } catch (err: any) {
                    setError(err.response?.data?.error ?? err.message ?? 'Retry failed');
                  } finally {
                    setRetryLoading(false);
                  }
                }}
                disabled={retryLoading}
                className="text-xs px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium transition-colors flex-shrink-0"
              >
                {retryLoading ? 'Retrying...' : 'Retry Stage'}
              </button>
            </div>
          </div>
        )}

        {/* Context Diff Review Panel */}
        {showDiffPanel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
            <ContextDiffPanel onClose={() => {
              setShowDiffPanel(false);
              // Refresh count after reviewing
              api.getPendingContextDiffs()
                .then(({ diffs }) => setPendingDiffCount(diffs.length))
                .catch(() => {});
            }} />
          </div>
        )}

        {/* Completion: reiteration options */}
        {isComplete && (
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
                protoLoading={protoLoading}
                onShowCRForm={() => setShowCRForm(true)}
                onViewPrototype={() => setShowPrototype(true)}
                onGeneratePrototype={async () => {
                  if (!activeWorkflow) return;
                  setProtoLoading(true);
                  addCoordinatorMessage({
                    role: 'coordinator',
                    content: '',
                    timestamp: Date.now(),
                  });
                  setIsStreaming(true);
                  try {
                    await api.generatePrototype(activeWorkflow.id, undefined, {
                      onContent: (text) => appendToLastCoordinatorMessage(text),
                      onPrototype: (proto) => {
                        setPrototypeData(proto);
                        setShowPrototype(true);
                      },
                      onError: (err) => setError(err),
                      onDone: () => {
                        setIsStreaming(false);
                        setProtoLoading(false);
                      },
                    });
                  } catch (err: any) {
                    setError(err.message ?? 'Failed to generate prototype');
                    setIsStreaming(false);
                    setProtoLoading(false);
                  }
                }}
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

            {/* Add stages panel */}
            <ExtendStagesPanel
              stageSequence={stageSequence}
              availableStages={availableStages}
              onExtend={async (orderedStages) => {
                if (!activeWorkflow) return;
                setError(null);
                try {
                  const result = await api.extendWorkflow(activeWorkflow.id, orderedStages);
                  applyWorkflowStatus(result);
                  const labels = orderedStages.map(k => STAGE_LABELS[k] ?? k).join(', ');
                  addCoordinatorMessage({
                    role: 'coordinator',
                    content: `Added ${labels} to the workflow. Running now.`,
                    timestamp: Date.now(),
                  });
                } catch (err: any) {
                  setError(err.response?.data?.error ?? err.message ?? 'Failed to extend workflow');
                }
              }}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
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
