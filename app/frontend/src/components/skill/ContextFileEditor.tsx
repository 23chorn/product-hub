import { useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import type { ContextFile, ContextFileVersion } from './types';

interface ContextFileEditorProps {
  file: ContextFile;
  editContent: string;
  savedContent: string;
  isSaving: boolean;
  versions: ContextFileVersion[];
  versionsLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  canEdit: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onRevert: () => void;
  onRestoreVersion: (content: string) => void;
  onLoadTemplate: () => void;
}

/** Context-file editor pane: markdown editor, version history sidebar, save/revert footer. */
export function ContextFileEditor({
  file, editContent, savedContent, isSaving, versions, versionsLoading,
  textareaRef, canEdit, onChange, onSave, onRevert, onRestoreVersion, onLoadTemplate,
}: ContextFileEditorProps) {
  const isDirty = editContent !== savedContent;
  const [showHistory, setShowHistory] = useState(false);

  function formatVersionDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{file.label}</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{file.description}</p>
          </div>
          <div className="flex items-center space-x-2">
            {!canEdit && (
              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 font-medium">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Read only
              </span>
            )}
            {versions.length > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors font-medium ${showHistory ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300' : 'border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700'}`}
              >
                History ({versions.length})
              </button>
            )}
            {file.hasTemplate && !editContent.trim() && (
              <button
                onClick={onLoadTemplate}
                className="text-xs px-3 py-1.5 rounded-md bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors font-medium"
              >
                Load template
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-4 overflow-hidden">
          <MarkdownEditor
            value={editContent}
            onChange={canEdit ? onChange : () => {}}
            placeholder={`Paste or type your ${file.label.toLowerCase()} content here…`}
            textareaRef={textareaRef}
            readOnly={!canEdit}
          />
        </div>

        {showHistory && (
          <div className="w-64 flex-shrink-0 border-l border-surface-200 dark:border-surface-700 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wide">Version history</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {versionsLoading ? (
                <p className="text-xs text-surface-400 p-3">Loading…</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-surface-400 p-3">No saved versions yet.</p>
              ) : (
                versions.map((v) => {
                  const isCurrent = v.content === editContent;
                  return (
                    <div key={v.id} className="border-b border-surface-100 dark:border-surface-700/50 last:border-0">
                      <div className={`px-3 py-2.5 transition-colors ${isCurrent ? 'bg-brand-50/60 dark:bg-brand-900/20' : 'hover:bg-surface-50 dark:hover:bg-surface-700/40'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium text-surface-700 dark:text-surface-300 truncate">
                                {formatVersionDate(v.created_at)}
                              </p>
                              {isCurrent && (
                                <span className="flex-shrink-0 text-xs px-1.5 py-0 rounded bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-medium">current</span>
                              )}
                            </div>
                            <p className="text-xs text-surface-400">{v.content.length.toLocaleString()} chars</p>
                          </div>
                          <button
                            disabled={isCurrent}
                            onClick={() => { onRestoreVersion(v.content); setShowHistory(false); }}
                            className="flex-shrink-0 text-xs px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 hover:text-brand-700 dark:hover:text-brand-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-100 dark:disabled:hover:bg-surface-700"
                          >
                            Restore
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex items-center justify-between flex-shrink-0">
        <span className={`text-xs ${!canEdit ? 'text-surface-400' : isDirty ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-surface-400'}`}>
          {!canEdit ? 'Read only — insufficient role' : isDirty ? 'Unsaved changes' : 'No changes'}
        </span>
        <div className="flex items-center space-x-2">
          <button
            onClick={onRevert}
            disabled={!isDirty || !canEdit}
            className="text-xs px-3 py-1.5 rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Revert
          </button>
          <button
            onClick={onSave}
            disabled={!isDirty || isSaving || !canEdit}
            className="text-xs px-4 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
