import { useState, useRef, useEffect } from 'react';
import { resolveDisplayTitle } from '@pap/shared';
import { effectiveStatus, type EnrichedItem } from './types';
import { StatusBadge } from './StatusBadge';
import { useAuthStore, ROLE_LABELS, canLaunchWorkflow } from '../../stores/authStore';
import { CardContextMenu } from '../common/CardContextMenu';
import { ArchiveConfirmModal } from '../common/ArchiveConfirmModal';

/** Format a workflow's last state-change timestamp, e.g. "18 Jun, 14:32". */
function formatUpdatedAt(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Card for one initiative in the HomeScreen grid: title, status, tags, and launch/resume/delete actions.
 *  Admins also get a right-click menu to archive an initiative that's already completed its
 *  pipeline run — same archive endpoint and confirm dialog as the Progress Tracker page. */
export function InitiativeCard({
  item, isDeleting, isConfirmingDelete, isAnalysing,
  isArchiving, isConfirmingArchive,
  onLaunch, onResume, onRequestDelete, onConfirmDelete, onCancelDelete,
  onRequestArchive, onConfirmArchive, onCancelArchive,
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

  // Can archive completed initiatives or not-started ones (no workflow yet)
  const isArchived = item.status === 'archived';
  const canArchive = isAdmin && !isArchived && (isComplete || !wf);
  const canUnarchive = isAdmin && isArchived;
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!canArchive && !canUnarchive) return; // not eligible — let the native browser menu show
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
      className={`relative group rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/80 hover:border-surface-300 dark:hover:border-surface-600 hover:shadow-sm transition-all p-5 flex flex-col ${isExpanded ? 'h-auto' : 'h-64'}`}
    >
      {menuPos && (
        <CardContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          items={
            canUnarchive
              ? [{ label: 'Unarchive Initiative', danger: false, onClick: onRequestArchive }]
              : [{ label: 'Archive Initiative', danger: true, onClick: onRequestArchive }]
          }
        />
      )}

      {isConfirmingArchive && (
        <ArchiveConfirmModal
          mode={canUnarchive ? "unarchive" : "archive"}
          itemTitle={item.initiative}
          loading={isArchiving}
          onCancel={onCancelArchive}
          onConfirm={onConfirmArchive}
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

          {/* Delete controls (local items only) */}
          {item.source !== 'airtable' && !isDemo && (
            isConfirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <button onClick={onConfirmDelete} disabled={isDeleting}
                  className="text-[10px] px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 font-medium">
                  Delete
                </button>
                <button onClick={onCancelDelete}
                  className="text-[10px] px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onRequestDelete(); }} disabled={isDeleting}
                className="opacity-0 group-hover:opacity-100 p-1 text-surface-300 dark:text-surface-600 hover:text-red-400 dark:hover:text-red-500 transition-all">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>

      {/* Row 2: status badges */}
      <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 mb-3">
        {wf?.isDemo && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700">
            Demo
          </span>
        )}
        <StatusBadge wf={wf} />
        {isAdmin && approvalBadges.map((label) => (
          <span
            key={label}
            className="flex-shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400"
            title={`Requires approval from: ${label === 'approval' ? 'any role' : label.replace(/\//g, ' or ')}`}
          >
            Needs {label}
          </span>
        ))}
      </div>

      {/* Row 3: description / running-stage line - flexible area */}
      <div className={`min-h-0 mb-3 ${wf?.currentStage && wf.status === 'active' ? '' : 'flex-1'}`}>
        {wf?.currentStage && wf.status === 'active' ? (
          <p className="text-xs text-surface-400 dark:text-surface-500">
            {`Running ${wf.currentStage.replace(/_/g, ' ')}`}
          </p>
        ) : item.description ? (
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

      {/* Row 4: product area + theme */}
      {(item.productArea || item.strategicTheme) && (
        <div className="flex flex-wrap gap-1 flex-shrink-0 mb-2">
          {item.productArea && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400">
              {item.productArea}
            </span>
          )}
          {item.strategicTheme && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400">
              {item.strategicTheme}
            </span>
          )}
        </div>
      )}

      {/* Row 5: last updated, bottom */}
      {wf?.updatedAt && (
        <p className="text-[10px] text-surface-400 dark:text-surface-500 flex-shrink-0">
          Updated {formatUpdatedAt(wf.updatedAt)}
        </p>
      )}
    </div>
  );
}
