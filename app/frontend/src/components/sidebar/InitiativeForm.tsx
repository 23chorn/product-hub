import type React from 'react';

interface InitiativeFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  titleInputRef: React.RefObject<HTMLInputElement>;
}

export function InitiativeForm({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  saving,
  onSubmit,
  onCancel,
  titleInputRef,
}: InitiativeFormProps) {
  return (
    <div className="mb-3 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Initiative name"
        className="w-full px-2 py-1.5 text-sm border border-teal-300 dark:border-teal-600 rounded focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mb-2"
      />
      <textarea
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full px-2 py-1.5 text-sm border border-teal-300 dark:border-teal-600 rounded focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-none mb-2"
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!title.trim() || saving}
          className="flex-1 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
