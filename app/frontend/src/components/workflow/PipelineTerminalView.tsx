import { useRef, useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { api } from '../../services/api';
import { deriveStageStatus } from '../../utils/stage-tracker-helpers';
import { StageRow } from './StageRow';
import { STAGE_LABELS } from '../../constants/stage-labels';
import type { StageStatus, CoordinatorMessage } from '../../stores/workflowStore';
import { InlineCheckpointActions } from '../coordinator/InlineCheckpointActions';
import { PipelineStatusSection } from './PipelineStatusSection';
import { DemoProjectSection } from './DemoProjectSection';

// ── Dancing creature ─────────────────────────────────────────────────────────

const CREATURE_FRAMES = [
  ['\\(^.^)/', ' ~  ~  '],
  [' (^.^) ', '~  ~   '],
  ['/(^.^)\\', '   ~  ~'],
  [' (^.^) ', '  ~   ~'],
];

function DancingCreature() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % CREATURE_FRAMES.length), 700);
    return () => clearInterval(t);
  }, []);
  const [top, bottom] = CREATURE_FRAMES[frame];
  return (
    <div
      className="flex-shrink-0 pb-2 pt-1 flex flex-col items-center select-none transition-opacity duration-500"
      title="keep going"
    >
      <pre className="text-[9px] leading-tight text-slate-400 dark:text-slate-400 text-center font-mono">{top}</pre>
      <pre className="text-[8px] leading-tight text-slate-500 dark:text-slate-500 text-center font-mono">{bottom}</pre>
    </div>
  );
}

// ── Event type → display config ──────────────────────────────────────────────

