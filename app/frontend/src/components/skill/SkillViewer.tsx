import { useState, useEffect } from 'react';
import type { SkillVersion } from '../../services/api';
import { MarkdownEditor } from './MarkdownEditor';
import { JsonToolEditor } from './ToolEditor';
import { DISCIPLINE_COLORS, type ContentTab } from './types';

const SKILL_TABS: { key: ContentTab; label: string }[] = [
  { key: 'persona',     label: 'Persona' },
  { key: 'dev_context', label: 'Dev Context' },
  { key: 'tools',       label: 'Tools' },
  { key: 'template',    label: 'Template' },
];

const MARKDOWN_TABS = new Set<ContentTab>(['persona', 'dev_context', 'template']);

export interface SkillMeta { owner_team: string; agent_type: string; }

interface SkillViewerProps {
  skill: SkillVersion;
  displayName: string;
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

/** Skill detail/editor pane: editable metadata, tab bar (persona/context/tools/template), publish footer. */
export function SkillViewer({
  skill, displayName, activeTab, editContent, setEditContent,
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
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{displayName}</h3>
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
