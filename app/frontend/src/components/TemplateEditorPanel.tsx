import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useTemplateEditorStore } from '../stores/templateEditorStore';
import { useThemeStore } from '../stores/themeStore';

interface TemplateFile {
  fileName: string;
  label: string;
  description: string;
  content: string;
}

export function TemplateEditorPanel() {
  const { closeTemplateEditor } = useTemplateEditorStore();
  const { isDark } = useThemeStore();

  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editContent, setEditContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = editContent !== savedContent;
  const selected = files[selectedIndex];

  // Load files on mount
  useEffect(() => {
    api.getTemplateFiles().then(({ files: loaded }) => {
      setFiles(loaded);
      if (loaded.length > 0) {
        setEditContent(loaded[0].content);
        setSavedContent(loaded[0].content);
      }
    }).catch(console.error).finally(() => setIsLoading(false));
  }, []);

  const handleSelect = (index: number) => {
    setSelectedIndex(index);
    const file = files[index];
    setEditContent(file.content);
    setSavedContent(file.content);
    setConfirmPending(false);
    textareaRef.current?.focus();
  };

  const handleRevert = () => {
    setEditContent(savedContent);
    setConfirmPending(false);
  };

  // First click: show confirmation. Second click: actually save.
  const handleSave = () => {
    if (!confirmPending) {
      setConfirmPending(true);
      return;
    }
    doSave();
  };

  const handleCancelConfirm = () => {
    setConfirmPending(false);
  };

  const doSave = async () => {
    if (!selected) return;
    setIsSaving(true);
    setConfirmPending(false);
    try {
      await api.saveTemplateFile(selected.fileName, editContent);
      setSavedContent(editContent);
      setFiles((prev) =>
        prev.map((f, i) => (i === selectedIndex ? { ...f, content: editContent } : f))
      );
      setToast('Saved');
      setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setToast('Save failed');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut: Cmd/Ctrl+S starts confirm flow
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !isSaving) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, isSaving, confirmPending, editContent, selected]);

  // Cancel confirmation if user edits further
  useEffect(() => {
    if (confirmPending) setConfirmPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent]);

  return (
    <div className={`h-full flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-100/10 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Template Editor</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Output templates that define the structure each agent produces
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {toast && (
            <span className="text-xs font-medium text-green-600 dark:text-green-400">{toast}</span>
          )}
          <button
            onClick={closeTemplateEditor}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Close"
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
        <nav className="w-52 border-r border-slate-200 dark:border-slate-700 overflow-y-auto flex-shrink-0 bg-white dark:bg-slate-800/50">
          {isLoading ? (
            <div className="p-4 text-sm text-slate-400">Loading...</div>
          ) : (
            files.map((file, i) => (
              <button
                key={file.fileName}
                onClick={() => handleSelect(i)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 transition-colors ${
                  i === selectedIndex
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-l-2 border-l-amber-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                }`}
              >
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate block">
                  {file.label}
                </span>
              </button>
            ))
          )}
        </nav>

        {/* Right editor area */}
        {selected && (
          <div className="flex-1 flex flex-col min-w-0">
            {/* File info bar */}
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{selected.label}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{selected.description}</p>
            </div>

            {/* Textarea */}
            <div className="flex-1 p-4 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder={`Template content for ${selected.label}...`}
                spellCheck={false}
              />
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
              {/* Confirmation banner */}
              {confirmPending && (
                <div className="mb-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Are you sure? Changing this template will alter the output of all future workflows.
                  </p>
                  <div className="flex items-center space-x-2 mt-2">
                    <button
                      onClick={doSave}
                      disabled={isSaving}
                      className="text-xs px-4 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-40 font-medium"
                    >
                      {isSaving ? 'Saving...' : 'Yes, save changes'}
                    </button>
                    <button
                      onClick={handleCancelConfirm}
                      className="text-xs px-3 py-1.5 rounded-md border border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className={`text-xs ${isDirty ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}>
                  {isDirty ? 'Unsaved changes' : 'No changes'}
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleRevert}
                    disabled={!isDirty}
                    className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Revert
                  </button>
                  {!confirmPending && (
                    <button
                      onClick={handleSave}
                      disabled={!isDirty || isSaving}
                      className="text-xs px-4 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
