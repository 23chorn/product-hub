import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { ROLE_LABELS } from '../../stores/authStore';
import type { CurrentUser } from '../../stores/authStore';
import { RoleBadge } from '../common/RoleBadge';

const ALL_ROLES = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];
// view_only is a hard-deny marker, not an approval permission — never offer it as a stage approver role.
const ASSIGNABLE_STAGE_ROLES = ALL_ROLES.filter(r => r !== 'view_only');

const STAGE_ROLE_STAGES = [
  'analyst', 'pm_prd', 'solution_architect', 'api_spec', 'epic_feature_planner',
  'story_decomposition', 'story_decomposition_qa', 'qa_engineer',
  'prototype', 'figma_design',
];

type Tab = 'users' | 'stage_roles';

type UserFormData = {
  username: string;
  name: string;
  password: string;
  is_admin: boolean;
  slack_user_id: string;
  roles: string[];
};

const blankForm = (): UserFormData => ({
  username: '', name: '', password: '', is_admin: false, slack_user_id: '', roles: [],
});

export function UserManagementPanel() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [stageRoles, setStageRoles] = useState<Record<string, string[]>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UserFormData>(blankForm());
  const [showNewForm, setShowNewForm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadUsers() {
    try {
      const data = await api.listUsers();
      setUsers(data.users);
    } catch { /* */ }
  }

  async function loadStageRoles() {
    try {
      const data = await api.getStageRoles();
      const map: Record<string, string[]> = {};
      for (const sr of data.stageRoles) {
        if (!map[sr.stage]) map[sr.stage] = [];
        map[sr.stage].push(sr.role_name);
      }
      setStageRoles(map);
    } catch { /* */ }
  }

  useEffect(() => {
    loadUsers();
    loadStageRoles();
  }, []);

  function startEdit(u: CurrentUser) {
    setEditingId(u.id);
    setForm({ username: u.username, name: u.name, password: '', is_admin: u.is_admin, slack_user_id: u.slack_user_id ?? '', roles: [...u.roles] });
    setShowNewForm(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(blankForm());
  }

  async function saveUser() {
    setLoading(true);
    try {
      const payload: any = {
        username: form.username, name: form.name, is_admin: form.is_admin,
        slack_user_id: form.slack_user_id || null, roles: form.roles,
      };
      if (form.password) payload.password = form.password;
      if (editingId) {
        await api.updateUser(editingId, payload);
        toast.success('User updated');
      } else {
        if (!form.password) { toast.error('Password required for new users'); return; }
        await api.createUser({ ...payload, password: form.password });
        toast.success('User created');
      }
      setEditingId(null);
      setShowNewForm(false);
      setForm(blankForm());
      await loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to save user');
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(id: number) {
    if (!confirm('Delete this user?')) return;
    try {
      await api.deleteUser(id);
      toast.success('User deleted');
      await loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to delete user');
    }
  }

  async function addStageRole(stage: string, role: string) {
    if (!role) return;
    if ((stageRoles[stage] ?? []).includes(role)) return;
    try {
      await api.addStageRole(stage, role);
      setStageRoles(prev => ({ ...prev, [stage]: [...(prev[stage] ?? []), role] }));
      toast.success(`Added ${ROLE_LABELS[role] ?? role} to ${STAGE_LABELS_MAP[stage] ?? stage}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to add role');
    }
  }

  async function removeStageRole(stage: string, role: string) {
    try {
      await api.removeStageRole(stage, role);
      setStageRoles(prev => ({ ...prev, [stage]: (prev[stage] ?? []).filter(r => r !== role) }));
      toast.success(`Removed ${ROLE_LABELS[role] ?? role} from ${STAGE_LABELS_MAP[stage] ?? stage}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to remove role');
    }
  }

  const STAGE_LABELS_MAP: Record<string, string> = {
    analyst: 'Research Analyst', pm_prd: 'PRD', solution_architect: 'Architecture',
    api_spec: 'API Contract — Kira', epic_feature_planner: 'Epic & Feature Plan',
    story_decomposition: 'Story Decomposition', story_decomposition_qa: 'QA Test Suite',
    qa_engineer: 'QA Engineer (legacy)', prototype: 'Prototype', figma_design: 'Figma Design',
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-4 border-b border-surface-200 dark:border-surface-700">
        {(['users', 'stage_roles'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-1 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            {t === 'users' ? 'Users' : 'Stage Roles'}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="space-y-3">
          {/* User list */}
          {users.map(u => (
            <div key={u.id} className="bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700 p-3">
              {editingId === u.id ? (
                <UserForm form={form} setForm={setForm} onSave={saveUser} onCancel={cancelEdit} loading={loading} isEdit />
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-surface-900 dark:text-surface-100">{u.name}</span>
                      {u.is_admin && <span className="text-[10px] font-semibold bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 px-1.5 py-0.5 rounded">Admin</span>}
                    </div>
                    <p className="text-xs text-surface-500 mt-0.5 font-mono">@{u.username}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {u.roles.map(r => (
                        <RoleBadge key={r}>{ROLE_LABELS[r] ?? r}</RoleBadge>
                      ))}
                      {u.slack_user_id && (
                        <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded font-medium">
                          Slack: {u.slack_user_id}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => startEdit(u)} className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 px-2 py-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => deleteUser(u.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* New user form */}
          {showNewForm ? (
            <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-brand-300 dark:border-brand-700 p-3">
              <UserForm form={form} setForm={setForm} onSave={saveUser} onCancel={() => { setShowNewForm(false); setForm(blankForm()); }} loading={loading} isEdit={false} />
            </div>
          ) : (
            <button
              onClick={() => { setShowNewForm(true); setEditingId(null); setForm(blankForm()); }}
              className="w-full py-2 text-xs font-medium text-brand-600 dark:text-brand-400 border border-dashed border-brand-300 dark:border-brand-700 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/10 transition-colors"
            >
              + Add user
            </button>
          )}
        </div>
      )}

      {tab === 'stage_roles' && (
        <div className="space-y-2">
          <p className="text-xs text-surface-500 dark:text-surface-400">
            Assign which roles can approve each stage. Any user with at least one of the assigned roles can approve. Users with those roles receive Slack notifications.
          </p>
          {STAGE_ROLE_STAGES.map(stage => {
            const assigned = stageRoles[stage] ?? [];
            const available = ASSIGNABLE_STAGE_ROLES.filter(r => !assigned.includes(r));
            return (
              <div key={stage} className="py-2 border-b border-surface-200 dark:border-surface-700 last:border-0">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs text-surface-700 dark:text-surface-300">{STAGE_LABELS_MAP[stage] ?? stage}</span>
                  {available.length > 0 && (
                    <select
                      value=""
                      onChange={e => { if (e.target.value) addStageRole(stage, e.target.value); }}
                      className="text-xs bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1 text-surface-500 dark:text-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">+ add role</option>
                      {available.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {assigned.length === 0 && (
                    <span className="text-[11px] text-surface-400 dark:text-surface-600 italic">no roles — anyone can approve</span>
                  )}
                  {assigned.map(role => (
                    <RoleBadge key={role} variant="required" onRemove={() => removeStageRole(stage, role)}>
                      {ROLE_LABELS[role] ?? role}
                    </RoleBadge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserForm({
  form, setForm, onSave, onCancel, loading, isEdit
}: {
  form: UserFormData;
  setForm: (f: UserFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  loading: boolean;
  isEdit: boolean;
}) {
  function toggleRole(role: string) {
    setForm({ ...form, roles: form.roles.includes(role) ? form.roles.filter(r => r !== role) : [...form.roles, role] });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-surface-500 uppercase tracking-wide">Username</label>
          <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
            placeholder="jane"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="mt-1 w-full text-xs bg-surface-50 dark:bg-surface-700 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono" />
        </div>
        <div>
          <label className="text-[10px] text-surface-500 uppercase tracking-wide">Display name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Jane Smith"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="mt-1 w-full text-xs bg-surface-50 dark:bg-surface-700 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-surface-500 uppercase tracking-wide">{isEdit ? 'New password (leave blank to keep)' : 'Password'}</label>
          <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            className="mt-1 w-full text-xs bg-surface-50 dark:bg-surface-700 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <div>
          <label className="text-[10px] text-surface-500 uppercase tracking-wide">Slack User ID</label>
          <input value={form.slack_user_id} onChange={e => setForm({ ...form, slack_user_id: e.target.value })}
            placeholder="UXXXXXXXXX"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="mt-1 w-full text-xs bg-surface-50 dark:bg-surface-700 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1.5 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-surface-500 uppercase tracking-wide">Roles</label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {ALL_ROLES.map(r => (
            <button key={r} type="button" onClick={() => toggleRole(r)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                form.roles.includes(r)
                  ? 'bg-brand-100 dark:bg-brand-900/40 border-brand-400 dark:border-brand-600 text-brand-800 dark:text-brand-300 font-medium'
                  : 'border-surface-300 dark:border-surface-600 text-surface-500 hover:border-brand-400'
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-400 cursor-pointer">
            <input type="checkbox" checked={form.is_admin} onChange={e => setForm({ ...form, is_admin: e.target.checked })}
              className="rounded border-surface-300 text-rose-600 focus:ring-rose-500" />
            Admin
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:bg-surface-400 text-white rounded-md transition-colors">
          {loading ? 'Saving...' : (isEdit ? 'Save changes' : 'Create user')}
        </button>
        <button onClick={onCancel} className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

