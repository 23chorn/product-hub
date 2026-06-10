import { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { useSettingsStore } from '../stores/settingsStore';
import { useToast } from '../hooks/useToast';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Settings {
  user: { name: string; projectName: string; skillLevel: string; communicationLanguage: string };
  sprint: { velocity: number; capacityFactor: number; aiAssistedEnabled: boolean };
  pipeline: { enabledStages: Record<string, boolean> };
  qualityGates: { requireCriticReview: boolean; autoApproveCritic: boolean };
  integrations: { slackWebhookUrl: string | null };
  demo: { enabled: boolean; projectPath: string | null; fixtureTheme: string };
}

const STAGE_LABELS: Record<string, string> = {
  analyst: 'Research Analyst',
  pm_prd: 'Product Manager — PRD',
  solution_architect: 'Solution Architect',
  pm_backlog: 'Product Manager — Backlog',
  qa_engineer: 'QA Engineer',
  tech_refinement: 'Tech Refinement',
  gtm_strategy: 'Go-to-Market Strategy',
  feature_marketing: 'Feature Marketing',
  curator: 'Context Curator',
};

const STAGE_ORDER = ['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'qa_engineer', 'tech_refinement', 'gtm_strategy', 'feature_marketing'];
const ALWAYS_ON = new Set(['curator']);

const SKILL_LEVELS = ['beginner', 'intermediate', 'expert'];

type Tab = 'pipeline' | 'quality' | 'sprint' | 'user' | 'integrations';

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
    </div>
  );
}

