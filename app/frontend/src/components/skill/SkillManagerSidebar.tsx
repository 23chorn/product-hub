import type { SkillVersion } from '../../services/api';
import { getAgentDisplayName } from '../../utils/agent-display-names';
import { SectionHeader } from './SectionHeader';
import { useAuthStore } from '../../stores/authStore';
import { STAGE_SHORT_LABELS } from '../../constants/stage-labels';
import {
  DISCIPLINE_LABELS,
  DISCIPLINE_COLORS,
  type AgentItem,
  type ContextFile,
  type Discipline,
  type ExtractedTool,
  type PersonaFile,
} from './types';

type SectionKey = 'context' | 'behaviour' | 'agents' | 'skills' | 'tools';

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
  // Agents
  agentItems: AgentItem[];
  selectedSkillName: string | null;
  selectedAgentName: string | null;
  onSelectSkill: (skill: SkillVersion) => void;
  onCreatePersona: (persona: PersonaFile) => void;
  onNewAgent: () => void;
  // Skills
  domainSkills: SkillVersion[];
  filteredDomainSkills: SkillVersion[];
  filterDiscipline: Discipline;
  onFilterDisciplineChange: (d: Discipline) => void;
  onNewSkill: () => void;
  // Tools
  allTools: ExtractedTool[];
  selectedToolName: string | null;
  onSelectTool: (tool: ExtractedTool) => void;
}

const plusIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
  </svg>
);

// Domain "Skills" section has no defined use yet — flip to true to bring it back.
const SHOW_SKILLS_SECTION = false;