const EVENT_CFG: Record<string, { icon: string; color: string; bgColor: string }> = {
  stage_started:       { icon: '▶', color: 'text-teal-600 dark:text-teal-400',    bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  stage_progress:      { icon: '·', color: 'text-slate-500 dark:text-slate-400',  bgColor: 'bg-slate-100 dark:bg-slate-800/40' },
  stage_completed:     { icon: '✓', color: 'text-green-600 dark:text-green-400',  bgColor: 'bg-green-100 dark:bg-green-900/30' },
  critic_verdict:      { icon: '◎', color: 'text-amber-600 dark:text-amber-400',  bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  checkpoint_created:  { icon: '⏸', color: 'text-amber-600 dark:text-amber-400',  bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  revision_started:    { icon: '↻', color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-100 dark:bg-violet-900/30' },
  human_edit:          { icon: '✎', color: 'text-blue-600 dark:text-blue-400',    bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  cr_created:          { icon: '⊕', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_assessed:         { icon: '◉', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_stage_started:    { icon: '▶', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_stage_completed:  { icon: '✓', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_complete:         { icon: '✓', color: 'text-green-600 dark:text-green-400',    bgColor: 'bg-green-100 dark:bg-green-900/30' },
  curator_reasoning:   { icon: '📝', color: 'text-teal-600 dark:text-teal-300',   bgColor: 'bg-teal-100 dark:bg-teal-900/20' },
  board_synced:        { icon: '⬆', color: 'text-blue-600 dark:text-blue-400',    bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  workflow_started:    { icon: '🚀', color: 'text-teal-600 dark:text-teal-400',   bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  workflow_complete:   { icon: '✓', color: 'text-green-600 dark:text-green-400',  bgColor: 'bg-green-100 dark:bg-green-900/30' },
  workflow_cancelled:  { icon: '■', color: 'text-red-600 dark:text-red-400',     bgColor: 'bg-red-100 dark:bg-red-900/30' },
};

function getEventCfg(eventType: string) {
  return EVENT_CFG[eventType] ?? { icon: '●', color: 'text-slate-500', bgColor: 'bg-slate-100 dark:bg-slate-800/30' };
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ── Stage group header ────────────────────────────────────────────────────────

function StageGroupHeader({
  stageName, status, artifactId, onViewOutput,
}: {
  stageName: string;
  status: StageStatus;
  artifactId?: number | null;
  onViewOutput?: (id: number) => void;
}) {
  const label = STAGE_LABELS[stageName] ?? stageName;
  const color = status === 'complete'
    ? 'text-green-600 dark:text-green-400'
    : status === 'in-progress'
    ? 'text-teal-600 dark:text-teal-400'
    : status === 'at-checkpoint'
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-slate-400 dark:text-slate-600';

  const dot = status === 'complete'
    ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
    : status === 'in-progress'
    ? <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse inline-block" />
    : status === 'at-checkpoint'
    ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
    : null;

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 mt-2 first:mt-0 text-[10px] font-semibold uppercase tracking-widest ${color}`}>
      {dot}
      <span>{label}</span>
      {artifactId && onViewOutput && (
        <button
          onClick={() => onViewOutput(artifactId)}
          className="text-[9px] font-mono normal-case tracking-normal text-slate-500 dark:text-slate-600 hover:text-teal-600 dark:hover:text-teal-400 transition-colors whitespace-nowrap border border-slate-200 dark:border-slate-800 hover:border-teal-400 dark:hover:border-teal-800 rounded px-1.5 py-0.5"
        >
          view →
        </button>
      )}
      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800/60" />
    </div>
  );
}

// ── Expandable detail row (curator reasoning, critic verdict) ─────────────────

function ExpandableRow({
  label,
  labelColor,
  borderColor,
  bgColor,
  content,
  timestamp,
}: {
  label: string;
  labelColor: string;
  borderColor: string;
  bgColor: string;
  content: string;
  timestamp: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n').filter(Boolean);
  const hasMore = lines.length > 1;
  const displayLines = expanded ? lines : lines.slice(0, 1);

  return (
    <div className={`mx-2 my-1 rounded border ${borderColor} ${bgColor}`}>
      <button
        onClick={() => hasMore && setExpanded(e => !e)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {hasMore && (
          <span className={`text-[9px] font-mono ${labelColor} opacity-60 w-3 flex-shrink-0`}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
        {!hasMore && <span className="w-3 flex-shrink-0" />}
        <span className={`text-[9px] font-semibold uppercase tracking-widest font-mono flex-1 text-left ${labelColor}`}>
          {label}
        </span>
        <span className="text-[9px] text-slate-400 dark:text-slate-700 font-mono flex-shrink-0">{formatTs(timestamp)}</span>
      </button>
      <div className="px-3 pb-2">
        {displayLines.map((line, i) => {
          const plain = line.replace(/\*\*(.*?)\*\*/g, '$1');
          return (
            <p key={i} className="text-[10px] text-slate-600 dark:text-slate-400 font-mono leading-relaxed">
              {plain}
            </p>
          );
        })}
        {!expanded && hasMore && (
          <p className="text-[9px] text-slate-400 dark:text-slate-600 font-mono mt-0.5">
            +{lines.length - 1} more line{lines.length - 1 !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Single event row ──────────────────────────────────────────────────────────

function EventRow({ msg }: { msg: CoordinatorMessage }) {
  if (msg.eventType === 'curator_reasoning') {
    return (
      <ExpandableRow
        label="context updates"
        labelColor="text-teal-600 dark:text-teal-500"
        borderColor="border-teal-200 dark:border-teal-800/40"
        bgColor="bg-teal-50 dark:bg-teal-900/10"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  if (msg.eventType === 'critic_verdict') {
    return (
      <ExpandableRow
        label="quality review"
        labelColor="text-amber-600 dark:text-amber-500"
        borderColor="border-amber-200 dark:border-amber-800/40"
        bgColor="bg-amber-50 dark:bg-amber-900/10"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  const cfg = getEventCfg(msg.eventType ?? '');
  const isProgress = msg.isProgress;

  const lines = msg.content.split('\n').filter(Boolean);
  const title = lines[0] ?? '';
  const detailLines = lines.slice(1).filter(l => !l.startsWith('→ '));
  const detail = detailLines.join(' ').slice(0, 120);
  const boardUrl = msg.eventType === 'board_synced'
    ? (lines.find(l => l.startsWith('→ '))?.replace(/^→\s*/, '') ?? null)
    : null;

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/20 ${isProgress ? 'opacity-60' : ''}`}>
      {/* Icon badge */}
      <div className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] ${cfg.bgColor}`}>
        <span className={cfg.color}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-700 dark:text-slate-300 leading-tight font-mono truncate">{title}</span>
          <span className="flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-700 font-mono">{formatTs(msg.timestamp)}</span>
        </div>
        {detail && !boardUrl && (
          <p className="text-[11px] text-slate-500 dark:text-slate-600 font-mono mt-0.5 leading-relaxed truncate">{detail}</p>
        )}
        {boardUrl && (
          <a
            href={boardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-mono underline underline-offset-2 transition-colors"
          >
            open in Azure DevOps ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ── Checkpoint inline review ──────────────────────────────────────────────────

function isStaleRecoveryCheckpoint(coordinatorAction: string | null): boolean {
  try { return !!JSON.parse(coordinatorAction ?? '{}').stale_recovery; } catch { return false; }
}

function CheckpointRow({
  stageName,
  onResolved,
}: {
  stageName: string;
  onResolved: (result: any) => void;
}) {
  const { checkpoints, setViewingArtifactId } = useWorkflowStore();
  const checkpoint = checkpoints.find(c => c.stage === stageName && c.status === 'pending');
  if (!checkpoint) return null;

  // Stale-recovery checkpoints may have a critic artifact_id — don't use it for preview
  const safeArtifactId = isStaleRecoveryCheckpoint(checkpoint.coordinator_action)
    ? null
    : checkpoint.artifact_id;

  return (
    <div className="mx-2 mt-1 mb-2 rounded border border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-900/10 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">⏸ awaiting approval</span>
        {safeArtifactId && (
          <button
            onClick={() => setViewingArtifactId(safeArtifactId)}
            className="text-[10px] text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200 font-mono border border-sky-200 hover:border-sky-400 dark:border-sky-700/40 dark:hover:border-sky-500 px-1.5 py-0.5 rounded transition-colors"
          >
            review output →
          </button>
        )}
      </div>
      <InlineCheckpointActions
        checkpoint={checkpoint}
        onResolved={onResolved}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  coordinatorMessages: CoordinatorMessage[];
  isRunning: boolean;
  onCheckpointResolved: (result: any) => void;
  onBack: () => void;
}

export function PipelineTerminalView({ coordinatorMessages, isRunning, onCheckpointResolved, onBack }: Props) {
  const {
    activeWorkflow,
    stageSequence,
    currentStage,
    completedStages,
    pendingStage,
    checkpoints,
    applyWorkflowStatus,
    setViewingArtifactId,
  } = useWorkflowStore();
  const { agentModels } = useModelStore();
  const { isDemoMode: demoModeEnabled } = useSettingsStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [demoConfigured, setDemoConfigured] = useState<boolean>(false);
  const [generalExpanded, setGeneralExpanded] = useState(false);
  const [crExpanded, setCrExpanded] = useState(false);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);
  const [artifacts, setArtifacts] = useState<Array<{ id: number; type: string; stage: string; created_at: number }>>([]);

  // Demo sections only show when demo mode is enabled in settings AND DEMO_PROJECT_PATH is configured
  const isDemoMode = demoModeEnabled && demoConfigured;

  // Check once whether the demo pipeline is configured
  useEffect(() => {
    if (!activeWorkflow) return;
    api.getDemoRunStatus(activeWorkflow.id)
      .then(s => setDemoConfigured(s.configured))
      .catch(() => {});
  }, [activeWorkflow?.id]);

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
  const isCancelled = isComplete && coordinatorMessages.some(m => m.eventType === 'workflow_cancelled');

  const handleStop = async () => {
    if (stopping || isComplete) return;
    setStopping(true);
    try {
      await api.cancelWorkflow(activeWorkflow.id);
    } catch {
      setStopping(false);
    }
  };

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      const status = await api.restartWorkflow(activeWorkflow.id);
      applyWorkflowStatus(status);
    } catch {
      setRestarting(false);
    }
  };

  const total = stageSequence.length;
  const doneCount = completedStages.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const statuses: StageStatus[] = stageSequence.map(s =>
    deriveStageStatus(s, currentStage, completedStages, pendingStage, activeWorkflow.status)
  );

  // Group coordinator messages by stage (null stage → 'general')
  const eventsByStage = new Map<string, CoordinatorMessage[]>();
  for (const msg of coordinatorMessages) {
    const key = msg.stage ?? 'general';
    const arr = eventsByStage.get(key) ?? [];
    arr.push(msg);
    eventsByStage.set(key, arr);
  }

  // Lifecycle events shown as a pinned banner at the top of the event log
  const LIFECYCLE_EVENT_TYPES = new Set(['workflow_started', 'workflow_cancelled', 'reiteration']);
  const CR_EVENT_TYPES = new Set(['cr_created', 'cr_assessed', 'cr_stage_started', 'cr_stage_completed', 'cr_complete']);
  const generalEvents = eventsByStage.get('general') ?? [];
  const topLifecycleEvents = generalEvents.filter(m => LIFECYCLE_EVENT_TYPES.has(m.eventType ?? ''));
  const crEvents = generalEvents.filter(m => CR_EVENT_TYPES.has(m.eventType ?? ''));
  const bottomGeneralEvents = generalEvents.filter(m => !LIFECYCLE_EVENT_TYPES.has(m.eventType ?? '') && !CR_EVENT_TYPES.has(m.eventType ?? '') && !!m.eventType);

  // Stages to show in the event log (exclude stages with no events yet if pending)
  const activeStages = stageSequence.filter(s => {
    const status = deriveStageStatus(s, currentStage, completedStages, pendingStage, activeWorkflow.status);
    return status !== 'pending' || eventsByStage.has(s);
  });

  const showCost = (activeWorkflow.estimated_cost ?? 0) > 0.0001;
  const costStr = activeWorkflow.estimated_cost !== undefined
    ? activeWorkflow.estimated_cost < 0.01
      ? `$${activeWorkflow.estimated_cost.toFixed(4)}`
      : `$${activeWorkflow.estimated_cost.toFixed(2)}`
    : '';

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-[#0d1117] font-mono">
      {/* ── Left: stage list ───────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800/80">
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
            {isRunning && !isComplete && (
              <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                live
              </span>
            )}
            {isComplete && !isCancelled && (
              <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                complete
              </span>
            )}
            {isCancelled && (
              <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                stopped
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {showCost && (
              <span className="text-[11px] font-mono text-slate-500">{costStr}</span>
            )}
            {isRunning && !isComplete && (
              <button
                onClick={handleStop}
                disabled={stopping}
                title="Stop workflow"
                className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-red-300 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {stopping ? (
                  <>
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    stopping…
                  </>
                ) : (
                  <>■ stop</>
                )}
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
                  {isCancelled && (
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
                      ) : '↺ restart from beginning'}
                    </button>
                  )}
                  {!isCancelled && (() => {
                    const boardMsg = coordinatorMessages.find(m => m.eventType === 'board_synced');
                    const adoUrl = boardMsg?.content.split('\n').find(l => l.startsWith('→ '))?.replace(/^→\s*/, '');
                    if (!adoUrl) return null;
                    return (
                      <a href={adoUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline">
                        View in ADO ↗
                      </a>
                    );
                  })()}
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

          {/* Artifacts section (collapsible, pinned at bottom) */}
          {artifacts.length > 0 && (
            <div className="mt-2 mb-1 border-t border-slate-200 dark:border-slate-700/60 pt-2">
              <button
                onClick={() => setArtifactsExpanded(e => !e)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-500 transition-colors text-left"
              >
                <svg
                  className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${artifactsExpanded ? 'rotate-90' : ''}`}
                  fill="currentColor" viewBox="0 0 6 10"
                >
                  <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                artifacts
                {!artifactsExpanded && (
                  <span className="ml-1 normal-case tracking-normal font-normal text-slate-300 dark:text-slate-700">
                    ({artifacts.length})
                  </span>
                )}
              </button>
              {artifactsExpanded && (
                <div className="px-2 py-1 space-y-0.5">
                  {artifacts.map((artifact) => {
                    const typeLabel = STAGE_LABELS[artifact.stage ?? ''] ?? artifact.type;
                    return (
                      <button
                        key={artifact.id}
                        onClick={() => setViewingArtifactId(artifact.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors group"
                      >
                        <svg className="w-3 h-3 text-slate-400 dark:text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="flex-1 truncate text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100">
                          {typeLabel}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-600 font-mono">
                          {artifact.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
