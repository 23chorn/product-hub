import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, type SkillVersion } from '../services/api';
import { useThemeStore } from '../stores/themeStore';
import { getAgentDisplayName } from '../utils/agent-display-names';
import { SectionHeader } from '../components/skill/SectionHeader';
import { SkillViewer } from '../components/skill/SkillViewer';
import { ToolViewer } from '../components/skill/ToolViewer';
import { SkillCreateForm } from '../components/skill/SkillCreateForm';
import {
  type ExtractedTool,
  type Discipline,
  type ContentTab,
  type PanelSelection,
  DISCIPLINE_LABELS,
  DISCIPLINE_COLORS,
  bumpPatch,
} from '../components/skill/types';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SkillPage() {
  const { isDark, toggleTheme } = useThemeStore();

  const [allSkills, setAllSkills] = useState<SkillVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterDiscipline, setFilterDiscipline] = useState<Discipline>('all');
  const [selection, setSelection] = useState<PanelSelection>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [expanded, setExpanded] = useState({ skills: true, tools: false });
  const toggle = (key: keyof typeof expanded) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Skill view state
  const [versionHistory, setVersionHistory] = useState<SkillVersion[]>([]);
  const [activeTab, setActiveTab] = useState<ContentTab>('dev_context');
  const [skillEditContent, setSkillEditContent] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  // Skill create state
  const [createForm, setCreateForm] = useState({
    skill_name: '', discipline: 'dev', owner_team: '', agent_type: 'general',
    version: '1.0.0', persona_prompt: '', development_context: '',
    tool_definitions: '', output_format_template: '',
  });
  const [isCreating, setIsCreating] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  // Domain skills only (non-agent disciplines)
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
        const skillList = await api.getSkills();
        setAllSkills(skillList);
      } catch {
        showToast('Failed to load skills', false);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

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
      const newSkill = skillList.find((s) => s.skill_name === createForm.skill_name.trim());
      if (newSkill) {
        await selectSkill(newSkill);
        setExpanded((p) => ({ ...p, skills: true }));
      } else {
        setSelection(null);
      }
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Create failed', false);
    } finally {
      setIsCreating(false);
    }
  };

  const selectedSkillName = selection?.type === 'skill' ? selection.skill.skill_name : null;
  const selectedToolName = selection?.type === 'tool' ? selection.tool.name : null;

  return (
    <div className={`h-screen flex flex-col ${isDark ? 'dark bg-slate-950' : 'bg-slate-100'}`}>
      {/* Header */}
      <header className="bg-white/90 dark:bg-slate-900/80 backdrop-blur-lg border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              to="/"
              className="text-sm text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
              title="Back to Product Hub"
            >
              ← Hub
            </Link>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Skill Editor</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Browse, upload and publish versioned skills</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {toast && (
              <span className={`text-xs font-medium ${toast.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {toast.msg}
              </span>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left nav */}
        <nav className="w-64 border-r border-slate-200 dark:border-slate-700 flex flex-col flex-shrink-0 bg-white dark:bg-slate-900/70 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-xs text-slate-400">Loading…</div>
          ) : (
            <>
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
                                <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{skill.skill_name}</span>
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
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
          {selection?.type === 'skill' ? (
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
          ) : selection?.type === 'new_skill' ? (
            <SkillCreateForm
              form={createForm}
              setForm={setCreateForm}
              onSubmit={handleCreate}
              onCancel={() => setSelection(null)}
              isCreating={isCreating}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-slate-400 dark:text-slate-500">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">Select a skill or create a new one</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
