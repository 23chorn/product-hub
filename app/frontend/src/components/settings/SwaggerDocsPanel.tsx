import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import type { SwaggerApiDoc } from '@pap/shared';
import { formatTimestamp } from '../../utils/relative-time';

const blankForm = { label: '', docUrl: '' };

export function SwaggerDocsPanel() {
  const toast = useToast();
  const [docs, setDocs] = useState<SwaggerApiDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadDocs() {
    try {
      const { docs } = await api.listSwaggerDocs();
      setDocs(docs);
    } catch {
      toast.error('Failed to load linked API docs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDocs(); }, []);

  async function addDoc() {
    if (!form.label.trim() || !form.docUrl.trim()) {
      toast.error('Label and doc URL are required');
      return;
    }
    setSaving(true);
    try {
      const { doc, syncWarning } = await api.createSwaggerDoc(form.label.trim(), form.docUrl.trim());
      setDocs((prev) => [...prev, doc]);
      setForm(blankForm);
      setShowNewForm(false);
      if (syncWarning) toast.warning(syncWarning);
      else toast.success(`Added ${doc.label}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to add doc');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(doc: SwaggerApiDoc) {
    setEditingId(doc.id);
    setEditLabel(doc.label);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditLabel('');
  }

  async function saveEdit(id: number) {
    if (!editLabel.trim()) {
      toast.error('Label is required');
      return;
    }
    setSavingEdit(true);
    try {
      const { doc } = await api.updateSwaggerDoc(id, { label: editLabel.trim() });
      setDocs((prev) => prev.map((d) => (d.id === id ? doc : d)));
      cancelEdit();
      toast.success('Doc updated');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to update doc');
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleActive(doc: SwaggerApiDoc) {
    try {
      const { doc: updated } = await api.updateSwaggerDoc(doc.id, { active: !doc.active });
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to update doc');
    }
  }

  async function deleteDoc(id: number, label: string) {
    if (!confirm(`Remove "${label}"? This stops it from being used as architecture context.`)) return;
    try {
      await api.deleteSwaggerDoc(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      toast.success('Doc removed');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to remove doc');
    }
  }

  async function syncDoc(id: number) {
    setSyncingId(id);
    try {
      const { doc } = await api.syncSwaggerDoc(id);
      setDocs((prev) => prev.map((d) => (d.id === id ? doc : d)));
      toast.success(doc.lastSyncError ? `Synced, but: ${doc.lastSyncError}` : 'Synced');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Sync failed');
    } finally {
      setSyncingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-surface-400">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {docs.length === 0 && !showNewForm && (
        <p className="text-sm text-surface-400">No API docs linked yet.</p>
      )}

      {docs.map((doc) => (
        <div key={doc.id} className="bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700 p-3">
          {editingId === doc.id ? (
            <div className="space-y-2">
              <input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                placeholder="Label"
                className="w-full text-sm bg-surface-50 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="text-xs text-surface-400 font-mono break-all">{doc.docUrl}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1.5 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveEdit(doc.id)}
                  disabled={savingEdit}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 transition-colors"
                >
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{doc.label}</p>
                  {!doc.active && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-500 dark:text-surface-400">Off</span>
                  )}
                </div>
                <p className="text-xs text-surface-500 mt-0.5 font-mono break-all">{doc.docUrl}</p>
                <p className="text-xs text-surface-400 mt-1">
                  {doc.specTitle ? `${doc.specTitle}${doc.specVersion ? ` v${doc.specVersion}` : ''} · ` : ''}
                  synced {formatTimestamp(doc.lastSyncedAt)}
                </p>
                {doc.lastSyncError && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{doc.lastSyncError}</p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => toggleActive(doc)}
                  className="px-2 py-1 text-xs font-medium rounded-md text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                >
                  {doc.active ? 'Turn off' : 'Turn on'}
                </button>
                <button
                  onClick={() => startEdit(doc)}
                  className="px-2 py-1 text-xs font-medium rounded-md text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => syncDoc(doc.id)}
                  disabled={syncingId === doc.id}
                  className="px-2 py-1 text-xs font-medium rounded-md text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-50 transition-colors"
                >
                  {syncingId === doc.id ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={() => deleteDoc(doc.id, doc.label)}
                  className="px-2 py-1 text-xs font-medium rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showNewForm ? (
        <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Label (e.g. Payments API)"
            className="w-full text-sm bg-surface-50 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            value={form.docUrl}
            onChange={(e) => setForm({ ...form, docUrl: e.target.value })}
            placeholder="Raw OpenAPI/Swagger JSON URL (e.g. https://api.example.com/swagger/v1/swagger.json)"
            className="w-full text-sm bg-surface-50 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowNewForm(false); setForm(blankForm); }}
              className="px-3 py-1.5 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={addDoc}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 transition-colors"
            >
              {saving ? 'Adding…' : 'Add doc'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewForm(true)}
          className="w-full py-2 text-xs font-medium rounded-lg border border-dashed border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          + Link API doc
        </button>
      )}
    </div>
  );
}