/** Left navigation for the Agent Studio: collapsible Context / Agents / Skills / Tools sections. */
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
  agentItems,
  selectedSkillName,
  selectedAgentName,
  onSelectSkill,
  onCreatePersona,
  onNewAgent,
  domainSkills,
  filteredDomainSkills,
  filterDiscipline,
  onFilterDisciplineChange,
  onNewSkill,
  allTools,
  selectedToolName,
  onSelectTool,
}: SkillManagerSidebarProps) {
  const { user, noAuth } = useAuthStore();

  function canEdit(editRoles: string[] | null): boolean {
    if (noAuth || !user) return true;
    if (user.is_admin) return true;
    if (user.roles.includes('view_only')) return false;
    if (editRoles === null) return true;
    if (editRoles.length === 0) return false;
    return editRoles.some(r => user.roles.includes(r));
  }

  return (
    <nav className="w-60 border-r border-surface-200 dark:border-surface-700 flex flex-col flex-shrink-0 bg-white dark:bg-surface-800/50 overflow-y-auto">
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
          {expanded.context && (
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
            count={agentItems.length}
            isOpen={expanded.agents}
            onToggle={() => onToggle('agents')}
            action={
              canCreate ? (
                <button
                  onClick={onNewAgent}
                  className="p-0.5 rounded text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                  title="New agent"
                >
                  {plusIcon}
                </button>
              ) : undefined
            }
          />
          {expanded.agents && agentItems.map((item) => {
            const isSelected =
              (item.type === 'skill' && selectedSkillName === item.skill.skill_name) ||
              (item.type === 'persona' && selectedAgentName === item.persona.skillName);
            const publishedSkill = item.type === 'skill' ? item.skill : item.publishedSkill;
            const editable = publishedSkill ? canEdit(publishedSkill.editRoles ?? null) : true;
            return (
              <button
                key={item.key}
                onClick={() => {
                  if (item.type === 'skill') {
                    onSelectSkill(item.skill);
                  } else if (item.publishedSkill) {
                    onSelectSkill(item.publishedSkill);
                  } else {
                    onCreatePersona(item.persona);
                  }
                }}
                className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
                  isSelected
                    ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                    : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm text-surface-800 dark:text-surface-200 truncate">{item.displayName}</span>
                  {!editable && (
                    <svg className="w-3 h-3 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                </div>
                {item.type === 'skill' ? (
                  <div className="text-xs text-surface-400 mt-0.5">v{item.skill.version} · {item.skill.owner_team}</div>
                ) : item.publishedSkill ? (
                  <div className="text-xs text-surface-400 mt-0.5">v{item.publishedSkill.version} · {item.publishedSkill.owner_team}</div>
                ) : (
                  <div className="text-xs px-1 py-0 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 mt-0.5 inline-block">not published</div>
                )}
              </button>
            );
          })}

          {/* ── Skills (hidden until a use is defined) ──── */}
          {SHOW_SKILLS_SECTION && (
            <>
              <SectionHeader
                label="Skills"
                count={domainSkills.length}
                isOpen={expanded.skills}
                onToggle={() => onToggle('skills')}
                action={
                  canCreate ? (
                    <button
                      onClick={onNewSkill}
                      className="p-0.5 rounded text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                      title="New skill"
                    >
                      {plusIcon}
                    </button>
                  ) : undefined
                }
              />
              {expanded.skills && (
                <>
                  {/* Discipline filter chips */}
                  <div className="px-3 pb-2 flex flex-wrap gap-1">
                    {(['all', 'dev', 'qa', 'design', 'general'] as ('all' | Discipline)[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => onFilterDisciplineChange(d as Discipline)}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          filterDiscipline === d
                            ? 'bg-brand-600 text-white'
                            : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
                        }`}
                      >
                        {d === 'all' ? 'All' : DISCIPLINE_LABELS[d]}
                      </button>
                    ))}
                  </div>
                  {/* Skill items grouped by discipline */}
                  {filteredDomainSkills.length === 0 ? (
                    <div className="px-4 pb-2 text-xs text-surface-400">No skills found</div>
                  ) : (
                    (['dev', 'qa', 'design', 'general'] as const)
                      .filter((d) => filteredDomainSkills.some((s) => s.discipline === d))
                      .map((disc) => (
                        <div key={disc}>
                          {filterDiscipline === 'all' && (
                            <div className="px-4 pt-1 pb-0.5 text-xs font-medium text-surface-400 dark:text-surface-500">
                              {DISCIPLINE_LABELS[disc]}
                            </div>
                          )}
                          {filteredDomainSkills.filter((s) => s.discipline === disc).map((skill) => (
                            <button
                              key={skill.skill_name}
                              onClick={() => onSelectSkill(skill)}
                              className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
                                selectedSkillName === skill.skill_name
                                  ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                                  : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
                              }`}
                            >
                              <div className="flex items-center space-x-1.5">
                                <span className={`px-1.5 py-0 rounded text-xs font-medium ${DISCIPLINE_COLORS[disc]}`}>
                                  {DISCIPLINE_LABELS[disc]}
                                </span>
                                <span className="text-sm text-surface-800 dark:text-surface-200 truncate">
                                  {skill.discipline === 'agent' ? getAgentDisplayName(skill) : skill.skill_name}
                                </span>
                              </div>
                              <div className="text-xs text-surface-400 mt-0.5 pl-0.5">v{skill.version} · {skill.owner_team}</div>
                            </button>
                          ))}
                        </div>
                      ))
                  )}
                </>
              )}
            </>
          )}

          {/* ── Tools ───────────────────────────────────── */}
          <SectionHeader
            label="Tools"
            count={allTools.length}
            isOpen={expanded.tools}
            onToggle={() => onToggle('tools')}
          />
          {expanded.tools && (
            allTools.length === 0 ? (
              <div className="px-4 pb-2 text-xs text-surface-400">No tools registered</div>
            ) : (
              allTools.map((tool) => (
                <button
                  key={`${tool.sourceSkillName}:${tool.name}`}
                  onClick={() => onSelectTool(tool)}
                  className={`w-full text-left px-4 py-2 border-b border-surface-100 dark:border-surface-700/40 transition-colors ${
                    selectedToolName === tool.name
                      ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-500'
                      : 'hover:bg-surface-50 dark:hover:bg-surface-700/30 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="text-sm font-mono text-surface-800 dark:text-surface-200 truncate">{tool.name}</div>
                  <div className="text-xs text-surface-400 mt-0.5 truncate">from {tool.sourceSkillName}</div>
                </button>
              ))
            )
          )}
        </>
      )}
    </nav>
  );
}
