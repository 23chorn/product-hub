import { useState, useEffect, useRef, useMemo } from 'react';
import { api, type SkillVersion } from '../../services/api';
import { useSkillManagerStore } from '../../stores/skillManagerStore';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { getAgentDisplayName } from '../../utils/agent-display-names';
import { ContextFileEditor } from './ContextFileEditor';
import { SkillViewer } from './SkillViewer';
import { ToolViewer } from './ToolViewer';
import { SkillCreateForm } from './SkillCreateForm';
import { NewContextForm } from './NewContextForm';
import { SkillManagerSidebar } from './SkillManagerSidebar';
import { AirtableSyncPanel } from './AirtableSyncPanel';
import { useContextKeeperStore } from '../../stores/contextKeeperStore';
import {
  bumpPatch,
  type PanelSelection,
  type ExtractedTool,
  type ContentTab,
  type Discipline,
  type ContextFile,
  type PersonaFile,
  type AgentItem,
} from './types';

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SkillManagerPanel() {
  const { closeSkillManager } = useSkillManagerStore();
  const { isDark } = useThemeStore();
  const { user, noAuth } = useAuthStore();
  const { pendingCount: pendingProposalCount } = useContextKeeperStore();

  function canEdit(editRoles: string[] | null): boolean {
    if (noAuth || !user) return true;
    if (user.is_admin) return true;
    if (user.roles.includes('view_only')) return false;
    if (editRoles === null) return true;
    if (editRoles.length === 0) return false;
    return editRoles.some(r => user.roles.includes(r));
  }

  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [personas, setPersonas] = useState<PersonaFile[]>([]);
  const [allSkills, setAllSkills] = useState<SkillVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterDiscipline, setFilterDiscipline] = useState<Discipline>('all');
  const [selection, setSelection] = useState<PanelSelection>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Section expand state — all collapsed by default
  const [expanded, setExpanded] = useState({ context: false, behaviour: false, agents: false, skills: false, tools: false });
  const toggle = (key: keyof typeof expanded) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Context editing state
  const [ctxEditContent, setCtxEditContent] = useState('');
  const [ctxSavedContent, setCtxSavedContent] = useState('');
  const [ctxIsSaving, setCtxIsSaving] = useState(false);
  const [ctxVersions, setCtxVersions] = useState<Array<{ id: number; file_name: string; content: string; created_at: number }>>([]);
  const [ctxVersionsLoading, setCtxVersionsLoading] = useState(false);

  // Behaviour doc editing state
  const [behaviourFiles, setBehaviourFiles] = useState<ContextFile[]>([]);
  const [behEditContent, setBehEditContent] = useState('');
  const [behSavedContent, setBehSavedContent] = useState('');
  const [behIsSaving, setBehIsSaving] = useState(false);
  const [behVersions, setBehVersions] = useState<Array<{ id: number; file_name: string; content: string; created_at: number }>>([]);
  const [behVersionsLoading, setBehVersionsLoading] = useState(false);

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
  const agentItems = useMemo<AgentItem[]>(() => {
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
        const [{ files }, { files: behFiles }, skillList, personaList] = await Promise.all([
          api.getContextFiles(),
          api.getBehaviourFiles(),
          api.getSkills(),
          api.getPersonas(),
        ]);
        setContextFiles(files);
        setBehaviourFiles(behFiles.map((f) => ({ ...f, hasTemplate: false, stages: null })));
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

  // Cmd/Ctrl+S saves the currently open context or behaviour doc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (selection?.type === 'context' && ctxEditContent !== ctxSavedContent && !ctxIsSaving) {
          handleContextSave();
        } else if (selection?.type === 'behaviour' && behEditContent !== behSavedContent && !behIsSaving) {
          handleBehaviourSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, ctxEditContent, ctxSavedContent, ctxIsSaving, behEditContent, behSavedContent, behIsSaving]);

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

  const selectBehaviourFile = (index: number, file: ContextFile) => {
    setSelection({ type: 'behaviour', index });
    setBehEditContent(file.content);
    setBehSavedContent(file.content);
    setBehVersions([]);
    textareaRef.current?.focus();
    setBehVersionsLoading(true);
    api.getBehaviourFileVersions(file.fileName)
      .then(({ versions }) => setBehVersions(versions))
      .catch(() => {})
      .finally(() => setBehVersionsLoading(false));
  };

  const handleBehaviourSave = async () => {
    if (selection?.type !== 'behaviour') return;
    const file = behaviourFiles[selection.index];
    if (!file) return;
    setBehIsSaving(true);
    try {
      await api.saveBehaviourFile(file.fileName, behEditContent);
      setBehSavedContent(behEditContent);
      setBehaviourFiles((prev) =>
        prev.map((f, i) => (i === selection.index ? { ...f, content: behEditContent } : f))
      );
      const { versions } = await api.getBehaviourFileVersions(file.fileName);
      setBehVersions(versions);
      showToast('Saved');
    } catch {
      showToast('Save failed', false);
    } finally {
      setBehIsSaving(false);
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
  const selectedBehaviourIndex = selection?.type === 'behaviour' ? selection.index : null;
  const selectedToolName = selection?.type === 'tool' ? selection.tool.name : null;
  const selectedAgentName = selection?.type === 'new_agent' ? createForm.skill_name : null;

  return (
    <div className={`h-full flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-surface-900/10 dark:ring-surface-100/10 ${isDark ? 'bg-surface-900' : 'bg-surface-100'}`}>
      {/* Header */}
      <header className="bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Agent Studio</h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Manage project context, behaviour docs, agent personas, skills, and tools</p>
        </div>
        <div className="flex items-center space-x-3">
          {toast && (
            <span className={`text-xs font-medium ${toast.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {toast.msg}
            </span>
          )}

          <button
            onClick={closeSkillManager}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
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
        <SkillManagerSidebar
          isLoading={isLoading}
          expanded={expanded}
          onToggle={toggle}
          canCreate={canEdit(null)}
          contextFiles={contextFiles}
          selectedCtxIndex={selectedCtxIndex}
          onSelectContext={selectContextFile}
          onNewContext={() => { setSelection({ type: 'new_context' }); setExpanded((p) => ({ ...p, context: true })); }}
          pendingProposalCount={pendingProposalCount}
          isAirtableSyncSelected={selection?.type === 'airtable_sync'}
          onSelectAirtableSync={() => { setSelection({ type: 'airtable_sync' }); setExpanded((p) => ({ ...p, context: true })); }}
          behaviourFiles={behaviourFiles}
          selectedBehaviourIndex={selectedBehaviourIndex}
          onSelectBehaviour={selectBehaviourFile}
          agentItems={agentItems}
          selectedSkillName={selectedSkillName}
          selectedAgentName={selectedAgentName}
          onSelectSkill={selectSkill}
          onCreatePersona={openPersonaForCreation}
          onNewAgent={() => {
            setCreateForm({
              skill_name: '', discipline: 'agent', owner_team: 'core', agent_type: 'analyst',
              version: '1.0.0', persona_prompt: '', development_context: '',
              tool_definitions: '', output_format_template: '',
            });
            setSelection({ type: 'new_agent' });
            setExpanded((p) => ({ ...p, agents: true }));
          }}
          domainSkills={domainSkills}
          filteredDomainSkills={filteredDomainSkills}
          filterDiscipline={filterDiscipline}
          onFilterDisciplineChange={setFilterDiscipline}
          onNewSkill={() => { setSelection({ type: 'new_skill' }); setExpanded((p) => ({ ...p, skills: true })); }}
          allTools={allTools}
          selectedToolName={selectedToolName}
          onSelectTool={(tool) => setSelection({ type: 'tool', tool })}
        />

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
              canEdit={canEdit(contextFiles[selection.index].editRoles)}
              onChange={setCtxEditContent}
              onSave={handleContextSave}
              onRevert={() => setCtxEditContent(ctxSavedContent)}
              onRestoreVersion={(content) => { setCtxEditContent(content); showToast('Version restored — save to apply'); }}
              onLoadTemplate={() => {
                const f = contextFiles[(selection as { type: 'context'; index: number }).index];
                if (f?.templateContent) setCtxEditContent(f.templateContent);
              }}
            />
          ) : selection?.type === 'behaviour' && behaviourFiles[selection.index] ? (
            <ContextFileEditor
              file={behaviourFiles[selection.index]}
              editContent={behEditContent}
              savedContent={behSavedContent}
              isSaving={behIsSaving}
              versions={behVersions}
              versionsLoading={behVersionsLoading}
              textareaRef={textareaRef}
              canEdit={canEdit(behaviourFiles[selection.index].editRoles)}
              onChange={setBehEditContent}
              onSave={handleBehaviourSave}
              onRevert={() => setBehEditContent(behSavedContent)}
              onRestoreVersion={(content) => { setBehEditContent(content); showToast('Version restored — save to apply'); }}
              onLoadTemplate={() => {}}
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
              canEdit={canEdit(selection.skill.editRoles ?? null)}
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
          ) : selection?.type === 'airtable_sync' ? (
            <AirtableSyncPanel />
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
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-surface-400 dark:text-surface-500">
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

