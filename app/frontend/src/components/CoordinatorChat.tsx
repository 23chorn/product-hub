import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useWorkflowStore, type WorkflowEvent, type CoordinatorMessage } from '../stores/workflowStore';
import { useSessionStore } from '../stores/sessionStore';
import { api } from '../services/api';

const STAGE_LABELS: Record<string, string> = {
  analyst:            'Analyst (Sage)',
  pm_prd:             'PM Strategy (Rex)',
  solution_architect: 'Architect (Atlas)',
  pm_backlog:         'Backlog Agent (Pip)',
  critic:             'Critic',
  curator:            'Context Curator',
};

// Stages available for user toggle at workflow start (order matters)
const TOGGLEABLE_STAGES: Array<{ key: string; label: string; short: string }> = [
  { key: 'analyst',            label: 'Research',     short: 'Research' },
  { key: 'pm_prd',             label: 'PRD',          short: 'PRD' },
  { key: 'solution_architect', label: 'Architecture', short: 'Arch' },
  { key: 'pm_backlog',         label: 'Backlog',      short: 'Backlog' },
  { key: 'curator',            label: 'Context Update', short: 'Context' },
];

// Strip the COORDINATOR_READY marker from displayed coordinator text
function stripReadyMarker(text: string): string {
  return text.replace(/\n*COORDINATOR_READY\s*\n\{[\s\S]*?\}\s*$/, '').trimEnd();
}

