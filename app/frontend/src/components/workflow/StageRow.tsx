import { STAGE_LABELS } from '../../constants/stage-labels';
import type { StageStatus } from '../../stores/workflowStore';
import type { WorkflowCheckpoint } from '../../stores/workflowStore';
import { AgentAnimation } from './AgentAnimation';

// ── Props ────────────────────────────────────────────────────────────────────

interface StageRowProps {
  stageName: string;
  index: number;
  status: StageStatus;
  checkpoint: WorkflowCheckpoint | undefined;
  latestApproved: WorkflowCheckpoint | undefined;
  completedAt: number | null;
  agentModel: string | undefined;
  onViewArtifact: (id: number) => void;
  isLast?: boolean;
  compact?: boolean;
  customLabel?: string; // Override default stage label (e.g., "Feature 1")
  phaseLabel?: string; // Which phase this feature stage belongs to (e.g., "MVP", "Phase 1")
  /** Scrolls the event log to this stage's section. Only wired up once the stage has started. */
  onSelect?: () => void;
}

// ── Status icon ───────────────────────────────────────────────────────────────

export function StatusIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'complete':
      return <span className="text-green-600 dark:text-green-500 text-xs leading-none select-none">✓</span>;
    case 'in-progress':
      return <span className="text-brand-600 dark:text-brand-400 text-xs leading-none select-none animate-pulse">▶</span>;
    case 'at-checkpoint':
      return <span className="text-amber-600 dark:text-amber-400 text-xs leading-none select-none animate-pulse">⏸</span>;
    case 'rejected':
      return <span className="text-red-600 dark:text-red-500 text-xs leading-none select-none">✕</span>;
    case 'skipped':
      return <span className="text-surface-400 dark:text-surface-700 text-xs leading-none select-none">─</span>;
    default:
      return <span className="text-surface-400 dark:text-surface-700 text-xs leading-none select-none">○</span>;
  }
}

// ── Label color ───────────────────────────────────────────────────────────────

export function labelColor(status: StageStatus): string {
  switch (status) {
    case 'complete':    return 'text-surface-500 dark:text-surface-400';
    case 'in-progress': return 'text-brand-600 dark:text-brand-300';
    case 'at-checkpoint': return 'text-amber-600 dark:text-amber-300';
    case 'rejected':    return 'text-red-500 dark:text-red-400';
    case 'skipped':     return 'text-surface-400 dark:text-surface-700';
    default:            return 'text-surface-500 dark:text-surface-600';
  }
}

// ── StageRow ──────────────────────────────────────────────────────────────────

