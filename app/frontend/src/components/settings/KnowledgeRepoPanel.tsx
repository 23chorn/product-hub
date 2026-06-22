import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import type { KbRepo } from '@pap/shared';

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

const blankForm = { label: '', repository: '', branch: '', project: '' };

export function KnowledgeRepoPanel() {
  const toast = useToast();
  const [repos, setRepos] = useState<KbRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(blankForm);
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadRepos() {
    try {
      const { repos } = await api.listKbRepos();
      setRepos(repos);
    } catch {
      toast.error('Failed to load tracked repos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRepos(); }, []);

  async function addRepo() {
    if (!form.label.trim() || !form.repository.trim()) {
      toast.error('Label and repository name are required');
      return;
    }
    setSaving(true);
    try {
      const { repo, syncWarning } = await api.createKbRepo(
        form.label.trim(),
        form.repository.trim(),
        form.branch.trim() || undefined,
        form.project.trim() || undefined
      );
      setRepos((prev) => [...prev, repo]);
      setForm(blankForm);
      setShowNewForm(false);
      if (syncWarning) toast.warning(syncWarning);
      else toast.success(`Added ${repo.label} — synced ${repo.fileCount} file(s)`);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to add repo');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(repo: KbRepo) {
    setEditingId(repo.id);
    setEditForm({ label: repo.label, repository: repo.repository, branch: repo.branch ?? '', project: repo.project ?? '' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(blankForm);
  }

  async function saveEdit(id: number) {
    if (!editForm.label.trim()) {
      toast.error('Label is required');
      return;
    }
    setSavingEdit(true);
    try {
      const { repo } = await api.updateKbRepo(id, {
        label: editForm.label.trim(),
        branch: editForm.branch.trim(),
        project: editForm.project.trim(),
      });
      setRepos((prev) => prev.map((r) => (r.id === id ? repo : r)));
      cancelEdit();
      toast.success('Repo updated');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to update repo');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteRepo(id: number, label: string) {
    if (!confirm(`Stop tracking "${label}"? This removes its synced files and comments.`)) return;
    try {
      await api.deleteKbRepo(id);
      setRepos((prev) => prev.filter((r) => r.id !== id));
      toast.success('Repo removed');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to remove repo');
    }
  }

  async function syncRepo(id: number) {
    setSyncingId(id);
    try {
      const result = await api.syncKbRepo(id);
      await loadRepos();
      toast.success(`Synced: +${result.added} ~${result.updated} -${result.removed}`);
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
      {repos.length === 0 && !showNewForm && (
        <p className="text-sm text-surface-400">No repos tracked yet.</p>
      )}

      {repos.map((repo) => (
        <div key={repo.id} className="bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700 p-3">
          {editingId === repo.id ? (
            <div className="space-y-2">
              <input
                value={editForm.label}
                onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                placeholder="Label"
                className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <input
                value={editForm.branch}
                onChange={(e) => setEditForm({ ...editForm, branch: e.target.value })}
                placeholder="Branch (optional — defaults to the repo's default branch)"
                className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <input
                value={editForm.project}
                onChange={(e) => setEditForm({ ...editForm, project: e.target.value })}
                placeholder="Azure DevOps project (optional — defaults to the configured project)"
                className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="text-xs text-surface-400 font-mono">{repo.repository}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1.5 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveEdit(repo.id)}
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
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{repo.label}</p>
                <p className="text-xs text-surface-500 mt-0.5 font-mono">
                  {repo.project ? `${repo.project}/` : ''}{repo.repository}{repo.branch ? `@${repo.branch}` : ''}
                </p>
                <p className="text-xs text-surface-400 mt-1">{repo.fileCount} file(s) · synced {formatTimestamp(repo.lastSyncedAt)}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => startEdit(repo)}
                  className="px-2 py-1 text-xs font-medium rounded-md text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => syncRepo(repo.id)}
                  disabled={syncingId === repo.id}
                  className="px-2 py-1 text-xs font-medium rounded-md text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-50 transition-colors"
                >
                  {syncingId === repo.id ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={() => deleteRepo(repo.id, repo.label)}
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
            placeholder="Label (e.g. Web Frontend)"
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            value={form.repository}
            onChange={(e) => setForm({ ...form, repository: e.target.value })}
            placeholder="Azure DevOps repository name (e.g. xCube-Web)"
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            placeholder="Branch (optional — defaults to the repo's default branch)"
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            value={form.project}
            onChange={(e) => setForm({ ...form, project: e.target.value })}
            placeholder="Azure DevOps project (optional — only if different from the configured project)"
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowNewForm(false); setForm(blankForm); }}
              className="px-3 py-1.5 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={addRepo}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 transition-colors"
            >
              {saving ? 'Adding…' : 'Add repo'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewForm(true)}
          className="w-full py-2 text-xs font-medium rounded-lg border border-dashed border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          + Add repo
        </button>
      )}
    </div>
  );
}
