import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useContextEditorStore } from '../stores/contextEditorStore';
import { useThemeStore } from '../stores/themeStore';

interface ContextFile {
  fileName: string;
  label: string;
  description: string;
  hasTemplate: boolean;
  content: string;
  templateContent?: string;
}

export function ContextEditorPanel() {
  const { closeContextEditor } = useContextEditorStore();
  const { isDark } = useThemeStore();

  const [files, setFiles] = useState<ContextFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editContent, setEditContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = editContent !== savedContent;
  const selected = files[selectedIndex];

  // Load files on mount
  useEffect(() => {
    api.getContextFiles().then(({ files: loaded }) => {
      setFiles(loaded);
      if (loaded.length > 0) {
        setEditContent(loaded[0].content);
        setSavedContent(loaded[0].content);
      }
    }).catch(console.error).finally(() => setIsLoading(false));
  }, []);

  // When selection changes, update editor content
  const handleSelect = (index: number) => {
    setSelectedIndex(index);
    const file = files[index];
    setEditContent(file.content);
    setSavedContent(file.content);
    textareaRef.current?.focus();
  };

  const handleLoadTemplate = () => {
    if (selected?.templateContent) {
      setEditContent(selected.templateContent);
    }
  };

  const handleRevert = () => {
    setEditContent(savedContent);
  };

  const handleSave = async () => {
    if (!selected) return;
    setIsSaving(true);
    try {
      await api.saveContextFile(selected.fileName, editContent);
      setSavedContent(editContent);
      // Update the files array so the nav dot reflects the new state
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

  // Keyboard shortcut: Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !isSaving) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, isSaving, editContent, selected]);

  return (
    <div className={`h-full flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-100/10 ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Context Editor</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Files injected into every agent's system prompt
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {toast && (
            <span className="text-xs font-medium text-green-600 dark:text-green-400">{toast}</span>
          )}
          <button
            onClick={closeContextEditor}
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
                    ? 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-l-teal-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      file.content ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {file.label}
                  </span>
                </div>
              </button>
            ))
          )}
        </nav>

        {/* Right editor area */}
        {selected && (
          <div className="flex-1 flex flex-col min-w-0">
            {/* File info bar */}
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{selected.label}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{selected.description}</p>
                </div>
                {selected.hasTemplate && !editContent.trim() && (
                  <button
                    onClick={handleLoadTemplate}
                    className="text-xs px-3 py-1.5 rounded-md bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors font-medium"
                  >
                    Load template
                  </button>
                )}
              </div>
            </div>

            {/* Textarea */}
            <div className="flex-1 p-4 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm p-4 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                placeholder={`Paste or type your ${selected.label.toLowerCase()} content here...`}
                spellCheck={false}
              />
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex items-center justify-between flex-shrink-0">
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
                <button
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  className="text-xs px-4 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