export function StageRow({
  stageName,
  index,
  status,
  checkpoint,
  latestApproved,
  completedAt,
  onViewArtifact,
  prevStatus,
  isLast,
  compact = false,
  customLabel,
  phaseLabel,
  onSelect,
}: StageRowProps & { prevStatus?: StageStatus }) {
  const showConnector = index > 0;
  const connectorDone = prevStatus === 'complete';
  // A section only exists in the event log once its stage has started — clicking
  // a still-pending row would have nowhere to scroll to.
  const clickable = status !== 'pending' && !!onSelect;

  // Compact mode: fixed-height rows so spacing between steps is uniform.
  // Active rows are taller to accommodate the animation; connector below stretches to match.
  if (compact) {
    const isActive = status === 'in-progress';
    const sizing = isActive ? 'flex-1 min-h-[44px] max-h-[64px]' : 'flex-1 min-h-[36px] max-h-[52px]';

    return (
      <div
        className={`flex gap-0 ${sizing} ${clickable ? 'cursor-pointer group' : ''}`}
        onClick={clickable ? onSelect : undefined}
      >
        {/* Gutter */}
        <div className="flex flex-col items-center flex-shrink-0 w-6">
          {showConnector
            ? <div className={`w-px flex-shrink-0 h-3 ${connectorDone ? 'bg-surface-300 dark:bg-surface-600' : 'bg-surface-200 dark:bg-surface-800'}`} />
            : <div className="h-3 flex-shrink-0" />
          }
          <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
            <StatusIcon status={status} />
          </div>
          {!isLast && (
            <div className={`w-px flex-1 ${status === 'complete' ? 'bg-surface-300 dark:bg-surface-600' : 'bg-surface-200 dark:bg-surface-800'}`} />
          )}
        </div>

        {/* Content — mt-[11px] aligns text centre with icon centre (h-3 top + h-4/2 = 14px) */}
        <div className="flex-1 min-w-0 overflow-hidden pl-2 mt-[11px]">
          <span className={`block text-[13px] font-mono leading-none truncate ${labelColor(status)} ${clickable ? 'group-hover:text-brand-600 dark:group-hover:text-brand-400 group-hover:underline' : ''}`}>
            {customLabel ?? STAGE_LABELS[stageName] ?? stageName}
          </span>
          {phaseLabel && (
            <span className="block text-[10px] font-mono leading-none truncate text-surface-500 dark:text-surface-600 mt-0.5">
              {phaseLabel}
            </span>
          )}
          {isActive && (
            <div className="mt-1 overflow-hidden">
              <AgentAnimation stageName={stageName} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0">
      {/* Left gutter: connector + icon */}
      <div className="flex flex-col items-center flex-shrink-0 w-6">
        {/* Connector line above */}
        {showConnector && (
          <div className={`w-px flex-shrink-0 h-2 ${connectorDone ? 'bg-surface-300 dark:bg-surface-600' : 'bg-surface-200 dark:bg-surface-800'}`} />
        )}
        {!showConnector && <div className="h-2" />}

        {/* Status icon */}
        <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
          <StatusIcon status={status} />
        </div>

        {/* Connector line below (to next stage) */}
        {!isLast && (
          <div className={`w-px flex-1 min-h-[8px] ${
            status === 'complete' ? 'bg-surface-300 dark:bg-surface-600' : 'bg-surface-200 dark:bg-surface-800'
          }`} />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 pb-2 pl-2 ${showConnector ? 'pt-0.5' : 'pt-0.5'}`}>
        {/* Label row */}
        <span className={`text-[12px] font-mono leading-none ${labelColor(status)}`}>
          {STAGE_LABELS[stageName] ?? stageName}
        </span>
        {phaseLabel && (
          <span className="block text-[10px] font-mono leading-none text-surface-500 dark:text-surface-600 mt-0.5">
            {phaseLabel}
          </span>
        )}

        {/* Running state: ASCII agent animation */}
        {status === 'in-progress' && (
          <div className="mt-1">
            <AgentAnimation stageName={stageName} />
          </div>
        )}

        {/* Checkpoint state */}
        {status === 'at-checkpoint' && checkpoint && (() => {
          let diffArtifactId: number | null = null;
          try {
            const action = JSON.parse(checkpoint.coordinator_action ?? '{}');
            diffArtifactId = action.diff_artifact_id ?? null;
          } catch { /* ignore */ }
          return (
            <div className="mt-1 space-y-1">
              <p className="text-[11px] text-amber-500/80">
                awaiting review
                {checkpoint.coordinator_action && (() => {
                  try {
                    const action = JSON.parse(checkpoint.coordinator_action);
                    if (action.critic_verdict) return ` · ${action.critic_verdict}`;
                  } catch { /* ignore */ }
                  return '';
                })()}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {checkpoint.artifact_id && (
                  <button
                    onClick={() => onViewArtifact(checkpoint.artifact_id!)}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-amber-700/50 text-amber-500 hover:border-amber-500 transition-colors font-mono"
                  >
                    review →
                  </button>
                )}
                {diffArtifactId && (
                  <button
                    onClick={() => onViewArtifact(diffArtifactId!)}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-brand-800/50 text-brand-500 hover:border-brand-600 transition-colors font-mono"
                  >
                    diff →
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Complete state */}
        {status === 'complete' && (() => {
          let approvedDiffId: number | null = null;
          try {
            const action = JSON.parse(latestApproved?.coordinator_action ?? '{}');
            approvedDiffId = action.diff_artifact_id ?? null;
          } catch { /* ignore */ }
          return (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {completedAt && (
                <span className="text-[10px] font-mono text-surface-500 dark:text-surface-600">
                  {new Date(completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {latestApproved?.artifact_id && (
                <button
                  onClick={() => onViewArtifact(latestApproved.artifact_id!)}
                  className="text-[10px] text-surface-500 dark:text-surface-600 hover:text-brand-600 dark:hover:text-brand-400 transition-colors font-mono"
                >
                  view
                </button>
              )}
              {approvedDiffId && (
                <button
                  onClick={() => onViewArtifact(approvedDiffId!)}
                  className="text-[10px] text-surface-500 dark:text-surface-600 hover:text-brand-600 dark:hover:text-brand-400 transition-colors font-mono"
                >
                  diff
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
