import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useWorkflowStore, type WorkflowEvent, type CoordinatorMessage } from '../stores/workflowStore';
import { useSessionStore } from '../stores/sessionStore';
import { useConfigStore } from '../stores/configStore';
import { ContextDiffPanel } from './ContextDiffPanel';
import { STAGE_LABELS, TOGGLEABLE_STAGES } from '../constants/stage-labels';
import { stripReadyMarker, extractReadyPayload, parseCriticData, criticSummaryLine } from '../utils/coordinator-helpers';
import { InlineCheckpointActions } from './InlineCheckpointActions';
import { api } from '../services/api';

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
  const [reiterateStage, setReiterateStage] = useState<string | null>(null);
  const [reiterateFeedback, setReiterateFeedback] = useState('');
  const [showExtendPanel, setShowExtendPanel] = useState(false);
  const [extendStages, setExtendStages] = useState<Record<string, boolean>>({});
  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>(
    () => Object.fromEntries(TOGGLEABLE_STAGES.map(s => [s.key, true]))
  );
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [stageStale, setStageStale] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
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
  }, [coordinatorMessages, activeWorkflow?.status, checkpoints]);

  // Track which pending checkpoint we've already auto-opened, to avoid re-opening after user closes
  const autoOpenedCheckpointRef = useRef<number | null>(null);

  // Reset auto-open ref when workflow changes
  useEffect(() => {
    autoOpenedCheckpointRef.current = null;
  }, [activeWorkflow?.id]);

  // ── Auto-open artifact viewer when a pending checkpoint appears ─────────
  // Reactive to store state — fires on initial restore (App.tsx), poll updates, or any status change
  useEffect(() => {
    if (activeWorkflow?.status !== 'paused_at_checkpoint') return;
    const pending = checkpoints.find(c => c.status === 'pending');
    if (!pending?.artifact_id) return;
    if (pending.id === autoOpenedCheckpointRef.current) return;
    autoOpenedCheckpointRef.current = pending.id;
    setViewingArtifactId(pending.artifact_id);
  }, [activeWorkflow?.status, checkpoints, setViewingArtifactId]);

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

    // Format critic verdict with structured issues
    if (event.event_type === 'critic_verdict' && event.details) {
      try {
        const details = JSON.parse(event.details);
        const verdict = details.critic_verdict;
        const stage = STAGE_LABELS[details.reviewed_stage ?? event.stage] ?? event.stage;
        const parts: string[] = [];

        if (verdict === 'approve') {
          const minorCount = details.issue_count - (details.critical_issues ?? 0) - (details.major_issues ?? 0);
          parts.push(`**Quality Review — ${stage}** ✓`);
          if (minorCount > 0) {
            parts.push(`Passed with ${minorCount} minor note${minorCount !== 1 ? 's' : ''} (resolved internally).`);
          } else {
            parts.push('No issues found.');
          }
        } else {
          parts.push(`**Quality Review — ${stage}**`);
          if (details.issue_count) {
            const counts: string[] = [];
            if (details.critical_issues) counts.push(`${details.critical_issues} critical`);
            if (details.major_issues) counts.push(`${details.major_issues} major`);
            const minorCount = details.issue_count - (details.critical_issues ?? 0) - (details.major_issues ?? 0);
            if (minorCount > 0) counts.push(`${minorCount} minor`);
            parts.push(`**${details.issue_count} issue${details.issue_count !== 1 ? 's' : ''}** flagged (${counts.join(', ')})`);
          }

          // Format individual issues as a bulleted list
          if (details.issues_summary) {
            const issues = details.issues_summary.split('; ').filter((s: string) => s.trim());
            if (issues.length > 0) {
              parts.push('');
              for (const issue of issues) {
                // Format [SEVERITY] — description
                const match = issue.match(/^\[(\w+)\]\s*[—-]?\s*(.*)/s);
                if (match) {
                  const sev = match[1].toLowerCase();
                  const icon = sev === 'critical' ? '🔴' : sev === 'major' ? '🟠' : '🟡';
                  parts.push(`${icon} **${match[1]}**: ${match[2]}`);
                } else {
                  parts.push(`- ${issue}`);
                }
              }
            }
          }
        }

        content = parts.join('\n');
      } catch { /* fall through to raw summary */ }
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
                {availableStages.map(stage => {
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
          const pendingCriticData = parseCriticData(pending);
          const summary = criticSummaryLine(pendingCriticData);

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

            {/* Add stages panel */}
            {!reiterateStage && (() => {
              const existingSequence: string[] = stageSequence;
              const addableStages = availableStages.filter(
                s => s.key !== 'curator' && !existingSequence.includes(s.key)
              );
              if (addableStages.length === 0) return null;
              const selected = addableStages.filter(s => extendStages[s.key]);
              return showExtendPanel ? (
                <div className="space-y-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Add stages to this workflow</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    New stages run after the existing output. Curator re-runs last to update context.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {addableStages.map(s => (
                      <button
                        key={s.key}
                        onClick={() => setExtendStages(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                          extendStages[s.key]
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!selected.length || !activeWorkflow) return;
                        setError(null);
                        // Preserve logical order from availableStages
                        const orderedStages = availableStages
                          .filter(s => extendStages[s.key])
                          .map(s => s.key);
                        try {
                          const result = await api.extendWorkflow(activeWorkflow.id, orderedStages);
                          applyWorkflowStatus(result);
                          setShowExtendPanel(false);
                          setExtendStages({});
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
                      disabled={selected.length === 0}
                      className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-xs font-medium rounded-md transition-colors"
                    >
                      {selected.length === 0 ? 'Select stages above' : `Add ${selected.length} stage${selected.length !== 1 ? 's' : ''}`}
                    </button>
                    <button
                      onClick={() => { setShowExtendPanel(false); setExtendStages({}); }}
                      className="py-1.5 px-3 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-center">
                  <button
                    onClick={() => setShowExtendPanel(true)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    + Add stages
                  </button>
                </div>
              );
            })()}
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
