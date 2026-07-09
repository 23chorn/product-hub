import { useState, useEffect, useRef, useMemo } from 'react';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import { api, type AgentFile } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getAgentDisplayName } from '../../utils/agent-display-names';
import { ContextFileEditor } from './ContextFileEditor';
import { SkillViewer } from './SkillViewer';
import { NewContextForm } from './NewContextForm';
import { SkillManagerSidebar } from './SkillManagerSidebar';
import { AirtableSyncPanel } from './AirtableSyncPanel';
import { DocFileViewer } from '../knowledge/DocFileViewer';
import { ResizeHandle } from '../common/ResizeHandle';
import { PageHeaderActions } from '../common/PageHeaderActions';
import { useContextKeeperStore } from '../../stores/contextKeeperStore';
import type { PanelSelection, ContextFile } from './types';

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SkillManagerPanel() {
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
  const [agentFiles, setAgentFiles] = useState<AgentFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selection, setSelection] = useState<PanelSelection>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Sidebar resize/collapse (react-resizable-panels)
  const sidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Section expand state — all collapsed by default
  const [expanded, setExpanded] = useState({ context: false, behaviour: false, agents: false, templates: false, docs: false });
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

  // Agent file (persona / output template) editing state
  const [agentFileContent, setAgentFileContent] = useState('');
  const [agentFileSavedContent, setAgentFileSavedContent] = useState('');
  const [agentFileSaving, setAgentFileSaving] = useState(false);

  // Context create state
  const [ctxCreateForm, setCtxCreateForm] = useState({ label: '', description: '', content: '' });
  const [isCreatingCtx, setIsCreatingCtx] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  const personaFiles = useMemo(() => agentFiles.filter((f) => f.dir === 'personas'), [agentFiles]);
  const templateFiles = useMemo(() => agentFiles.filter((f) => f.dir === 'templates'), [agentFiles]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [{ files }, { files: behFiles }, agentFileList] = await Promise.all([
          api.getContextFiles(),
          api.getBehaviourFiles(),
          api.getSkills(),
        ]);
        setContextFiles(files);
        setBehaviourFiles(behFiles.map((f) => ({ ...f, hasTemplate: false, stages: null })));
        setAgentFiles(agentFileList);
      } catch {
        showToast('Failed to load', false);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Cmd/Ctrl+S saves the currently open context, behaviour doc, or agent file
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (selection?.type === 'context' && ctxEditContent !== ctxSavedContent && !ctxIsSaving) {
          handleContextSave();
        } else if (selection?.type === 'behaviour' && behEditContent !== behSavedContent && !behIsSaving) {
          handleBehaviourSave();
        } else if (selection?.type === 'agent_file' && agentFileContent !== agentFileSavedContent && !agentFileSaving) {
          handleAgentFileSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, ctxEditContent, ctxSavedContent, ctxIsSaving, behEditContent, behSavedContent, behIsSaving, agentFileContent, agentFileSavedContent, agentFileSaving]);

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

  const selectAgentFile = async (file: AgentFile) => {
    setSelection({ type: 'agent_file', key: file.key });
    try {
      const { content } = await api.getSkill(file.key);
      setAgentFileContent(content);
      setAgentFileSavedContent(content);
    } catch {
      showToast('Failed to load file', false);
      setAgentFileContent('');
      setAgentFileSavedContent('');
    }
  };

  const handleAgentFileSave = async () => {
    if (selection?.type !== 'agent_file') return;
    setAgentFileSaving(true);
    try {
      await api.saveSkill(selection.key, agentFileContent);
      setAgentFileSavedContent(agentFileContent);
      showToast('Saved');
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? 'Save failed', false);
    } finally {
      setAgentFileSaving(false);
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

  const selectedCtxIndex = selection?.type === 'context' ? selection.index : null;
  const selectedBehaviourIndex = selection?.type === 'behaviour' ? selection.index : null;
  const selectedAgentFileKey = selection?.type === 'agent_file' ? selection.key : null;
  const selectedAgentFile = selectedAgentFileKey ? agentFiles.find((f) => f.key === selectedAgentFileKey) ?? null : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {toast && (
        <PageHeaderActions>
          <span className={`text-xs font-medium ${toast.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {toast.msg}
          </span>
        </PageHeaderActions>
      )}

      {/* Body */}
      <Group orientation="horizontal" className="flex-1 overflow-hidden" id="knowledge-studio-layout">
        {/* Left nav */}
        <Panel
          id="sidebar"
          defaultSize="22%"
          minSize="14%"
          maxSize="65%"
          collapsible
          collapsedSize={0}
          panelRef={sidebarPanelRef}
          onResize={() => setSidebarCollapsed(sidebarPanelRef.current?.isCollapsed() ?? false)}
        >
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
          personaFiles={personaFiles}
          templateFiles={templateFiles}
          selectedAgentFileKey={selectedAgentFileKey}
          onSelectAgentFile={selectAgentFile}
          selectedDocFileId={selection?.type === 'doc_file' ? selection.fileId : null}
          onSelectDocFile={(file) => setSelection({ type: 'doc_file', fileId: file.id })}
        />
        </Panel>

        <ResizeHandle
          collapsed={sidebarCollapsed}
          collapseDirection="before"
          onToggleCollapse={() => {
            if (sidebarPanelRef.current?.isCollapsed()) sidebarPanelRef.current?.expand();
            else sidebarPanelRef.current?.collapse();
          }}
        />

        {/* Right panel */}
        <Panel id="main" minSize="30%">
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
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
          ) : selection?.type === 'agent_file' && selectedAgentFile ? (
            <SkillViewer
              file={selectedAgentFile}
              displayName={getAgentDisplayName(selectedAgentFile.key)}
              editContent={agentFileContent}
              savedContent={agentFileSavedContent}
              isSaving={agentFileSaving}
              canEdit={canEdit(selectedAgentFile.editRoles)}
              onChange={setAgentFileContent}
              onSave={handleAgentFileSave}
              onRevert={() => setAgentFileContent(agentFileSavedContent)}
            />
          ) : selection?.type === 'doc_file' ? (
            <DocFileViewer fileId={selection.fileId} />
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
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2 text-surface-400 dark:text-surface-500">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">Expand a section and select an item</p>
            </div>
          )}
        </div>
        </Panel>
      </Group>
    </div>
  );
}
