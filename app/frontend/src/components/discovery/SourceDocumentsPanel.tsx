import { useState } from 'react';
import type { DiscoverySource, DiscoverySourceType } from '@pap/shared';
import { api } from '../../services/api';
import { SOURCE_TYPE_LABELS, SOURCE_TYPE_OPTIONS } from './types';

interface SourceDocumentsPanelProps {
  sources: DiscoverySource[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSourceAdded: (source: DiscoverySource) => void;
  onSourceDeleted: (id: string) => void;
  canMutate: boolean;
  loading: boolean;
}

export function SourceDocumentsPanel({
  sources, selectedIds, onToggleSelect, onSourceAdded, onSourceDeleted, canMutate, loading,
}: SourceDocumentsPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [sourceType, setSourceType] = useState<DiscoverySourceType>('user_interview');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const source = await api.createDiscoverySource(sourceType, title.trim(), content.trim());
      onSourceAdded(source);
      setTitle('');
      setContent('');
      setShowForm(false);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to add source');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDiscoverySource(id);
      onSourceDeleted(id);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to delete source');
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-700">
        <div>
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Source Documents</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Select sources, then run discovery</p>
        </div>
        {canMutate && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700/70 transition-colors"
          >
            {showForm ? 'Cancel' : '+ Add source'}
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 space-y-2.5 bg-surface-50/60 dark:bg-surface-800/30">
          <select
            value={sourceType}
            onChange={e => setSourceType(e.target.value as DiscoverySourceType)}
            className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm text-surface-900 dark:text-surface-100"
          >
            {SOURCE_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (e.g. Interview with Jane)"
            className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400"
          />
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Paste the interview notes, review text, or competitor notes..."
            rows={5}
            className="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 resize-none"
          />
          <button
            onClick={handleAdd}
            disabled={!title.trim() || !content.trim() || saving}
            className="w-full py-1.5 px-3 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            {saving ? 'Adding...' : 'Add source'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-sm text-surface-400">Loading...</div>
        ) : sources.length === 0 ? (
          <div className="p-6 text-center text-sm text-surface-400">
            No source documents yet. Add a user interview, app store review, or competitor note to get started.
          </div>
        ) : (
          <ul className="divide-y divide-surface-200 dark:divide-surface-700">
            {sources.map(source => (
              <li key={source.id} className="px-4 py-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(source.id)}
                  onChange={() => onToggleSelect(source.id)}
                  className="mt-1 rounded border-surface-300 dark:border-surface-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                      {SOURCE_TYPE_LABELS[source.sourceType]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{source.title}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 line-clamp-2 mt-0.5">{source.content}</p>
                </div>
                {canMutate && (
                  confirmDeleteId === source.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => handleDelete(source.id)} className="text-xs px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white">Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-xs px-2 py-1 rounded-md text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(source.id)}
                      className="flex-shrink-0 p-1 rounded-md text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      title="Delete source"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
