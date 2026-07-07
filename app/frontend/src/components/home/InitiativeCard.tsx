import { useState, useRef, useEffect } from 'react';
import { resolveDisplayTitle } from '@pap/shared';
import { STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import { effectiveStatus, type EnrichedItem } from './types';
import { StatusBadge } from './StatusBadge';
import { useAuthStore, ROLE_LABELS, canLaunchWorkflow } from '../../stores/authStore';
import { CardContextMenu } from '../common/CardContextMenu';
import { ArchiveConfirmModal } from '../common/ArchiveConfirmModal';
import { formatAssignedLabel } from '../../utils/assigned-users';
import { splitProductAreas } from '../../utils/product-area';

/** Format a workflow's last state-change timestamp, e.g. "18 Jun, 14:32". */
function formatUpdatedAt(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/**
 * Derive the display stage list from the workflow's actual stage_sequence. Only
 * shows real LLM stages — strips out dynamic feature sub-stages (story_decomposition_F*)
 * that would overflow the dot bar, and backlog_merge, which is a plain JSON concatenation
 * of the per-feature story artifacts with no LLM call, so it doesn't get its own dot.
 *
 * epic_qa isn't seeded into stage_sequence at launch — the backend only injects it once
 * epic_feature_planner finishes and the feature count is known (see
 * injectFeatureDecompositionStages), replacing the single 'story_decomposition' placeholder
 * with the expanded F* stages + backlog_merge + epic_qa. Without this, the "test cases" dot
 * would pop into the bar mid-run instead of always being there like the stories placeholder
 * is — insert it as a placeholder too, right where it'll land once the real expansion happens.
 */
function displayStages(stageSequence: string[] | undefined): string[] {
  if (!stageSequence || stageSequence.length === 0) return [];
  const isStoryStage = (s: string) => s === 'story_decomposition' || /^story_decomposition_F\d+$/.test(s);
  const firstStoryIdx = stageSequence.findIndex(isStoryStage);
  const filtered = stageSequence.filter(s => !isStoryStage(s) && s !== 'backlog_merge');
  if (firstStoryIdx === -1) return filtered;

  // Re-insert a single 'story_decomposition' ("stories") placeholder at the position where
  // the (possibly already-expanded) per-feature run started — covers both the pre-expansion
  // single placeholder and the post-expansion F1..Fn entries, both filtered out above.
  const insertAt = stageSequence
    .slice(0, firstStoryIdx)
    .filter(s => !isStoryStage(s) && s !== 'backlog_merge').length;
  filtered.splice(insertAt, 0, 'story_decomposition');
  if (!filtered.includes('epic_qa')) {
    filtered.splice(insertAt + 1, 0, 'epic_qa');
  }
  return filtered;
}

/** Map a current stage to its display-stage equivalent.
 *  story_decomposition_F* sub-stages and backlog_merge itself (the JSON-merge step with no
 *  dot of its own) are filtered from the bar, so while either is active we pin the indicator
 *  to 'story_decomposition' — the "stories" dot stays current until epic_qa actually starts. */
function normalizeCurrentStage(currentStage: string | null, stages: string[]): string | null {
  if (!currentStage) return null;
  if (stages.includes(currentStage)) return currentStage;
  if (currentStage === 'backlog_merge' || /^story_decomposition_F\d+$/.test(currentStage)) {
    return stages.includes('story_decomposition') ? 'story_decomposition' : null;
  }
  return null;
}

/** Card for one initiative in the HomeScreen grid: title, status, tags, and launch/resume actions.
 *  Right-click menu: any authenticated user can assign/unassign themselves; admins can also
 *  archive/unarchive (any workflow state), delete (local, non-demo items only), and open the
 *  user-assign flyout. */
export function InitiativeCard({
  item, isDeleting, isConfirmingDelete, isAnalysing,
  isArchiving, isConfirmingArchive,
  onLaunch, onResume, onRequestDelete, onConfirmDelete, onCancelDelete,
  onRequestArchive, onConfirmArchive, onCancelArchive,
  onAssignToMe, onUnassignFromMe, onOpenAssignFlyout,
}: {
  item: EnrichedItem;
  isDeleting: boolean;
  isConfirmingDelete: boolean;
  isAnalysing: boolean;
  isArchiving: boolean;
  isConfirmingArchive: boolean;
  onLaunch: () => void;
  onResume: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onRequestArchive: () => void;
  onConfirmArchive: () => void;
  onCancelArchive: () => void;
  onAssignToMe: () => void;
  onUnassignFromMe: () => void;
  onOpenAssignFlyout: () => void;
}) {
  const { user, noAuth } = useAuthStore();
  const isAdmin = noAuth || !!user?.is_admin;
  const canLaunch = canLaunchWorkflow(user, noAuth);
  const wf = item.workflow;
  const eff = wf ? effectiveStatus(wf) : undefined;
  const isActive = eff === 'active' || eff === 'paused_at_checkpoint';
  const isComplete = eff === 'complete';
  const isCancelled = eff === 'cancelled';
  const isDemo = !!wf?.isDemo;
  const needsReview = eff === 'paused_at_checkpoint';
  const pendingApprovals = needsReview ? wf?.pendingApprovals ?? [] : [];

  const isArchived = item.status === 'archived';
  // Archiving is a soft, reversible move to the Archived filter — allowed from any
  // workflow state (unlike the old restriction to complete/no-workflow items).
  const canArchive = isAdmin && !isArchived;
  const canUnarchive = isAdmin && isArchived;
  const canShowAssign = !noAuth && !!user;
  const assignedUsers = item.assignedUsers ?? [];
  const isAssignedToMe = canShowAssign && assignedUsers.some(u => u.id === user!.id);
  // Delete is a hard, permanent removal — local (non-Airtable) items only, admin-only,
  // and not for demo workflows (mirrors the backend's DELETE /api/initiatives/:id gating).
  const canDelete = isAdmin && item.source !== 'airtable' && !isDemo;

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!canArchive && !canUnarchive && !canShowAssign && !canDelete) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Collapse to one badge per distinct required-role set. During refinement many parallel
  // stages await the same role, which otherwise renders a row of identical "Needs X" badges.
  const approvalBadges = [...new Set(
    pendingApprovals.map(({ roles }) =>
      roles.length > 0 ? roles.map(r => ROLE_LABELS[r] ?? r).join('/') : 'approval'
    ),
  )];

  const [isExpanded, setIsExpanded] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // Check if description is truncated
  useEffect(() => {
    if (descriptionRef.current) {
      setIsTruncated(descriptionRef.current.scrollHeight > descriptionRef.current.clientHeight);
    }
  }, [item.description]);

  return (
    <div
      onContextMenu={handleContextMenu}
      className={`relative group rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/80 hover:border-surface-300 dark:hover:border-surface-600 hover:shadow-sm transition-all p-5 flex flex-col ${isExpanded ? 'h-auto' : 'h-64'} ${isComplete ? 'opacity-50 hover:opacity-100' : ''}`}
    >
      {menuPos && (() => {
        const items = [];
        if (canUnarchive) items.push({ label: 'Unarchive Initiative', danger: false, onClick: onRequestArchive });
        else if (canArchive) items.push({ label: 'Archive Initiative', danger: true, onClick: onRequestArchive });
        if (canShowAssign) {
          if (isAssignedToMe) items.push({ label: 'Remove my assignment', danger: false, onClick: onUnassignFromMe });
          else items.push({ label: 'Assign to me', danger: false, onClick: onAssignToMe });
          if (isAdmin) items.push({ label: 'Assign to user…', danger: false, onClick: onOpenAssignFlyout });
        }
        if (canDelete) items.push({ label: 'Delete Initiative', danger: true, onClick: onRequestDelete });
        return (
          <CardContextMenu
            x={menuPos.x}
            y={menuPos.y}
            onClose={() => setMenuPos(null)}
            items={items}
          />
        );
      })()}

      {isConfirmingArchive && (
        <ArchiveConfirmModal
          mode={canUnarchive ? "unarchive" : "archive"}
          itemTitle={item.initiative}
          loading={isArchiving}
          onCancel={onCancelArchive}
          onConfirm={onConfirmArchive}
        />
      )}

      {isConfirmingDelete && (
        <ArchiveConfirmModal
          mode="delete"
          itemTitle={item.initiative}
          loading={isDeleting}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}

      {/* Row 1: number + title + action button */}
      <div className="flex items-start gap-2 flex-shrink-0">
        {item.seqNum != null && (
          <span
            title={`Initiative #${item.seqNum}`}
            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400"
          >
            #{item.seqNum}
          </span>
        )}
        <h3 className="flex-1 min-w-0 text-base font-semibold text-surface-900 dark:text-surface-100 leading-snug line-clamp-2">
          {resolveDisplayTitle(item.initiative, wf?.summary)}
        </h3>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Action button */}
          {isActive ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg border border-cyan-300 dark:border-cyan-700 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 font-medium transition-colors">
                Continue →
              </button>
            ) : isCancelled ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors">
                Restart →
              </button>
            ) : isComplete ? (
              <button onClick={onResume}
                className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700/50 font-medium transition-colors">
                View →
              </button>
            ) : !canLaunch ? (
              <span title="Only Product or Admin users can launch a workflow" className="cursor-not-allowed">
                <button disabled
                  className="text-xs px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-400 dark:text-surface-600 font-medium pointer-events-none">
                  Launch →
                </button>
              </span>
            ) : (
              <button onClick={onLaunch} disabled={isAnalysing}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 disabled:opacity-60 font-medium transition-colors flex items-center gap-1.5">
                {isAnalysing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Analysing…
                  </>
                ) : 'Launch →'}
              </button>
            )}
        </div>
      </div>

      {/* Row 2: status badges + product area + theme */}
      <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 mb-3">
        {wf?.isDemo && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700">
            Demo
          </span>
        )}
        <StatusBadge wf={wf} isPaused={item.isPaused} />
        {assignedUsers.length > 0 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400"
            title={assignedUsers.map(u => u.name).join(', ')}
          >
            {formatAssignedLabel(assignedUsers, canShowAssign ? user!.id : undefined)}
          </span>
        )}
        {isAdmin && approvalBadges.map((label) => (
          <span
            key={label}
            className="flex-shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400"
            title={`Requires approval from: ${label === 'approval' ? 'any role' : label.replace(/\//g, ' or ')}`}
          >
            Needs {label}
          </span>
        ))}
        {item.productArea && splitProductAreas(item.productArea).map(area => (
          <span key={area} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400">
            {area}
          </span>
        ))}
        {item.strategicTheme && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400">
            {item.strategicTheme}
          </span>
        )}
      </div>

      {/* Row 3: description - flexible area */}
      <div className="flex-1 min-h-0 mb-3">
        {item.description ? (
          <div>
            <p
              ref={descriptionRef}
              className={`text-sm text-surface-500 dark:text-surface-400 ${isExpanded ? '' : 'line-clamp-3'}`}
            >
              {item.description}
            </p>
            {isTruncated && (
              <button
                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                className="text-xs text-brand-600 dark:text-brand-400 hover:underline mt-1"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Progress bar with stage checkpoints */}
      {wf && (isActive || isComplete) && (() => {
        const stages = displayStages(wf.stageSequence);
        // Always append a virtual 'complete' dot — 100% is only reached when the workflow finishes.
        const stagesWithComplete = [...stages, 'complete'];
        const total = stagesWithComplete.length;

        let currentStageIdx: number;
        if (isComplete) {
          currentStageIdx = total - 1;
        } else {
          const effectiveStage = normalizeCurrentStage(wf.currentStage, stages);
          currentStageIdx = effectiveStage ? stages.indexOf(effectiveStage) : -1;
        }

        if (!isComplete && stages.length === 0) return null;

        const pct = currentStageIdx <= 0 ? 0 : Math.round((currentStageIdx / (total - 1)) * 100);

        return (
          <div className="flex-shrink-0 mb-2">
            <div className="flex items-center justify-end mb-1">
              <span className="text-[10px] font-medium text-surface-500 dark:text-surface-400">
                {pct}%
              </span>
            </div>

            {/* Progress bar with checkpoint markers */}
            <div className="relative pb-6">
              {/* Background bar */}
              <div className="h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-all duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Stage checkpoint markers */}
              <div className="absolute top-0 left-0 right-0 h-1.5 flex items-center justify-between">
                {stagesWithComplete.map((stage, idx) => {
                  const isCompleted = idx < currentStageIdx;
                  const isCurrent = idx === currentStageIdx;
                  // 'complete' is a virtual dot appended locally, not a real workflow stage.
                  const shortName = stage === 'complete' ? 'Done' : (STAGE_SHORT_LABELS[stage] ?? stage);
                  // First/last dots sit flush with the bar's edges (justify-between) — centering
                  // their labels like the middle dots makes the text overhang past the bar edge
                  // toward the card border. Align those two labels to their dot's edge instead,
                  // so they start/end inline with the card's own margin.
                  const isFirst = idx === 0;
                  const isLast = idx === stagesWithComplete.length - 1;
                  const edgeAlign = isFirst ? 'items-start' : isLast ? 'items-end' : 'items-center';
                  return (
                    <div key={stage} className={`relative flex flex-col ${edgeAlign}`}>
                      <div className={`w-2 h-2 rounded-full border-2 transition-all ${
                        isCompleted || (isCurrent && stage === 'complete')
                          ? 'bg-brand-500 border-brand-500'
                          : isCurrent
                          ? 'bg-white dark:bg-surface-900 border-brand-500 ring-2 ring-brand-500 ring-offset-1'
                          : 'bg-surface-100 dark:bg-surface-800 border-surface-300 dark:border-surface-600'
                      }`} />
                      <div className={`absolute top-3 text-[10px] font-medium whitespace-nowrap transition-colors ${
                        isCompleted || isCurrent
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-surface-400 dark:text-surface-600'
                      }`}>
                        {shortName}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Row 5: last updated, bottom */}
      {wf?.updatedAt && (
        <p className="text-[10px] text-surface-400 dark:text-surface-500 flex-shrink-0">
          Updated {formatUpdatedAt(wf.updatedAt)}
        </p>
      )}
    </div>
  );
}
