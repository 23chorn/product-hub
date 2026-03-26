import { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { formatTokens, formatCost, labelClass, type StageTokenData } from '../../utils/stage-tracker-helpers';
import { STAGE_LABELS } from '../../constants/stage-labels';
import type { StageStatus } from '../../stores/workflowStore';
import type { WorkflowCheckpoint } from '../../stores/workflowStore';

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
}

// ── Tooltip content (portal) ─────────────────────────────────────────────────

function StageTokenTooltipContent({ data, style }: { data: StageTokenData; style: React.CSSProperties }) {
  const { specialist: s, critic: c, priorRunsCost: prior } = data;
  const totalCost = (s.estimatedCost ?? 0) + (c?.estimatedCost ?? 0) + (prior ?? 0);

  const modelLabel = (model: string) => {
    if (model.includes('opus')) return 'Opus 4.6';
    if (model.includes('sonnet')) return 'Sonnet 4.5';
    if (model.includes('haiku')) return 'Haiku 4.5';
    return model.split('/').pop()?.split(':')[0] ?? model;
  };

  return ReactDOM.createPortal(
    <div
      style={style}
      className="fixed z-[9999] w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs pointer-events-none"
    >
      {/* Specialist */}
      <div className="mb-2">
        <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Specialist · {modelLabel(s.model)}
        </div>
        <div className="space-y-0.5 text-gray-500 dark:text-gray-400">
          <div className="flex justify-between">
            <span>Input</span>
            <span>{formatTokens(s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens)} tokens</span>
          </div>
          {s.cacheReadTokens > 0 && (
            <div className="flex justify-between pl-2 text-green-600 dark:text-green-500">
              <span>↳ cached (read)</span>
              <span>{formatTokens(s.cacheReadTokens)}</span>
            </div>
          )}
          {s.cacheWriteTokens > 0 && (
            <div className="flex justify-between pl-2 text-blue-500 dark:text-blue-400">
              <span>↳ cache write</span>
              <span>{formatTokens(s.cacheWriteTokens)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Output</span>
            <span>{formatTokens(s.outputTokens)} tokens</span>
          </div>
          {(s.searchCount ?? 0) > 0 && (
            <div className="flex justify-between text-purple-600 dark:text-purple-400">
              <span>Web searches</span>
              <span>{s.searchCount} × $0.01</span>
            </div>
          )}
          <div className="flex justify-between font-medium text-gray-700 dark:text-gray-300 pt-0.5 border-t border-gray-100 dark:border-gray-800">
            <span>Cost</span>
            <span>{formatCost(s.estimatedCost)}</span>
          </div>
        </div>
      </div>

      {/* Critic */}
      {c && (
        <div className="mb-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Critic · {modelLabel(c.model)}
          </div>
          <div className="space-y-0.5 text-gray-500 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Input</span>
              <span>{formatTokens(c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens)} tokens</span>
            </div>
            {c.cacheReadTokens > 0 && (
              <div className="flex justify-between pl-2 text-green-600 dark:text-green-500">
                <span>↳ cached (read)</span>
                <span>{formatTokens(c.cacheReadTokens)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Output</span>
              <span>{formatTokens(c.outputTokens)} tokens</span>
            </div>
            <div className="flex justify-between font-medium text-gray-700 dark:text-gray-300 pt-0.5 border-t border-gray-100 dark:border-gray-800">
              <span>Cost</span>
              <span>{formatCost(c.estimatedCost)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Prior revision cost */}
      {(prior ?? 0) > 0 && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex justify-between text-gray-400 dark:text-gray-500 text-xs">
            <span>Prior revision(s)</span>
            <span>{formatCost(prior!)}</span>
          </div>
        </div>
      )}

      {/* Total */}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between font-semibold text-gray-800 dark:text-gray-200">
        <span>Total</span>
        <span>{formatCost(totalCost)}</span>
      </div>
    </div>,
    document.body
  );
}

// ── Token icon with hover tooltip ────────────────────────────────────────────

function StageTokenIcon({ tokenUsage }: { tokenUsage: string | null }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const iconRef = useRef<HTMLSpanElement>(null);

  if (!tokenUsage) return null;
  let data: StageTokenData;
  try { data = JSON.parse(tokenUsage); } catch { return null; }

  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setVisible(true);
  };

  return (
    <span
      ref={iconRef}
      className="text-xs text-gray-400 dark:text-gray-500 cursor-help select-none leading-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      ⓘ
      {visible && <StageTokenTooltipContent data={data} style={{ top: pos.top, left: pos.left }} />}
    </span>
  );
}

// ── Helper functions ─────────────────────────────────────────────────────────

function stageIcon(status: StageStatus) {
  switch (status) {
    case 'complete':       return <span className="text-green-500">✓</span>;
    case 'in-progress':    return <span className="text-blue-500 animate-pulse">●</span>;
    case 'at-checkpoint':  return <span className="text-amber-500 animate-pulse">⏸</span>;
    case 'rejected':       return <span className="text-red-500">✕</span>;
    case 'skipped':        return <span className="text-gray-400">—</span>;
    default:               return <span className="text-gray-300 dark:text-gray-600">○</span>;
  }
}

function stageDot(status: StageStatus) {
  const base = 'w-2 h-2 rounded-full flex-shrink-0';
  switch (status) {
    case 'complete':       return <span className={`${base} bg-green-500`} />;
    case 'in-progress':    return <span className={`${base} bg-blue-500 animate-pulse`} />;
    case 'at-checkpoint':  return <span className={`${base} bg-amber-500 animate-pulse`} />;
    case 'rejected':       return <span className={`${base} bg-red-500`} />;
    case 'skipped':        return <span className={`${base} bg-gray-300 dark:bg-gray-600`} />;
    default:               return <span className={`${base} bg-gray-200 dark:bg-gray-700`} />;
  }
}

// ── StageRow component ───────────────────────────────────────────────────────

export function StageRow({
  stageName,
  index,
  status,
  checkpoint,
  latestApproved,
  completedAt,
  agentModel,
  onViewArtifact,
}: StageRowProps) {
  return (
    <div>
      {/* Connector line (skip first) */}
      {index > 0 && (
        <div className="ml-3 w-px h-2 bg-gray-200 dark:bg-gray-700" />
      )}

      <div
        className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${
          status === 'at-checkpoint'
            ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
            : status === 'in-progress'
            ? 'bg-blue-50 dark:bg-blue-900/20'
            : ''
        }`}
      >
        <div className="mt-0.5">{stageDot(status)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs ${labelClass(status)}`}>
              {STAGE_LABELS[stageName] ?? stageName}
            </span>
            <span className="text-xs">{stageIcon(status)}</span>
            {agentModel && (
              <span className="text-xs text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 leading-none">
                {agentModel}
              </span>
            )}
            {(() => {
              const cp = checkpoint?.token_usage
                ? checkpoint
                : latestApproved?.token_usage
                ? latestApproved
                : undefined;
              if (!cp?.token_usage) return null;
              return <StageTokenIcon tokenUsage={cp.token_usage} />;
            })()}
          </div>
          {status === 'at-checkpoint' && checkpoint && (() => {
            let diffArtifactId: number | null = null;
            try {
              const action = JSON.parse(checkpoint.coordinator_action ?? '{}');
              diffArtifactId = action.diff_artifact_id ?? null;
            } catch { /* ignore */ }
            return (
              <div className="mt-0.5">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Awaiting review
                  {checkpoint.coordinator_action && (() => {
                    try {
                      const action = JSON.parse(checkpoint.coordinator_action);
                      if (action.critic_verdict) return ` — Flint: ${action.critic_verdict}`;
                    } catch { /* ignore */ }
                    return '';
                  })()}
                </p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {checkpoint.artifact_id && (
                    <button
                      onClick={() => onViewArtifact(checkpoint.artifact_id!)}
                      className="text-xs px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                    >
                      Review output
                    </button>
                  )}
                  {diffArtifactId && (
                    <button
                      onClick={() => onViewArtifact(diffArtifactId!)}
                      className="text-xs px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      View diff
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          {status === 'complete' && (() => {
            let approvedDiffId: number | null = null;
            try {
              const action = JSON.parse(latestApproved?.coordinator_action ?? '{}');
              approvedDiffId = action.diff_artifact_id ?? null;
            } catch { /* ignore */ }
            return (
              <div className="flex items-center gap-2 mt-0.5">
                {completedAt && (
                  <span className="text-xs text-gray-400 dark:text-gray-600">
                    {new Date(completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {latestApproved?.artifact_id && (
                  <button
                    onClick={() => onViewArtifact(latestApproved.artifact_id!)}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  >
                    View
                  </button>
                )}
                {approvedDiffId && (
                  <button
                    onClick={() => onViewArtifact(approvedDiffId!)}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  >
                    Diff
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
