import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { api, type SkillVersion } from '../services/api';
import { useThemeStore } from '../stores/themeStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  sourceSkillName: string;
  sourceSkillVersion: string;
}

type Discipline = 'all' | 'dev' | 'qa' | 'design' | 'general';
type ContentTab = 'persona' | 'dev_context' | 'tools' | 'template';

type PanelSelection =
  | { type: 'skill'; skill: SkillVersion }
  | { type: 'tool'; tool: ExtractedTool }
  | { type: 'new_skill' }
  | null;

const DISCIPLINE_LABELS: Record<string, string> = {
  dev:     'Dev',
  qa:      'QA',
  design:  'Design',
  general: 'General',
};

const DISCIPLINE_COLORS: Record<string, string> = {
  agent:   'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  dev:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  qa:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  design:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  general: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

const SKILL_TABS: { key: ContentTab; label: string }[] = [
  { key: 'persona',     label: 'Persona' },
  { key: 'dev_context', label: 'Dev Context' },
  { key: 'tools',       label: 'Tools (JSON)' },
  { key: 'template',    label: 'Template' },
];

const MARKDOWN_TABS = new Set<ContentTab>(['persona', 'dev_context', 'template']);

function bumpPatch(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
  return version;
}

// ─── Collapsible section header ───────────────────────────────────────────────

function SectionHeader({
  label, count, isOpen, onToggle, action,
}: {
  label: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 cursor-pointer select-none group" onClick={onToggle}>
      <div className="flex items-center space-x-1.5 min-w-0">
        <svg
          className={`w-3 h-3 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
          {label}
        </span>
        {count !== undefined && (
          <span className="text-xs text-slate-400 dark:text-slate-500">({count})</span>
        )}
      </div>
      {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
    </div>
  );
}

// ─── Markdown editor with 50/50 preview + synced scroll ─────────────────────

function MarkdownEditor({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const isSyncingFromEditor = useRef(false);
  const isSyncingFromPreview = useRef(false);

  const syncFromEditor = () => {
    if (isSyncingFromPreview.current || !taRef.current || !previewRef.current) return;
    const ta = taRef.current;
    const ratio = ta.scrollTop / (ta.scrollHeight - ta.clientHeight || 1);
    isSyncingFromEditor.current = true;
    const preview = previewRef.current;
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
    requestAnimationFrame(() => { isSyncingFromEditor.current = false; });
  };

  const syncFromPreview = () => {
    if (isSyncingFromEditor.current || !taRef.current || !previewRef.current) return;
    const preview = previewRef.current;
    const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
    isSyncingFromPreview.current = true;
    const ta = taRef.current;
    ta.scrollTop = ratio * (ta.scrollHeight - ta.clientHeight);
    requestAnimationFrame(() => { isSyncingFromPreview.current = false; });
  };

  return (
    <div className="flex h-full gap-2">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncFromEditor}
        placeholder={placeholder}
        spellCheck={false}
        className="w-1/2 h-full resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      />
      <div
        ref={previewRef}
        onScroll={syncFromPreview}
        className="w-1/2 h-full overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4"
      >
        {value.trim() ? (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-slate-800 dark:prose-headings:text-slate-100 prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-li:text-slate-700 dark:prose-li:text-slate-300 prose-code:text-teal-600 dark:prose-code:text-teal-400 prose-pre:bg-slate-100 dark:prose-pre:bg-slate-900">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {value}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">Preview will appear here…</p>
        )}
      </div>
    </div>
  );
}

// ─── JSON tool editor ─────────────────────────────────────────────────────────

function ToolPreviewCard({ tool }: { tool: any }) {
  const props = Object.entries<any>(tool.input_schema?.properties ?? {});
  const required = new Set<string>(tool.input_schema?.required ?? []);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-3 py-2 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <span className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">
          {tool.name ?? <span className="text-red-400 italic">unnamed</span>}
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-2.5 bg-slate-50 dark:bg-slate-900/40">
        {tool.description && (
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{tool.description}</p>
        )}
        {props.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">Parameters</p>
            <div className="space-y-1.5">
              {props.map(([name, schema]) => (
                <div key={name} className="flex items-start gap-2 text-xs flex-wrap">
                  <code className="flex-shrink-0 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-teal-600 dark:text-teal-400">{name}</code>
                  <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 self-center">{schema.type}</span>
                  {required.has(name) && (
                    <span className="flex-shrink-0 px-1.5 py-0 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">required</span>
                  )}
                  {schema.description && (
                    <span className="text-slate-500 dark:text-slate-400 leading-relaxed">{schema.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function JsonToolEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = useMemo<any[] | null>(() => {
    if (!value.trim()) return [];
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : null; }
    catch { return null; }
  }, [value]);

  const format = () => {
    try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch {}
  };

  useEffect(() => {
    if (value.trim()) { try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full gap-2">
      <div className="w-1/2 h-full flex flex-col gap-1.5">
        <div className="flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-400 dark:text-slate-500">JSON source</span>
          <button
            onClick={format}
            className="text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Format
          </button>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          placeholder={'[\n  {\n    "name": "my_tool",\n    "description": "When to call it…",\n    "input_schema": {\n      "type": "object",\n      "properties": {\n        "param": { "type": "string", "description": "…" }\n      },\n      "required": ["param"]\n    }\n  }\n]'}
        />
      </div>
      <div className="w-1/2 h-full flex flex-col gap-1.5">
        <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">Preview</span>
        <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3 space-y-3">
          {parsed === null ? (
            <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-medium">Invalid JSON</span>
            </div>
          ) : parsed.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">No tools defined yet.</p>
          ) : (
            parsed.map((tool: any, i: number) => <ToolPreviewCard key={tool.name ?? i} tool={tool} />)
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skill viewer ─────────────────────────────────────────────────────────────

interface SkillMeta { owner_team: string; agent_type: string; }

interface SkillViewerProps {
  skill: SkillVersion;
  activeTab: ContentTab;
  editContent: string;
  setEditContent: (v: string) => void;
  newVersion: string;
  setNewVersion: (v: string) => void;
  versionHistory: SkillVersion[];
  isPublishing: boolean;
  onTabChange: (t: ContentTab) => void;
  onPublish: (meta: SkillMeta) => void;
}

function SkillViewer({
  skill, activeTab, editContent, setEditContent,
  newVersion, setNewVersion, versionHistory, isPublishing,
  onTabChange, onPublish,
}: SkillViewerProps) {
  const [ownerTeam, setOwnerTeam] = useState(skill.owner_team);
  const [agentType, setAgentType] = useState(skill.agent_type);

  useEffect(() => {
    setOwnerTeam(skill.owner_team);
    setAgentType(skill.agent_type);
  }, [skill.skill_name]);

  const savedContent = (() => {
    switch (activeTab) {
      case 'persona':     return skill.persona_prompt ?? '';
      case 'dev_context': return skill.development_context ?? '';
      case 'tools':       return skill.tool_definitions ?? '';
      case 'template':    return skill.output_format_template ?? '';
    }
  })();
  const isDirty = editContent !== savedContent
    || ownerTeam !== skill.owner_team
    || agentType !== skill.agent_type;

  const primaryTab: ContentTab = skill.discipline === 'agent' ? 'persona' : 'dev_context';
  const visibleTabs = SKILL_TABS.filter(({ key }) =>
    skill.discipline === 'agent' ? key !== 'dev_context' : key !== 'persona'
  );
  const tabHint = MARKDOWN_TABS.has(activeTab) ? 'Edit · Preview' : activeTab === 'tools' ? 'JSON · Preview' : null;

  return (
    <>
      {/* Header with editable metadata */}
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono">{skill.skill_name}</h3>
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DISCIPLINE_COLORS[skill.discipline] ?? DISCIPLINE_COLORS.general}`}>
            {skill.discipline}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-mono">
            v{skill.version}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">Owner</label>
            <input
              value={ownerTeam}
              onChange={(e) => setOwnerTeam(e.target.value)}
              className="w-32 px-2 py-0.5 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          {skill.discipline === 'agent' && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">Type</label>
              <input
                value={agentType}
                onChange={(e) => setAgentType(e.target.value)}
                className="w-32 px-2 py-0.5 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                placeholder="e.g. analyst"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center px-5 pt-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/20 flex-shrink-0">
        <div className="flex space-x-1 flex-1">
          {visibleTabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                activeTab === key
                  ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-b-2 border-teal-500'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              } ${key === primaryTab ? 'ring-1 ring-inset ring-slate-200 dark:ring-slate-700' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tabHint && <span className="text-xs text-slate-400 pb-1 pr-1">{tabHint}</span>}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden">
        {MARKDOWN_TABS.has(activeTab) ? (
          <MarkdownEditor
            value={editContent}
            onChange={setEditContent}
            placeholder={`Enter ${activeTab.replace('_', ' ')} content…`}
          />
        ) : (
          <JsonToolEditor value={editContent} onChange={setEditContent} />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className={`text-xs ${isDirty ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}>
            {isDirty ? 'Unsaved — publish to create a new version' : 'No changes'}
          </span>
          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">New version:</label>
            <input
              type="text"
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              className="w-24 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="e.g. 1.0.1"
            />
            <button
              onClick={() => onPublish({ owner_team: ownerTeam, agent_type: agentType })}
              disabled={!newVersion.trim() || isPublishing}
              className="text-xs px-4 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              {isPublishing ? 'Publishing…' : 'Publish Version'}
            </button>
          </div>
        </div>

        {versionHistory.length > 1 && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Version history</p>
            <div className="flex flex-wrap gap-2">
              {versionHistory.map((v) => (
                <span
                  key={v.id}
                  className={`text-xs px-2 py-0.5 rounded font-mono ${
                    v.deprecated_at
                      ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 line-through'
                      : 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
                  }`}
                >
                  v{v.version}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Tool viewer ──────────────────────────────────────────────────────────────

function ToolViewer({ tool, onGoToSkill }: { tool: ExtractedTool; onGoToSkill: () => void }) {
  return (
    <>
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-100">{tool.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Defined in <span className="font-medium">{tool.sourceSkillName}</span> v{tool.sourceSkillVersion}
            </p>
          </div>
          <button
            onClick={onGoToSkill}
            className="text-xs px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
          >
            Edit in skill →
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{tool.description}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Input Schema</p>
          <pre className="text-xs font-mono bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(tool.input_schema, null, 2)}
          </pre>
        </div>
      </div>
    </>
  );
}

// ─── Skill create form ────────────────────────────────────────────────────────

interface SkillCreateFormProps {
  form: {
    skill_name: string; discipline: string; owner_team: string; agent_type: string;
    version: string; persona_prompt: string; development_context: string;
    tool_definitions: string; output_format_template: string;
  };
  setForm: React.Dispatch<React.SetStateAction<SkillCreateFormProps['form']>>;
  onSubmit: () => void;
  onCancel: () => void;
  isCreating: boolean;
}

function SkillCreateForm({ form, setForm, onSubmit, onCancel, isCreating }: SkillCreateFormProps) {
  const field = (key: keyof SkillCreateFormProps['form'], value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const primaryLabel = form.discipline === 'agent' ? 'Persona Prompt' : 'Development Context';
  const primaryKey: keyof SkillCreateFormProps['form'] =
    form.discipline === 'agent' ? 'persona_prompt' : 'development_context';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Create New Skill</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Published as v{form.version} — increment version to publish future updates.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Skill name *</label>
            <input
              value={form.skill_name}
              onChange={(e) => field('skill_name', e.target.value)}
              placeholder="e.g. auth-service-dev"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Discipline *</label>
            <select
              value={form.discipline}
              onChange={(e) => field('discipline', e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="dev">Dev</option>
              <option value="qa">QA</option>
              <option value="design">Design</option>
              <option value="general">General</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Owner team</label>
            <input
              value={form.owner_team}
              onChange={(e) => field('owner_team', e.target.value)}
              placeholder="e.g. platform-team"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Initial version</label>
            <input
              value={form.version}
              onChange={(e) => field('version', e.target.value)}
              placeholder="1.0.0"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {primaryLabel}
            <span className="ml-1 font-normal text-slate-400">
              {form.discipline === 'agent' ? '— agent persona prompt' : '— injected into ADO tickets for this domain'}
            </span>
          </label>
          <div className="h-64">
            <MarkdownEditor
              value={form[primaryKey] as string}
              onChange={(v) => field(primaryKey, v)}
              placeholder={
                form.discipline === 'agent'
                  ? 'You are a specialist…'
                  : 'Describe development patterns, conventions, API contracts, and code details…'
              }
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            Tool Definitions (JSON) <span className="font-normal text-slate-400">— optional</span>
          </label>
          <textarea
            value={form.tool_definitions}
            onChange={(e) => field('tool_definitions', e.target.value)}
            rows={4}
            placeholder='[{"name": "my_tool", "description": "...", "input_schema": {...}}]'
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex items-center justify-end space-x-2 flex-shrink-0">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={isCreating || !form.skill_name.trim()}
          className="text-xs px-4 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        >
          {isCreating ? 'Creating…' : 'Create Skill'}
        </button>
      </div>
    </div>
  );
}

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
                const skill = allSkills.find((s) => s.skill_name === (selection as { type: 'tool'; tool: ExtractedTool }).tool.sourceSkillName);
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
