import { useState, useEffect, useRef, useMemo } from 'react';
import { api, type SkillVersion } from '../services/api';
import { useSkillManagerStore } from '../stores/skillManagerStore';
import { useThemeStore } from '../stores/themeStore';
import { getAgentDisplayName } from '../utils/agent-display-names';
import { SectionHeader } from './skill/SectionHeader';
import { ContextFileEditor } from './skill/ContextFileEditor';
import { SkillViewer } from './skill/SkillViewer';
import { ToolViewer } from './skill/ToolViewer';
import { SkillCreateForm } from './skill/SkillCreateForm';
import { NewContextForm } from './skill/NewContextForm';
import {
  DISCIPLINE_LABELS,
  DISCIPLINE_COLORS,
  bumpPatch,
  type PanelSelection,
  type ExtractedTool,
  type ContentTab,
  type Discipline,
  type ContextFile,
  type PersonaFile,
} from './skill/types';

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SkillManagerPanel() {
  const { closeSkillManager } = useSkillManagerStore();
  const { isDark } = useThemeStore();

  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [personas, setPersonas] = useState<PersonaFile[]>([]);
  const [allSkills, setAllSkills] = useState<SkillVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterDiscipline, setFilterDiscipline] = useState<Discipline>('all');
  const [selection, setSelection] = useState<PanelSelection>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Section expand state — all collapsed by default
  const [expanded, setExpanded] = useState({ context: false, agents: false, skills: false, tools: false });
  const toggle = (key: keyof typeof expanded) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Context editing state
  const [ctxEditContent, setCtxEditContent] = useState('');
  const [ctxSavedContent, setCtxSavedContent] = useState('');
  const [ctxIsSaving, setCtxIsSaving] = useState(false);
  const [ctxVersions, setCtxVersions] = useState<Array<{ id: number; file_name: string; content: string; created_at: number }>>([]);
  const [ctxVersionsLoading, setCtxVersionsLoading] = useState(false);

  // Skill view state
  const [versionHistory, setVersionHistory] = useState<SkillVersion[]>([]);
  const [activeTab, setActiveTab] = useState<ContentTab>('persona');
  const [skillEditContent, setSkillEditContent] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  // Skill / agent create state
  const [createForm, setCreateForm] = useState({
    skill_name: '', discipline: 'dev', owner_team: '', agent_type: 'general',
    version: '1.0.0', persona_prompt: '', development_context: '',
    tool_definitions: '', output_format_template: '',
  });
  const [isCreating, setIsCreating] = useState(false);

  // Context create state
  const [ctxCreateForm, setCtxCreateForm] = useState({ label: '', description: '', content: '' });
  const [isCreatingCtx, setIsCreatingCtx] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  // Derived slices
  const agentSkills = useMemo(
    () => allSkills.filter((s) => s.discipline === 'agent'),
    [allSkills],
  );
  const agentItems = useMemo(() => {
    const personaItems = personas.map((persona) => {
      const publishedSkill = agentSkills.find((skill) =>
        skill.skill_name === persona.skillName ||
        skill.agent_type === persona.agentType ||
        getAgentDisplayName(skill) === persona.displayName
      ) ?? null;
      return {
        type: 'persona' as const,
        key: persona.name,
        persona,
        publishedSkill,
        displayName: persona.displayName,
      };
    });

    const personaDisplayNames = new Set(personaItems.map((item) => item.displayName));
    const personaSkillNames = new Set(personaItems.map((item) => item.publishedSkill?.skill_name ?? item.persona.skillName));

    const customSkills = agentSkills.filter((skill) =>
      !personaDisplayNames.has(getAgentDisplayName(skill)) &&
      !personaSkillNames.has(skill.skill_name)
    ).map((skill) => ({
      type: 'skill' as const,
      key: skill.skill_name,
      skill,
      displayName: getAgentDisplayName(skill),
    }));

    return [...personaItems, ...customSkills];
  }, [agentSkills, personas]);
  const domainSkills = useMemo(
    () => allSkills.filter((s) => s.discipline !== 'agent'),
    [allSkills],
  );
  const filteredDomainSkills = useMemo(
    () => filterDiscipline === 'all' ? domainSkills : domainSkills.filter((s) => s.discipline === filterDiscipline),
    [domainSkills, filterDiscipline],
  );
  const allTools = useMemo<ExtractedTool[]>(() => {
    const tools: ExtractedTool[] = [];
    for (const skill of allSkills) {
      if (!skill.tool_definitions) continue;
      try {
        const defs = JSON.parse(skill.tool_definitions);
        if (Array.isArray(defs)) {
          defs.forEach((d: any) => tools.push({
            name: d.name,
            description: d.description,
            input_schema: d.input_schema,
            sourceSkillName: skill.skill_name,
            sourceSkillVersion: skill.version,
          }));
        }
      } catch { /* skip malformed */ }
    }
    return tools;
  }, [allSkills]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [{ files }, skillList, personaList] = await Promise.all([
          api.getContextFiles(),
          api.getSkills(),
          api.getPersonas(),
        ]);
        setContextFiles(files);
        setAllSkills(skillList);
        setPersonas(personaList);
      } catch {
        showToast('Failed to load', false);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Cmd/Ctrl+S saves context file
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (selection?.type === 'context' && ctxEditContent !== ctxSavedContent && !ctxIsSaving) {
          handleContextSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, ctxEditContent, ctxSavedContent, ctxIsSaving]);

  const selectContextFile = (index: number, file: ContextFile) => {
    setSelection({ type: 'context', index });
    setCtxEditContent(file.content);
    setCtxSavedContent(file.content);
    setCtxVersions([]);
    textareaRef.current?.focus();
    // Load version history async
    setCtxVersionsLoading(true);
    api.getContextFileVersions(file.fileName)
      .then(({ versions }) => setCtxVersions(versions))
      .catch(() => {})
      .finally(() => setCtxVersionsLoading(false));
  };

  const handleContextSave = async () => {
    if (selection?.type !== 'context') return;
    const file = contextFiles[selection.index];
    if (!file) return;
    setCtxIsSaving(true);
    try {
      await api.saveContextFile(file.fileName, ctxEditContent);
      setCtxSavedContent(ctxEditContent);
      setContextFiles((prev) =>
        prev.map((f, i) => (i === selection.index ? { ...f, content: ctxEditContent } : f))
      );
      // Refresh version history
      const { versions } = await api.getContextFileVersions(file.fileName);
      setCtxVersions(versions);
      showToast('Saved');
    } catch {
      showToast('Save failed', false);
    } finally {
      setCtxIsSaving(false);
    }
  };

  const getSkillTabContent = (skill: SkillVersion, tab: ContentTab): string => {
    switch (tab) {
      case 'persona':     return skill.persona_prompt ?? '';
      case 'dev_context': return skill.development_context ?? '';
      case 'tools':       return skill.tool_definitions ?? '';
      case 'template':    return skill.output_format_template ?? '';
    }
  };

  const selectSkill = async (skill: SkillVersion) => {
    const primaryTab: ContentTab = skill.discipline === 'agent' ? 'persona' : 'dev_context';
    setSelection({ type: 'skill', skill });
    setActiveTab(primaryTab);
    setSkillEditContent(getSkillTabContent(skill, primaryTab));
    setNewVersion(bumpPatch(skill.version));
    try {
      const versions = await api.getSkillVersions(skill.skill_name);
      setVersionHistory(versions);
    } catch {
      setVersionHistory([]);
    }
  };

  const handleSkillTabChange = (tab: ContentTab) => {
    setActiveTab(tab);
    if (selection?.type === 'skill') setSkillEditContent(getSkillTabContent(selection.skill, tab));
  };

  const handlePublish = async (meta: { owner_team: string; agent_type: string }) => {
    if (selection?.type !== 'skill' || !newVersion.trim()) return;
    const { skill } = selection;
    setIsPublishing(true);
    try {
      await api.publishSkill({
        skill_name: skill.skill_name,
        agent_type: meta.agent_type,
        version: newVersion.trim(),
        owner_team: meta.owner_team,
        discipline: skill.discipline,
        persona_prompt:         activeTab === 'persona'     ? skillEditContent : skill.persona_prompt,
        output_format_template: activeTab === 'template'    ? skillEditContent : (skill.output_format_template ?? undefined),
        development_context:    activeTab === 'dev_context' ? skillEditContent : (skill.development_context ?? undefined),
        tool_definitions:       activeTab === 'tools'       ? skillEditContent : (skill.tool_definitions ?? undefined),
      });
      showToast(`Published v${newVersion.trim()}`);
      const [skillList, refreshed] = await Promise.all([
        api.getSkills(),
        api.getSkill(skill.skill_name),
      ]);
      setAllSkills(skillList);
      await selectSkill(refreshed);
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Publish failed', false);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCreate = async () => {
    if (!createForm.skill_name.trim() || !createForm.version.trim()) {
      showToast('Skill name and version are required', false);
      return;
    }
    setIsCreating(true);
    try {
      await api.publishSkill({
        skill_name: createForm.skill_name.trim(),
        agent_type: createForm.agent_type || 'general',
        version: createForm.version.trim(),
        owner_team: createForm.owner_team || 'core',
        discipline: createForm.discipline,
        persona_prompt: createForm.persona_prompt,
        development_context: createForm.development_context || undefined,
        tool_definitions: createForm.tool_definitions || undefined,
        output_format_template: createForm.output_format_template || undefined,
      });
      showToast(`Created ${createForm.skill_name} v${createForm.version}`);
      setCreateForm({ skill_name: '', discipline: 'dev', owner_team: '', agent_type: 'general', version: '1.0.0', persona_prompt: '', development_context: '', tool_definitions: '', output_format_template: '' });
      const skillList = await api.getSkills();
      setAllSkills(skillList);
      // Select the newly created skill
      const newSkill = skillList.find((s) => s.skill_name === createForm.skill_name.trim());
      if (newSkill) {
        await selectSkill(newSkill);
        setExpanded((p) => ({ ...p, [newSkill.discipline === 'agent' ? 'agents' : 'skills']: true }));
      } else {
        setSelection(null);
      }
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Create failed', false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateContext = async () => {
    if (!ctxCreateForm.label.trim()) {
      showToast('Label is required', false);
      return;
    }
    setIsCreatingCtx(true);
    try {
      const { fileName } = await api.createContextFile(
        ctxCreateForm.label.trim(),
        ctxCreateForm.description.trim(),
        ctxCreateForm.content,
      );
      showToast(`Created ${fileName}`);
      setCtxCreateForm({ label: '', description: '', content: '' });
      const { files } = await api.getContextFiles();
      setContextFiles(files);
      // Select the newly created file
      const newIndex = files.findIndex((f) => f.fileName === fileName);
      if (newIndex !== -1) {
        setSelection({ type: 'context', index: newIndex });
        setCtxEditContent(files[newIndex].content);
        setCtxSavedContent(files[newIndex].content);
        setExpanded((p) => ({ ...p, context: true }));
      }
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Create failed', false);
    } finally {
      setIsCreatingCtx(false);
    }
  };

  const openPersonaForCreation = (persona: PersonaFile) => {
    setCreateForm({
      skill_name: persona.skillName,
      discipline: 'agent',
      owner_team: 'core',
      agent_type: persona.agentType,
      version: '1.0.0',
      persona_prompt: persona.content,
      development_context: '',
      tool_definitions: '',
      output_format_template: '',
    });
    setSelection({ type: 'new_agent' });
    setExpanded((p) => ({ ...p, agents: true }));
  };

  const selectedSkillName = selection?.type === 'skill' ? selection.skill.skill_name : null;
  const selectedCtxIndex = selection?.type === 'context' ? selection.index : null;
  const selectedToolName = selection?.type === 'tool' ? selection.tool.name : null;
  const selectedAgentName = selection?.type === 'new_agent' ? createForm.skill_name : null;
  const totalAgentCount = agentItems.length;

  return (
    <div className={`h-full flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-100/10 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Agent Studio</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage project context, agent personas, skills, and tools</p>
        </div>
        <div className="flex items-center space-x-3">
          {toast && (
            <span className={`text-xs font-medium ${toast.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {toast.msg}
            </span>
          )}

          <button
            onClick={closeSkillManager}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left nav */}
        <nav className="w-60 border-r border-slate-200 dark:border-slate-700 flex flex-col flex-shrink-0 bg-white dark:bg-slate-800/50 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-xs text-slate-400">Loading…</div>
          ) : (
            <>
              {/* ── Context ─────────────────────────────── */}
              <>
                <SectionHeader
                  label="Context"
                  count={contextFiles.length}
                  isOpen={expanded.context}
                  onToggle={() => toggle('context')}
                  action={
                    <button
                      onClick={() => { setSelection({ type: 'new_context' }); setExpanded((p) => ({ ...p, context: true })); }}
                      className="p-0.5 rounded text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      title="New context file"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  }
                />
                {expanded.context && contextFiles.map((file, i) => (
                  <button
                    key={file.fileName}
                    onClick={() => selectContextFile(i, file)}
                    className={`w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 transition-colors ${
                      selectedCtxIndex === i
                        ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${file.content ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{file.label}</span>
                    </div>
                  </button>
                ))}
              </>

              {/* ── Agents ──────────────────────────────── */}
              <>
                <SectionHeader
                  label="Agents"
                  count={totalAgentCount}
                  isOpen={expanded.agents}
                  onToggle={() => toggle('agents')}
                  action={
                    <button
                      onClick={() => {
                        setCreateForm({
                          skill_name: '',
                          discipline: 'agent',
                          owner_team: 'core',
                          agent_type: 'analyst',
                          version: '1.0.0',
                          persona_prompt: '',
                          development_context: '',
                          tool_definitions: '',
                          output_format_template: '',
                        });
                        setSelection({ type: 'new_agent' });
                        setExpanded((p) => ({ ...p, agents: true }));
                      }}
                      className="p-0.5 rounded text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      title="New agent"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  }
                />
                {expanded.agents && (
                  <>
                    {agentItems.map((item) => {
                      const isSelected =
                        (item.type === 'skill' && selectedSkillName === item.skill.skill_name) ||
                        (item.type === 'persona' && selectedAgentName === item.persona.skillName);
                      return (
                        <button
                          key={item.key}
                          onClick={() => {
                            if (item.type === 'skill') {
                              selectSkill(item.skill);
                            } else if (item.publishedSkill) {
                              selectSkill(item.publishedSkill);
                            } else {
                              openPersonaForCreation(item.persona);
                            }
                          }}
                          className={`w-full text-left px-4 py-2 border-b border-slate-100 dark:border-slate-700/40 transition-colors ${
                            isSelected
                              ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                          }`}
                        >
                          <div className="text-sm text-slate-800 dark:text-slate-200 truncate">{item.displayName}</div>
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
                  </>
                )}
              </>

              {/* ── Skills ──────────────────────────────────── */}
              <SectionHeader
                label="Skills"
                count={domainSkills.length}
                isOpen={expanded.skills}
                onToggle={() => toggle('skills')}
                action={
                  <button
                    onClick={() => { setSelection({ type: 'new_skill' }); setExpanded((p) => ({ ...p, skills: true })); }}
                    className="p-0.5 rounded text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    title="New skill"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
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
                        onClick={() => setFilterDiscipline(d as Discipline)}
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
                              onClick={() => selectSkill(skill)}
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
                onToggle={() => toggle('tools')}
              />
              {expanded.tools && (
                allTools.length === 0 ? (
                  <div className="px-4 pb-2 text-xs text-slate-400">No tools registered</div>
                ) : (
                  allTools.map((tool) => (
                    <button
                      key={`${tool.sourceSkillName}:${tool.name}`}
                      onClick={() => setSelection({ type: 'tool', tool })}
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

        {/* Right panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {selection?.type === 'context' && contextFiles[selection.index] ? (
            <ContextFileEditor
              file={contextFiles[selection.index]}
              editContent={ctxEditContent}
              savedContent={ctxSavedContent}
              isSaving={ctxIsSaving}
              versions={ctxVersions}
              versionsLoading={ctxVersionsLoading}
              textareaRef={textareaRef}
              onChange={setCtxEditContent}
              onSave={handleContextSave}
              onRevert={() => setCtxEditContent(ctxSavedContent)}
              onRestoreVersion={(content) => { setCtxEditContent(content); showToast('Version restored — save to apply'); }}
              onLoadTemplate={() => {
                const f = contextFiles[(selection as { type: 'context'; index: number }).index];
                if (f?.templateContent) setCtxEditContent(f.templateContent);
              }}
            />
          ) : selection?.type === 'skill' ? (
            <SkillViewer
              skill={selection.skill}
              displayName={selection.skill.discipline === 'agent' ? getAgentDisplayName(selection.skill) : selection.skill.skill_name}
              activeTab={activeTab}
              editContent={skillEditContent}
              setEditContent={setSkillEditContent}
              newVersion={newVersion}
              setNewVersion={setNewVersion}
              versionHistory={versionHistory}
              isPublishing={isPublishing}
              onTabChange={handleSkillTabChange}
              onPublish={handlePublish}
            />
          ) : selection?.type === 'tool' ? (
            <ToolViewer
              tool={selection.tool}
              onGoToSkill={() => {
                const skill = allSkills.find((s) => s.skill_name === selection.tool.sourceSkillName);
                if (skill) selectSkill(skill);
              }}
            />
          ) : selection?.type === 'new_context' ? (
            <NewContextForm
              form={ctxCreateForm}
              setForm={setCtxCreateForm}
              onSubmit={handleCreateContext}
              onCancel={() => setSelection(null)}
              isCreating={isCreatingCtx}
            />
          ) : selection?.type === 'new_skill' ? (
            <SkillCreateForm
              form={createForm}
              setForm={setCreateForm}
              onSubmit={handleCreate}
              onCancel={() => setSelection(null)}
              isCreating={isCreating}
            />
          ) : selection?.type === 'new_agent' ? (
            <SkillCreateForm
              form={createForm}
              setForm={setCreateForm}
              onSubmit={handleCreate}
              onCancel={() => setSelection(null)}
              isCreating={isCreating}
              lockDiscipline="agent"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-slate-400 dark:text-slate-500">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">Expand a section and select an item</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