// Extract enriched_context JSON from a coordinator message, or return null
function extractEnrichedContext(text: string): string | null {
  const match = text.match(/COORDINATOR_READY\s*\n(\{[\s\S]*?\})\s*$/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed.enriched_context ?? null;
  } catch {
    return null;
  }
}

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

  const [goal, setGoal] = useState('');
  const [pendingGoal, setPendingGoal] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reiterateStage, setReiterateStage] = useState<string | null>(null);
  const [reiterateFeedback, setReiterateFeedback] = useState('');
  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>(
    () => Object.fromEntries(TOGGLEABLE_STAGES.map(s => [s.key, true]))
  );

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

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [coordinatorMessages]);

  // Track which pending checkpoint we've already auto-opened, to avoid re-opening after user closes
  const autoOpenedCheckpointRef = useRef<number | null>(null);

  // Reset auto-open ref when workflow changes
  useEffect(() => {
    autoOpenedCheckpointRef.current = null;
  }, [activeWorkflow?.id]);

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

      try {
        // 1. Fetch new events
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
        }

        // 2. Always refresh workflow status
        if (cancelled) return;
        const status = await api.getWorkflowStatus(currentId);
        if (cancelled) return;
        applyWorkflowStatus(status);

        // 3. Auto-open artifact viewer when a pending checkpoint appears
        if (status.workflow?.status === 'paused_at_checkpoint') {
          const pending = status.checkpoints?.find((c: any) => c.status === 'pending');
          if (pending?.artifact_id && pending.id !== autoOpenedCheckpointRef.current) {
            autoOpenedCheckpointRef.current = pending.id;
            setViewingArtifactId(pending.artifact_id);
          }
        }
      } catch { /* ignore transient errors */ }
    };

    // Poll immediately, then every 2 seconds for more responsive updates
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeWorkflow?.id, planningPhase]);

  // Convert a workflow event to a coordinator message for the chat
  function eventToMessage(event: WorkflowEvent): { role: 'coordinator'; content: string; timestamp: number } | null {
    let content = event.summary;

    // Add "View output" button for stage_completed events with artifact
    if (event.event_type === 'stage_completed' && event.details) {
      try {
        const details = JSON.parse(event.details);
        if (details.excerpt) {
          content += `\n\n> ${details.excerpt.slice(0, 150)}${details.excerpt.length > 150 ? '...' : ''}`;
        }
      } catch { /* ignore */ }
    }

    // Show curator reasoning log
    if (event.event_type === 'curator_reasoning' && event.details) {
      try {
        const details = JSON.parse(event.details);
        if (details.full_reasoning) {
          content = `**Curator reasoning:**\n\n${details.full_reasoning}`;
        }
      } catch { /* ignore */ }
    }

    return { role: 'coordinator', content, timestamp: event.created_at };
  }

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
          const enriched = extractEnrichedContext(fullContent);
          if (enriched) handleLaunchWorkflow(trimmedGoal, enriched);
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
          const enriched = extractEnrichedContext(fullContent);
          if (enriched) handleLaunchWorkflow(pendingGoal, enriched);
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
  async function handleLaunchWorkflow(originalGoal: string, enrichedContext: string) {
    setPlanningPhase('launching');
    try {
      const selectedStages = TOGGLEABLE_STAGES.filter(s => enabledStages[s.key]).map(s => s.key);
      const result = await api.startWorkflow(itemId || undefined, originalGoal, enrichedContext, selectedStages);
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
    const cp = checkpoints.find(c => c.stage === stage && c.artifact_id);
    return cp?.artifact_id ?? null;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const [showExample, setShowExample] = useState(false);

  // Goal entry form (idle, no workflow, no planning)
  if (!hasWorkflow && !isGathering && !isLaunching) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Product Hub</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Describe what you want to build. The Chief of Staff will gather details and run the pipeline.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start p-8">
          <div className="w-full max-w-lg space-y-4">
            <form onSubmit={handleSubmitGoal} className="space-y-3">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitGoal(e as any); }
                }}
                placeholder={'What do you want to build?\n\nInclude: who it\'s for, the core problem, key outcomes, scope, and any constraints.'}
                rows={7}
                className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {/* Stage toggles */}
              <div className="flex flex-wrap gap-1.5">
                {TOGGLEABLE_STAGES.map(stage => {
                  const enabled = enabledStages[stage.key];
                  const enabledCount = Object.values(enabledStages).filter(Boolean).length;
                  const isLastEnabled = enabled && enabledCount === 1;
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      disabled={isLastEnabled}
                      onClick={() => setEnabledStages(prev => ({ ...prev, [stage.key]: !prev[stage.key] }))}
                      title={isLastEnabled ? 'At least one stage required' : `${enabled ? 'Disable' : 'Enable'} ${stage.label}`}
                      className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                        enabled
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 line-through'
                      } ${isLastEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}
                    >
                      {stage.short}
                    </button>
                  );
                })}
              </div>

              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={!goal.trim() || isStreaming}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Start
              </button>
            </form>

            <button
              onClick={() => setShowExample(v => !v)}
              className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors text-center"
            >
              {showExample ? 'Hide example' : 'Show example of an ideal input'}
            </button>

            {showExample && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3 text-xs text-gray-600 dark:text-gray-400">
                <p className="font-semibold text-gray-700 dark:text-gray-300">Example: high-quality goal input</p>
                <div className="bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 p-3 font-mono whitespace-pre-wrap leading-relaxed text-[11px]">{`Build a real-time dashboard for fleet managers at mid-size logistics companies (50–500 vehicles) that consolidates GPS tracking, fuel consumption, and maintenance alerts into a single view.

**Who it's for:** Fleet operations managers who currently juggle 3–4 separate tools and lose 2+ hours/day reconciling data.

**Core problem:** No unified view of vehicle health, location, and cost — leading to missed maintenance windows, route inefficiencies, and fuel waste.

**Key outcomes:**
- Reduce vehicle downtime by 20% through predictive maintenance alerts
- Cut fuel spend by 10% via route optimization suggestions
- Single pane of glass replacing Samsara + Google Sheets + email alerts

**Scope:** MVP — web app only, 3 integrations (GPS provider API, fuel card API, OBD-II adapter). No mobile app in v1.

**Constraints:**
- Must comply with DOT electronic logging regulations
- Max 2-second latency on real-time position updates
- Team has React/Node experience, open to Postgres or TimescaleDB
- Budget: \$150k, target launch in 12 weeks`}</div>
                <div className="space-y-1.5 pt-1">
                  <p className="font-semibold text-gray-700 dark:text-gray-300">What makes this effective:</p>
                  <ul className="space-y-1 list-none">
                    <li><span className="font-medium text-gray-700 dark:text-gray-300">Target user + pain</span> — who they are, what's broken today, quantified impact</li>
                    <li><span className="font-medium text-gray-700 dark:text-gray-300">Measurable outcomes</span> — success criteria the agents can design toward</li>
                    <li><span className="font-medium text-gray-700 dark:text-gray-300">Explicit scope boundary</span> — what's in v1, what's not</li>
                    <li><span className="font-medium text-gray-700 dark:text-gray-300">Real constraints</span> — regulatory, technical, team skills, budget, timeline</li>
                  </ul>
                  <p className="pt-1 text-gray-500 dark:text-gray-500 italic">
                    Tip: you don't need all of this upfront — the Chief of Staff will ask clarifying questions. But the more context you provide, the fewer rounds of Q&A and the better the outputs.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
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
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex items-start justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {isComplete ? 'Workflow Complete'
              : isLaunching ? 'Launching workflow...'
              : isGathering ? 'Chief of Staff'
              : isAtCheckpoint ? `Checkpoint: ${STAGE_LABELS[currentStage ?? ''] ?? currentStage}`
              : hasWorkflow ? `Running: ${STAGE_LABELS[currentStage ?? ''] ?? currentStage ?? 'starting...'}`
              : 'Chief of Staff'}
            {activeWorkflow?.item_id && (
              <span className="ml-2 text-xs font-mono text-gray-400 dark:text-gray-500">
                …{activeWorkflow.item_id.slice(-8)}
              </span>
            )}
            {activeWorkflow && activeWorkflow.estimated_cost > 0 && (
              <span className="ml-2 text-xs font-mono text-amber-600 dark:text-amber-400" title="Estimated workflow cost">
                ${activeWorkflow.estimated_cost < 0.01
                  ? activeWorkflow.estimated_cost.toFixed(4)
                  : activeWorkflow.estimated_cost.toFixed(2)}
              </span>
            )}
          </h2>
          {displayGoal && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-sm">
              {displayGoal}
            </p>
          )}
        </div>
        {!hasWorkflow && isGathering && !isLaunching && (
          <button
            onClick={resetWorkflow}
            className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

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
          return (
            <div className="flex items-center gap-2 pt-2">
              {pending.artifact_id && (
                <button
                  onClick={() => setViewingArtifactId(pending.artifact_id!)}
                  className="text-xs px-2.5 py-1 rounded-md border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  Review output
                </button>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Approve, revise, or reject from the artifact viewer
              </span>
            </div>
          );
        })()}

        {/* Completion: reiteration options */}
        {isComplete && (
          <div className="pt-4 space-y-3">
            {!reiterateStage && (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Need to revisit a stage? Pick one to re-run it and all downstream stages.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {stageSequence
                    .filter(s => s !== 'critic' && s !== 'curator')
                    .map(stage => (
                    <button
                      key={stage}
                      onClick={() => setReiterateStage(stage)}
                      className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      Redo from {STAGE_LABELS[stage] ?? stage}
                    </button>
                  ))}
                </div>
              </>
            )}
            {reiterateStage && (
              <div className="space-y-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Redo from {STAGE_LABELS[reiterateStage] ?? reiterateStage}
                </p>
                <textarea
                  value={reiterateFeedback}
                  onChange={(e) => setReiterateFeedback(e.target.value)}
                  placeholder="What changed? Provide context for the re-run..."
                  rows={3}
                  className="w-full resize-none rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!reiterateFeedback.trim() || !activeWorkflow) return;
                      setError(null);
                      try {
                        const result = await api.reiterateWorkflow(activeWorkflow.id, reiterateStage, reiterateFeedback.trim());
                        applyWorkflowStatus(result);
                        setReiterateStage(null);
                        setReiterateFeedback('');
                        addCoordinatorMessage({
                          role: 'coordinator',
                          content: `Re-running from ${STAGE_LABELS[reiterateStage] ?? reiterateStage}. All downstream stages will be re-processed.`,
                          timestamp: Date.now(),
                        });
                      } catch (err: any) {
                        setError(err.response?.data?.error ?? err.message ?? 'Failed to reiterate');
                      }
                    }}
                    disabled={!reiterateFeedback.trim()}
                    className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-xs font-medium rounded-md transition-colors"
                  >
                    Re-run
                  </button>
                  <button
                    onClick={() => { setReiterateStage(null); setReiterateFeedback(''); }}
                    className="py-1.5 px-3 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {showInput && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}
          <form onSubmit={handleSendReply} className="flex gap-2 items-end">
            <textarea
              ref={replyRef}
              value={reply}
              onChange={(e) => { setReply(e.target.value); autoResize(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(e as any); }
              }}
              placeholder={hasWorkflow ? 'Message the Chief of Staff... (Shift+Enter for new line)' : 'Reply... (Shift+Enter for new line)'}
              rows={2}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 overflow-y-auto"
            />
            <button
              type="submit"
              disabled={!reply.trim() || isStreaming}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors self-end"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
