import { MarkdownEditor } from './MarkdownEditor';
import type { AgentFile } from '../../services/api';

interface SkillViewerProps {
  file: AgentFile;
  displayName: string;
  editContent: string;
  savedContent: string;
  isSaving: boolean;
  canEdit: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onRevert: () => void;
}

/** Agent file editor pane: persona or output-template markdown, edit/preview, save-to-disk footer. */
export function SkillViewer({
  file, displayName, editContent, savedContent, isSaving, canEdit,
  onChange, onSave, onRevert,
}: SkillViewerProps) {
  const isDirty = editContent !== savedContent;

  return (
    <>
      {/* Header */}
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{displayName}</h3>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 font-mono">
            {file.dir === 'templates' ? 'Output template' : 'Persona'}
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
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden">
        <MarkdownEditor
          value={editContent}
          onChange={onChange}
          placeholder="Enter content…"
          readOnly={!canEdit}
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className={`text-xs ${!canEdit ? 'text-surface-400' : isDirty ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-surface-400'}`}>
            {!canEdit ? 'Read only — insufficient role' : isDirty ? 'Unsaved changes' : 'No changes'}
          </span>
          <div className="flex items-center space-x-2">
            {isDirty && canEdit && (
              <button
                onClick={onRevert}
                className="text-xs px-3 py-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors font-medium"
              >
                Revert
              </button>
            )}
            <button
              onClick={onSave}
              disabled={!isDirty || isSaving || !canEdit}
              className="text-xs px-4 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
