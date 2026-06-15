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

type SectionKey = 'context' | 'agents' | 'skills' | 'tools';

interface SkillManagerSidebarProps {
  isLoading: boolean;
  expanded: Record<SectionKey, boolean>;
  onToggle: (key: SectionKey) => void;
  // Context
  contextFiles: ContextFile[];
  selectedCtxIndex: number | null;
  onSelectContext: (index: number, file: ContextFile) => void;
  onNewContext: () => void;
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

/** Left navigation for the Agent Studio: collapsible Context / Agents / Skills / Tools sections. */
export function SkillManagerSidebar({
  isLoading,
  expanded,
  onToggle,
  contextFiles,
  selectedCtxIndex,
  onSelectContext,
  onNewContext,
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
    if (editRoles === null) return true;
    if (editRoles.length === 0) return false;
    return editRoles.some(r => user.roles.includes(r));
  }

  return (
    <nav className="w-60 border-r border-slate-200 dark:border-slate-700 flex flex-col flex-shrink-0 bg-white dark:bg-slate-800/50 overflow-y-auto">
      {isLoading ? (
        <div className="p-4 text-xs text-slate-400">Loading…</div>
      ) : (
        <>
          {/* ── Context ─────────────────────────────── */}
          <SectionHeader
            label="Context"
            count={contextFiles.length}
            isOpen={expanded.context}
            onToggle={() => onToggle('context')}
            action={
              <button
                onClick={onNewContext}
                className="p-0.5 rounded text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="New context file"
              >
                {plusIcon}
              </button>
            }
          />
          {expanded.context && contextFiles.map((file, i) => {
            const editable = canEdit(file.editRoles);
            const stageLabels: string[] = file.stages
              ? file.stages.map(s => STAGE_SHORT_LABELS[s] ?? s).filter(Boolean)
              : ['All agents'];
            return (
              <button
                key={file.fileName}
                onClick={() => onSelectContext(i, file)}
                className={`w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 transition-colors ${
                  selectedCtxIndex === i
                    ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${file.content ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{file.label}</span>
                  </div>
                  {!editable && (
                    <svg className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                            ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
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

          {/* ── Agents ──────────────────────────────── */}
          <SectionHeader
            label="Agents"
            count={agentItems.length}
            isOpen={expanded.agents}
            onToggle={() => onToggle('agents')}
            action={
              <button
                onClick={onNewAgent}
                className="p-0.5 rounded text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="New agent"
              >
                {plusIcon}
              </button>
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
                className={`w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 transition-colors ${
                  isSelected
                    ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{item.displayName}</span>
                  {!editable && (
                    <svg className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                </div>
                {item.type === 'skill' ? (
                  <div className="text-xs text-slate-400 mt-0.5">v{item.skill.version} · {item.skill.owner_team}</div>
                ) : item.publishedSkill ? (
                  <div className="text-xs text-slate-400 mt-0.5">v{item.publishedSkill.version} · {item.publishedSkill.owner_team}</div>
                ) : (
                  <div className="text-xs px-1 py-0 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 mt-0.5 inline-block">not published</div>
                )}
              </button>
            );
          })}

          {/* ── Skills ──────────────────────────────────── */}
          <SectionHeader
            label="Skills"
            count={domainSkills.length}
            isOpen={expanded.skills}
            onToggle={() => onToggle('skills')}
            action={
              <button
                onClick={onNewSkill}
                className="p-0.5 rounded text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="New skill"
              >
                {plusIcon}
              </button>
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
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {d === 'all' ? 'All' : DISCIPLINE_LABELS[d]}
                  </button>
                ))}
              </div>
              {/* Skill items grouped by discipline */}
              {filteredDomainSkills.length === 0 ? (
                <div className="px-4 pb-2 text-xs text-slate-400">No skills found</div>
              ) : (
                (['dev', 'qa', 'design', 'general'] as const)
                  .filter((d) => filteredDomainSkills.some((s) => s.discipline === d))
                  .map((disc) => (
                    <div key={disc}>
                      {filterDiscipline === 'all' && (
                        <div className="px-4 pt-1 pb-0.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                          {DISCIPLINE_LABELS[disc]}
                        </div>
                      )}
                      {filteredDomainSkills.filter((s) => s.discipline === disc).map((skill) => (
                        <button
                          key={skill.skill_name}
                          onClick={() => onSelectSkill(skill)}
                          className={`w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 transition-colors ${
                            selectedSkillName === skill.skill_name
                              ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                          }`}
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className={`px-1.5 py-0 rounded text-xs font-medium ${DISCIPLINE_COLORS[disc]}`}>
                              {DISCIPLINE_LABELS[disc]}
                            </span>
                            <span className="text-sm text-slate-800 dark:text-slate-200 truncate">
                              {skill.discipline === 'agent' ? getAgentDisplayName(skill) : skill.skill_name}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 pl-0.5">v{skill.version} · {skill.owner_team}</div>
                        </button>
                      ))}
                    </div>
                  ))
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
              <div className="px-4 pb-2 text-xs text-slate-400">No tools registered</div>
            ) : (
              allTools.map((tool) => (
                <button
                  key={`${tool.sourceSkillName}:${tool.name}`}
                  onClick={() => onSelectTool(tool)}
                  className={`w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 transition-colors ${
                    selectedToolName === tool.name
                      ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="text-sm font-mono text-slate-800 dark:text-slate-200 truncate">{tool.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">from {tool.sourceSkillName}</div>
                </button>
              ))
            )
          )}
        </>
      )}
    </nav>
  );
}
