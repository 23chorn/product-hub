import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useWorkflowStore, type WorkflowEvent, type WorkflowStatus, type CoordinatorMessage } from '../../stores/workflowStore';
import { ContextDiffPanel } from './ContextDiffPanel';
import { STAGE_LABELS } from '../../constants/stage-labels';
import { stripReadyMarker } from '../../utils/coordinator-helpers';
import { ConversationHeader } from './ConversationHeader';
import { PrototypePreview, type PrototypeData } from './PrototypePreview';
import { api } from '../../services/api';
import { eventToMessage, lastProgressIndexForStage } from '../../utils/event-to-message';
import { ChangeRequestSection } from './ChangeRequestSection';
import { PipelineTerminalView } from '../workflow/PipelineTerminalView';

export function CoordinatorChat() {
  const {
    activeWorkflow, stageSequence, completedStages, currentStage, pendingStage, checkpoints,
    applyWorkflowStatus, resetWorkflow, setViewingArtifactId,
    planningPhase,
    coordinatorMessages, addCoordinatorMessage, appendToLastCoordinatorMessage, replaceLastCoordinatorMessage, upsertProgressMessage,
    isStreaming, setIsStreaming,
    lastEventId, setLastEventId,
  } = useWorkflowStore();

  const [error, setError] = useState<string | null>(null);
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

            // Progress events update this stage's live status line in place (keyed by
            // stage, so parallel feature refinements each keep their own line).
            if (event.event_type === 'stage_progress') {
              upsertProgressMessage({ ...msg, isProgress: true });
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
        if (event.event_type === 'stage_progress') {
          // On replay, collapse progress events to the latest one *per stage* — so a
          // parallel feature wave restores one live line per feature, not a single shared one.
          const stage = event.stage ?? undefined;
          const lastIdx = lastProgressIndexForStage(msgs, stage);
          const progressMsg: CoordinatorMessage = { role: 'coordinator', content: event.summary, timestamp: event.created_at, isProgress: true, stage };
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

  // ── Render ────────────────────────────────────────────────────────────────

  const rawGoal = activeWorkflow?.goal.includes('\n\n[Coordinator context]\n\n')
    ? activeWorkflow.goal.split('\n\n[Coordinator context]\n\n')[0]
    : activeWorkflow?.goal;
  const displayGoal = activeWorkflow?.summary || rawGoal;

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
            showCRButton={isComplete && !showCRForm && !crAssessment}
            onShowCRForm={() => setShowCRForm(true)}
            pendingDiffCount={pendingDiffCount}
            onShowDiffPanel={() => setShowDiffPanel(true)}
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

          {/* Streaming footer — only shown while coordinator is generating */}
          {isStreaming && (() => {
            const lastMsg = coordinatorMessages[coordinatorMessages.length - 1];
            if (!lastMsg || lastMsg.role !== 'coordinator' || lastMsg.eventType || lastMsg.isProgress) return null;
            const content = stripReadyMarker(lastMsg.content);
            return (
              <div className="flex-shrink-0 border-t border-surface-200 dark:border-surface-800/60 bg-white dark:bg-[#0d1117] px-4 py-3">
                {!content ? (
                  <div className="flex items-center gap-2 text-[10px] text-surface-500 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                    thinking…
                  </div>
                ) : (
                  <div className="rounded border border-surface-700/40 bg-surface-800/30 px-3 py-2 text-xs font-sans">
                    <div className="prose prose-xs dark:prose-invert max-w-none [&_p]:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Context diff panel — fixed overlay, mounts at component level */}
          {showDiffPanel && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
              <ContextDiffPanel onClose={() => {
                setShowDiffPanel(false);
                api.getPendingContextDiffs().then(({ diffs }) => setPendingDiffCount(diffs.length)).catch(() => {});
              }} />
            </div>
          )}

          {/* Change request form/assessment — fixed overlay, always mounted */}
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

      {/* Error display */}
      {error && (
        <div className="border-t border-surface-200 dark:border-surface-700 px-4 py-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 flex-shrink-0">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-surface-400 hover:text-surface-600">✕</button>
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
