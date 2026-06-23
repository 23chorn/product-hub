import type { AgentFile } from '../../services/api';
import { getAgentDisplayName } from '../../utils/agent-display-names';
import { SectionHeader } from './SectionHeader';
import { useAuthStore } from '../../stores/authStore';
import { STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import { DocReviewSidebarSection } from '../knowledge/DocReviewSidebarSection';
import type { KbFileListItem } from '@pap/shared';
import type { ContextFile } from './types';

type SectionKey = 'context' | 'behaviour' | 'agents' | 'templates' | 'docs';

interface SkillManagerSidebarProps {
  isLoading: boolean;
  expanded: Record<SectionKey, boolean>;
  onToggle: (key: SectionKey) => void;
  /** False for view_only users — hides every "create new" affordance in the nav. */
  canCreate: boolean;
  // Context
  contextFiles: ContextFile[];
  selectedCtxIndex: number | null;
  onSelectContext: (index: number, file: ContextFile) => void;
  onNewContext: () => void;
  pendingProposalCount: number;
  isAirtableSyncSelected: boolean;
  onSelectAirtableSync: () => void;
  // Behaviour docs
  behaviourFiles: ContextFile[];
  selectedBehaviourIndex: number | null;
  onSelectBehaviour: (index: number, file: ContextFile) => void;
  // Agent files (personas + output templates)
  personaFiles: AgentFile[];
  templateFiles: AgentFile[];
  selectedAgentFileKey: string | null;
  onSelectAgentFile: (file: AgentFile) => void;
  // Documentation Review
  selectedDocFileId: number | null;
  onSelectDocFile: (file: KbFileListItem) => void;
}

const plusIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
  </svg>
);

/** Left navigation for the Knowledge Studio: collapsible Context / Behaviour / Agents / Templates / Docs sections. */
export function SkillManagerSidebar({
  isLoading,
  expanded,
  onToggle,
  canCreate,
  contextFiles,
  selectedCtxIndex,
  onSelectContext,
  onNewContext,
  pendingProposalCount,
  isAirtableSyncSelected,
  onSelectAirtableSync,
  behaviourFiles,
  selectedBehaviourIndex,
  onSelectBehaviour,
  personaFiles,
  templateFiles,
  selectedAgentFileKey,
  onSelectAgentFile,
  selectedDocFileId,
  onSelectDocFile,
}: SkillManagerSidebarProps) {
  const { user, noAuth } = useAuthStore();
  const isAdmin = noAuth || !!user?.is_admin;

  function canEdit(editRoles: string[] | null): boolean {
    if (noAuth || !user) return true;
    if (user.is_admin) return true;
    if (user.roles.includes('view_only')) return false;
    if (editRoles === null) return true;
    if (editRoles.length === 0) return false;
    return editRoles.some(r => user.roles.includes(r));
  }

  const agentFileButton = (file: AgentFile) => {
    const editable = canEdit(file.editRoles);
    return (
      <button
        key={file.key}
        onClick={() => onSelectAgentFile(file)}
        className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
          selectedAgentFileKey === file.key
            ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
            : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm text-surface-800 dark:text-surface-200 truncate">{getAgentDisplayName(file.key)}</span>
          {!editable && (
            <svg className="w-3 h-3 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
        </div>
      </button>
    );
  };

  return (
    <nav className="w-full h-full border-r border-surface-200 dark:border-surface-700 flex flex-col flex-shrink-0 bg-white dark:bg-surface-800/50 overflow-y-auto">
      {isLoading ? (
        <div className="p-4 text-xs text-surface-400">Loading…</div>
      ) : (
        <>
          {/* ── Context ─────────────────────────────── */}
          <SectionHeader
            label="Context"
            count={contextFiles.length}
            isOpen={expanded.context}
            onToggle={() => onToggle('context')}
            action={
              canCreate ? (
                <button
                  onClick={onNewContext}
                  className="p-0.5 rounded text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                  title="New context file"
                >
                  {plusIcon}
                </button>
              ) : undefined
            }
          />
          {expanded.context && isAdmin && (
            <button
              onClick={onSelectAirtableSync}
              className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors flex items-center justify-between ${
                isAirtableSyncSelected
                  ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                  : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
              }`}
            >
              <span className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Airtable Sync
              </span>
              {pendingProposalCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium flex-shrink-0">
                  {pendingProposalCount}
                </span>
              )}
            </button>
          )}
          {expanded.context && contextFiles.map((file, i) => {
            const editable = canEdit(file.editRoles);
            const stageLabels: string[] = file.stages
              ? file.stages.map(s => STAGE_SHORT_LABELS[s] ?? s).filter(Boolean)
              : ['All agents'];
            return (
              <button
                key={file.fileName}
                onClick={() => onSelectContext(i, file)}
                className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
                  selectedCtxIndex === i
                    ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                    : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${file.content ? 'bg-green-500' : 'bg-surface-300 dark:bg-surface-600'}`} />
                    <span className="text-sm text-surface-800 dark:text-surface-200 truncate">{file.label}</span>
                  </div>
                  {!editable && (
                    <svg className="w-3 h-3 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                </div>
                {stageLabels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 pl-3.5">
                    {stageLabels.map(label => (
                      <span
                        key={label}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium leading-none ${
                          label === 'All agents'
                            ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400'
                            : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}

          {/* ── Behaviour Docs ──────────────────────── */}
          <SectionHeader
            label="Behaviour Docs"
            count={behaviourFiles.length}
            isOpen={expanded.behaviour}
            onToggle={() => onToggle('behaviour')}
          />
          {expanded.behaviour && (
            behaviourFiles.length === 0 ? (
              <div className="px-4 pb-2 text-xs text-surface-400">No behaviour docs found in context/behaviour/features</div>
            ) : (
              behaviourFiles.map((file, i) => {
                const editable = canEdit(file.editRoles);
                return (
                  <button
                    key={file.fileName}
                    onClick={() => onSelectBehaviour(i, file)}
                    className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
                      selectedBehaviourIndex === i
                        ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                        : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${file.content ? 'bg-green-500' : 'bg-surface-300 dark:bg-surface-600'}`} />
                        <span className="text-sm text-surface-800 dark:text-surface-200 truncate">{file.label}</span>
                      </div>
                      {!editable && (
                        <svg className="w-3 h-3 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      )}
                    </div>
                    <div className="text-xs text-surface-400 mt-0.5 pl-3.5">{file.description}</div>
                  </button>
                );
              })
            )
          )}

          {/* ── Agents ──────────────────────────────── */}
          <SectionHeader
            label="Agents"
            count={personaFiles.length}
            isOpen={expanded.agents}
            onToggle={() => onToggle('agents')}
          />
          {expanded.agents && personaFiles.map(agentFileButton)}

          {/* ── Output Templates ────────────────────── */}
          <SectionHeader
            label="Output Templates"
            count={templateFiles.length}
            isOpen={expanded.templates}
            onToggle={() => onToggle('templates')}
          />
          {expanded.templates && templateFiles.map(agentFileButton)}

          {/* ── Documentation Review ────────────────────── */}
          <DocReviewSidebarSection
            isOpen={expanded.docs}
            onToggle={() => onToggle('docs')}
            selectedFileId={selectedDocFileId}
            onSelectFile={onSelectDocFile}
          />
        </>
      )}
    </nav>
  );
}
