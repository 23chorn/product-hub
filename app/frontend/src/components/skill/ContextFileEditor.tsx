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
  onChange: (v: string) => void;
  onSave: () => void;
  onRevert: () => void;
  onRestoreVersion: (content: string) => void;
  onLoadTemplate: () => void;
}

/** Context-file editor pane: markdown editor, version history sidebar, save/revert footer. */
export function ContextFileEditor({
  file, editContent, savedContent, isSaving, versions, versionsLoading,
  textareaRef, onChange, onSave, onRevert, onRestoreVersion, onLoadTemplate,
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
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{file.label}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{file.description}</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Edit · Preview</span>
            {versions.length > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors font-medium ${showHistory ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
              >
                History ({versions.length})
              </button>
            )}
            {file.hasTemplate && !editContent.trim() && (
              <button
                onClick={onLoadTemplate}
                className="text-xs px-3 py-1.5 rounded-md bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors font-medium"
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
            onChange={onChange}
            placeholder={`Paste or type your ${file.label.toLowerCase()} content here…`}
            textareaRef={textareaRef}
          />
        </div>

        {showHistory && (
          <div className="w-64 flex-shrink-0 border-l border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Version history</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {versionsLoading ? (
                <p className="text-xs text-slate-400 p-3">Loading…</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-slate-400 p-3">No saved versions yet.</p>
              ) : (
                versions.map((v) => {
                  const isCurrent = v.content === editContent;
                  return (
                    <div key={v.id} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                      <div className={`px-3 py-2.5 transition-colors ${isCurrent ? 'bg-teal-50/60 dark:bg-teal-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                                {formatVersionDate(v.created_at)}
                              </p>
                              {isCurrent && (
                                <span className="flex-shrink-0 text-xs px-1.5 py-0 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium">current</span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400">{v.content.length.toLocaleString()} chars</p>
                          </div>
                          <button
                            disabled={isCurrent}
                            onClick={() => { onRestoreVersion(v.content); setShowHistory(false); }}
                            className="flex-shrink-0 text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-teal-100 dark:hover:bg-teal-900/40 hover:text-teal-700 dark:hover:text-teal-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-100 dark:disabled:hover:bg-slate-700"
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

      <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex items-center justify-between flex-shrink-0">
        <span className={`text-xs ${isDirty ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}>
          {isDirty ? 'Unsaved changes' : 'No changes'}
        </span>
        <div className="flex items-center space-x-2">
          <button
            onClick={onRevert}
            disabled={!isDirty}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Revert
          </button>
          <button
            onClick={onSave}
            disabled={!isDirty || isSaving}
            className="text-xs px-4 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
