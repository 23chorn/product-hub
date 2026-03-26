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
    <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Initiative name"
        className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-2"
      />
      <textarea
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none mb-2"
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!title.trim() || saving}
          className="flex-1 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
