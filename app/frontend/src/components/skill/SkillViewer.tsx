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
  canEdit: boolean;
  onTabChange: (t: ContentTab) => void;
  onPublish: (meta: SkillMeta) => void;
}

/** Skill detail/editor pane: editable metadata, tab bar (persona/context/tools/template), publish footer. */
export function SkillViewer({
  skill, displayName, activeTab, editContent, setEditContent,
  newVersion, setNewVersion, versionHistory, isPublishing, canEdit,
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

  const tabHint = MARKDOWN_TABS.has(activeTab) ? 'Edit · Preview' : null;

  return (
    <>
      {/* Header with editable metadata */}
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{displayName}</h3>
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DISCIPLINE_COLORS[skill.discipline] ?? DISCIPLINE_COLORS.general}`}>
            {skill.discipline}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 font-mono">
            v{skill.version}
          </span>
          {!canEdit && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 font-medium">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Read only
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-surface-400 dark:text-surface-500 flex-shrink-0">Owner</label>
            <input
              value={ownerTeam}
              onChange={(e) => canEdit && setOwnerTeam(e.target.value)}
              readOnly={!canEdit}
              className={`w-32 px-2 py-0.5 text-xs rounded border text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-1 focus:ring-brand-500 ${canEdit ? 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800' : 'border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 cursor-default'}`}
            />
          </div>
          {skill.discipline === 'agent' && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-surface-400 dark:text-surface-500 flex-shrink-0">Type</label>
              <input
                value={agentType}
                onChange={(e) => canEdit && setAgentType(e.target.value)}
                readOnly={!canEdit}
                className={`w-32 px-2 py-0.5 text-xs rounded border text-surface-800 dark:text-surface-200 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500 ${canEdit ? 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800' : 'border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 cursor-default'}`}
                placeholder="e.g. analyst"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center px-5 pt-3 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/20 flex-shrink-0">
        <div className="flex space-x-1 flex-1">
          {visibleTabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                activeTab === key
                  ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border-b-2 border-brand-500'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
              } ${key === primaryTab ? 'ring-1 ring-inset ring-surface-200 dark:ring-surface-700' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tabHint && <span className="text-xs text-surface-400 pb-1 pr-1">{tabHint}</span>}
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden">
        {MARKDOWN_TABS.has(activeTab) ? (
          <MarkdownEditor
            value={editContent}
            onChange={setEditContent}
            placeholder={`Enter ${activeTab.replace('_', ' ')} content…`}
            readOnly={!canEdit}
          />
        ) : (
          <JsonToolEditor value={editContent} onChange={canEdit ? setEditContent : () => {}} readOnly={!canEdit} />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className={`text-xs ${!canEdit ? 'text-surface-400' : isDirty ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-surface-400'}`}>
            {!canEdit ? 'Read only — insufficient role' : isDirty ? 'Unsaved — publish to create a new version' : 'No changes'}
          </span>
          <div className="flex items-center space-x-2">
            <label className="text-xs text-surface-500 dark:text-surface-400">New version:</label>
            <input
              type="text"
              value={newVersion}
              onChange={(e) => canEdit && setNewVersion(e.target.value)}
              readOnly={!canEdit}
              className="w-24 px-2 py-1 text-xs rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
              placeholder="e.g. 1.0.1"
            />
            <button
              onClick={() => onPublish({ owner_team: ownerTeam, agent_type: agentType })}
              disabled={!newVersion.trim() || isPublishing || !canEdit}
              className="text-xs px-4 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              {isPublishing ? 'Publishing…' : 'Publish Version'}
            </button>
          </div>
        </div>

        {versionHistory.length > 1 && (
          <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700/50">
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1.5">Version history</p>
            <div className="flex flex-wrap gap-2">
              {versionHistory.map((v) => (
                <span
                  key={v.id}
                  className={`text-xs px-2 py-0.5 rounded font-mono ${
                    v.deprecated_at
                      ? 'bg-surface-100 dark:bg-surface-700/50 text-surface-400 line-through'
                      : 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
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