// ── Field row ──────────────────────────────────────────────────────────────────

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm text-slate-700 dark:text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const { closeSettings, setDemoMode } = useSettingsStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('pipeline');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s: Settings) => { setSettings(s); setDraft(s); })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const patch = useCallback(<K extends keyof Settings>(section: K, value: Partial<Settings[K]>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const updated = { ...prev, [section]: { ...prev[section], ...value } };
      setDirty(JSON.stringify(updated) !== JSON.stringify(settings));
      return updated;
    });
  }, [settings]);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await api.updateSettings(draft);
      setSettings(draft);
      setDirty(false);
      setDemoMode(draft.demo.enabled);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'pipeline',     label: 'Pipeline' },
    { key: 'quality',      label: 'Quality gates' },
    { key: 'sprint',       label: 'Sprint planning' },
    { key: 'user',         label: 'User & project' },
    { key: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Configuration</p>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">Settings</h2>
        </div>
        <button
          onClick={closeSettings}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 rounded"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 flex-shrink-0 bg-white dark:bg-slate-900">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {!loading && draft && tab === 'pipeline' && (
          <div>
            <SectionHeader
              title="Pipeline agents"
              description="Toggle which specialist agents run in each workflow. Curator always runs last and cannot be disabled."
            />
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {STAGE_ORDER.map(stage => {
                const isAlwaysOn = ALWAYS_ON.has(stage);
                const enabled = draft.pipeline.enabledStages[stage] ?? true;
                return (
                  <div key={stage} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {STAGE_LABELS[stage] ?? stage}
                      </p>
                      {isAlwaysOn && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Always enabled</p>
                      )}
                    </div>
                    <Toggle
                      checked={isAlwaysOn ? true : enabled}
                      disabled={isAlwaysOn}
                      onChange={v => patch('pipeline', { enabledStages: { ...draft.pipeline.enabledStages, [stage]: v } })}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-5">
              <SectionHeader title="Demo mode" description="When enabled, workflows use static fixture data instead of live LLM calls — useful for testing the pipeline UI and approval flow without API costs." />
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <FieldRow label="Demo mode enabled" hint="Overrides the DEMO_MODE environment variable. Takes effect on the next workflow run.">
                  <Toggle
                    checked={draft.demo.enabled}
                    onChange={v => patch('demo', { enabled: v })}
                  />
                </FieldRow>
              </div>
              {draft.demo.projectPath && (
                <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Demo project path</p>
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-400 break-all">{draft.demo.projectPath}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Set via <code className="text-amber-500">DEMO_PROJECT_PATH</code> in .env</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && draft && tab === 'quality' && (
          <div>
            <SectionHeader
              title="Quality gates"
              description="Control how the inline critic agent reviews and gates specialist output."
            />
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <FieldRow
                label="Require critic review"
                hint="After each specialist stage, the critic agent reviews the output. Disable to skip reviews entirely."
              >
                <Toggle
                  checked={draft.qualityGates.requireCriticReview}
                  onChange={v => patch('qualityGates', { requireCriticReview: v })}
                />
              </FieldRow>
              <FieldRow
                label="Auto-approve passing reviews"
                hint="When the critic verdict is 'approve', automatically move to the next stage without a human gate."
              >
                <Toggle
                  checked={draft.qualityGates.autoApproveCritic}
                  onChange={v => patch('qualityGates', { autoApproveCritic: v })}
                />
              </FieldRow>
            </div>
          </div>
        )}

        {!loading && draft && tab === 'sprint' && (
          <div className="space-y-5">
            <div>
              <SectionHeader
                title="Team velocity"
                description="Used to calculate sprint estimates in the backlog. Effective velocity = sprint velocity × capacity factor."
              />
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <FieldRow label="Sprint velocity" hint="Total story points your team completes per 2-week sprint at full capacity.">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={draft.sprint.velocity}
                    onChange={e => patch('sprint', { velocity: parseInt(e.target.value, 10) || 1 })}
                    className="w-20 px-2 py-1.5 text-sm text-right border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </FieldRow>
                <FieldRow label="Capacity factor" hint="Proportion of each sprint available for planned features (0.0–1.0). Accounts for BAU, meetings, etc.">
                  <input
                    type="number"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={draft.sprint.capacityFactor}
                    onChange={e => patch('sprint', { capacityFactor: parseFloat(e.target.value) || 0.1 })}
                    className="w-20 px-2 py-1.5 text-sm text-right border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </FieldRow>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 px-1">
                Effective velocity: <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {Math.round(draft.sprint.velocity * draft.sprint.capacityFactor)} pts/sprint
                </span>
              </p>
            </div>

            <div>
              <SectionHeader
                title="AI-assisted development"
                description="When enabled, hour estimates reflect AI coding tool acceleration (e.g. Claude Code). Routine work gets a larger speedup than complex integration work."
              />
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <FieldRow label="AI-assisted estimates" hint="Use AI-adjusted hours-per-point instead of traditional estimates.">
                  <Toggle
                    checked={draft.sprint.aiAssistedEnabled}
                    onChange={v => patch('sprint', { aiAssistedEnabled: v })}
                  />
                </FieldRow>
              </div>
            </div>
          </div>
        )}

        {!loading && draft && tab === 'integrations' && (
          <div>
            <SectionHeader
              title="Slack notifications"
              description="Paste an Incoming Webhook URL to receive a Slack message when a workflow completes or a checkpoint is ready for review."
            />
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Webhook URL</label>
                <input
                  type="url"
                  value={draft.integrations.slackWebhookUrl ?? ''}
                  onChange={e => patch('integrations', { slackWebhookUrl: e.target.value || null })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
                  placeholder="https://hooks.slack.com/services/…"
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                  Create an Incoming Webhook in your Slack workspace. The URL is stored in the database and overrides the <code className="text-amber-500">SLACK_WEBHOOK_URL</code> env var.
                </p>
              </div>
            </div>
          </div>
        )}

        {!loading && draft && tab === 'user' && (
          <div>
            <SectionHeader
              title="User & project"
              description="These values are injected into every agent session. Agents address you by name and tailor output to your project context."
            />
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Your name</label>
                <input
                  type="text"
                  value={draft.user.name}
                  onChange={e => patch('user', { name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Project / product name</label>
                <input
                  type="text"
                  value={draft.user.projectName}
                  onChange={e => patch('user', { projectName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="My Product"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Experience level</label>
                <select
                  value={draft.user.skillLevel}
                  onChange={e => patch('user', { skillLevel: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {SKILL_LEVELS.map(l => (
                    <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Communication language</label>
                <input
                  type="text"
                  value={draft.user.communicationLanguage}
                  onChange={e => patch('user', { communicationLanguage: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="English"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {dirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={closeSettings}
            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving…
              </>
            ) : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
