import { useEffect, useState, useCallback } from 'react';
import { api } from '../../services/api';
import { useSettingsStore } from '../../stores/settingsStore';
import { useConfigStore } from '../../stores/configStore';
import { useThemeStore } from '../../stores/themeStore';
import { THEMES, getTheme, type ThemeId } from '../../theme/themes';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../stores/authStore';
import { UserManagementPanel } from './UserManagementPanel';
import { KnowledgeRepoPanel } from './KnowledgeRepoPanel';
import { SwaggerDocsPanel } from './SwaggerDocsPanel';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Settings {
  user: { name: string; projectName: string; skillLevel: string; communicationLanguage: string };
  sprint: { velocity: number; capacityFactor: number; aiAssistedEnabled: boolean };
  pipeline: { enabledStages: Record<string, boolean>; figmaBypassMode: boolean };
  qualityGates: { requireCriticReview: boolean; autoApproveCritic: boolean };
  integrations: { slackWebhookUrl: string | null; slackNotificationsEnabled: boolean };
  demo: { enabled: boolean };
}

const STAGE_LABELS: Record<string, string> = {
  analyst: 'Research Analyst',
  pm_prd: 'Product Manager — PRD',
  prototype: 'Prototype',
  figma_design: 'Figma Design',
  solution_architect: 'Solution Architect',
  api_spec: 'API Contract — Kira',
  epic_feature_planner: 'Epic & Feature Planning',
  story_decomposition: 'Shard - Product Owner',
};

const STAGE_ORDER = [
  'analyst', 'pm_prd', 'prototype', 'figma_design',
  'solution_architect', 'api_spec', 'epic_feature_planner', 'story_decomposition',
];
const ALWAYS_ON = new Set(['curator']);

type Tab = 'general' | 'pipeline' | 'quality' | 'access' | 'knowledgeRepos' | 'swaggerDocs';

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-600'
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
      <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{title}</h3>
      {description && <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{description}</p>}
    </div>
  );
}

// ── Field row ──────────────────────────────────────────────────────────────────

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 dark:border-surface-800 last:border-0">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm text-surface-700 dark:text-surface-300">{label}</p>
        {hint && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const { closeSettings, setDemoMode } = useSettingsStore();
  const { setConfig } = useConfigStore();
  const { theme, setTheme } = useThemeStore();
  const { user, noAuth, loading: authLoading } = useAuthStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
      // Pipeline stage toggles live in the global config store (read by the Home
      // screen's launch modal) — refresh it so a disabled stage stops being
      // offered immediately, without requiring a full page reload.
      api.getConfig().then(setConfig).catch(() => {});
      toast.success('Settings saved');
      closeSettings();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAirtable = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.getItemsPipelineReady();
      // Items are now persisted in the DB — let the Home screen (if mounted) refresh its list.
      window.dispatchEvent(new CustomEvent('refresh-initiatives'));
      toast.success('Synced from Airtable');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to sync from Airtable');
    } finally {
      setSyncing(false);
    }
  };

  const canAccessAdminTabs = noAuth || !!user?.is_admin;

  const ALL_TABS: Array<{ key: Tab; label: string; adminOnly?: boolean }> = [
    { key: 'general',      label: 'General' },
    { key: 'pipeline',     label: 'Pipeline', adminOnly: true },
    { key: 'quality',      label: 'Quality gates', adminOnly: true },
    { key: 'access',       label: 'Access', adminOnly: true },
    { key: 'knowledgeRepos', label: 'Knowledge Repos', adminOnly: true },
    { key: 'swaggerDocs',   label: 'API Docs', adminOnly: true },
  ];
  const TABS = ALL_TABS.filter(t => !t.adminOnly || canAccessAdminTabs);

  useEffect(() => {
    if (!canAccessAdminTabs && tab !== 'general') setTab('general');
  }, [canAccessAdminTabs, tab]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-surface-900 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 flex-shrink-0">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500">Configuration</p>
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100 mt-0.5">Settings</h2>
        </div>
        <button
          onClick={closeSettings}
          className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors p-1 rounded"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200 dark:border-surface-700 flex-shrink-0 bg-white dark:bg-surface-900">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {(loading || authLoading) && (
          <div className="flex items-center justify-center h-32">
            <svg className="w-5 h-5 animate-spin text-surface-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {tab === 'general' && (
          <div>
            <SectionHeader title="Appearance" />
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800">
              <FieldRow label="Theme" hint="Choose a color theme for the app">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 flex-shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                    style={{ backgroundColor: getTheme(theme).swatch }}
                  />
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as ThemeId)}
                    aria-label="Theme"
                    className="text-xs bg-white dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded-md px-2 py-1.5 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {THEMES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </FieldRow>
            </div>

            {canAccessAdminTabs && (
              <div className="mt-5">
                <SectionHeader
                  title="Airtable sync"
                  description="Airtable is the source of truth for initiatives — they aren't created manually in xCube Flow."
                />
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
                  <FieldRow label="Sync now" hint="Fetches initiatives marked Pipeline Ready in Airtable.">
                    <button
                      onClick={handleSyncAirtable}
                      disabled={syncing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/50 hover:bg-surface-50 dark:hover:bg-surface-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {syncing ? 'Syncing…' : 'Sync Airtable'}
                    </button>
                  </FieldRow>
                </div>
              </div>
            )}

            {canAccessAdminTabs && !loading && draft && (
              <div className="mt-5">
                <SectionHeader
                  title="Demo mode"
                  description="When enabled, workflows use static fixture data instead of live LLM calls — useful for testing the pipeline UI and approval flow without API costs."
                />
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
                  <FieldRow label="Demo mode enabled" hint="Auto-launches a sample demo initiative on the Home screen and hides it from pending-approval counts when off.">
                    <Toggle
                      checked={draft.demo.enabled}
                      onChange={v => patch('demo', { enabled: v })}
                    />
                  </FieldRow>
                </div>
              </div>
            )}

            {canAccessAdminTabs && !loading && draft && draft.integrations.slackWebhookUrl && (
              <div className="mt-5">
                <SectionHeader
                  title="Slack notifications"
                  description="Controls whether the app posts checkpoint and completion notifications to the configured Slack webhook."
                />
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
                  <FieldRow label="Notifications enabled" hint="When off, no messages are sent to Slack regardless of checkpoint or workflow events.">
                    <Toggle
                      checked={draft.integrations.slackNotificationsEnabled}
                      onChange={v => patch('integrations', { slackNotificationsEnabled: v })}
                    />
                  </FieldRow>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && draft && tab === 'pipeline' && (
          <div>
            <SectionHeader
              title="Pipeline agents"
              description="Toggle which specialist agents run in each workflow. Curator always runs last and cannot be disabled."
            />
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800">
              {STAGE_ORDER.map(stage => {
                const isAlwaysOn = ALWAYS_ON.has(stage);
                const enabled = draft.pipeline.enabledStages[stage] ?? true;
                return (
                  <div key={stage} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-surface-700 dark:text-surface-300">
                        {STAGE_LABELS[stage] ?? stage}
                      </p>
                      {isAlwaysOn && (
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">Always enabled</p>
                      )}
                    </div>
                    <Toggle
                      checked={isAlwaysOn ? true : enabled}
                      disabled={isAlwaysOn}
                      onChange={v => setDraft(prev => {
                        if (!prev) return prev;
                        const updated = { ...prev, pipeline: { ...prev.pipeline, enabledStages: { ...prev.pipeline.enabledStages, [stage]: v } } };
                        setDirty(JSON.stringify(updated) !== JSON.stringify(settings));
                        return updated;
                      })}
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-5">
              <SectionHeader
                title="Figma design"
                description="Controls how the figma_design stage (Bora) handles Figma itself."
              />
              <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
                <FieldRow
                  label="Figma bypass mode"
                  hint="Bora still generates the screens, design-token, and gap-analysis overview, but skips creating or writing to a Figma file — the reviewer pastes their own Figma link at the checkpoint instead."
                >
                  <Toggle
                    checked={draft.pipeline.figmaBypassMode}
                    onChange={v => patch('pipeline', { figmaBypassMode: v })}
                  />
                </FieldRow>
              </div>
            </div>
          </div>
        )}

        {!loading && draft && tab === 'quality' && (
          <div>
            <SectionHeader
              title="Quality gates"
              description="Control how the inline critic agent reviews and gates specialist output."
            />
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
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

        {tab === 'access' && (
          <div>
            <SectionHeader
              title="Access control"
              description="Manage users, roles, and which role is required to approve each pipeline stage."
            />
            <UserManagementPanel />
          </div>
        )}

        {tab === 'knowledgeRepos' && (
          <div>
            <SectionHeader
              title="Knowledge Repos"
              description="Azure DevOps repos to pull .md files from for Knowledge Studio's Documentation Review section."
            />
            <KnowledgeRepoPanel />
          </div>
        )}

        {tab === 'swaggerDocs' && (
          <div>
            <SectionHeader
              title="API Docs"
              description="Link active Swagger/OpenAPI doc URLs for your existing services. Active docs are injected as current API context into the Solution Architect stage, so new architecture aligns with — and doesn't duplicate — what's already live."
            />
            <SwaggerDocsPanel />
          </div>
        )}

      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 flex-shrink-0">
        <p className="text-xs font-mono text-surface-400 dark:text-surface-500">
          {dirty ? 'unsaved changes' : 'all changes saved'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={closeSettings}
            className="px-3 py-1.5 text-xs font-mono text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
          >
            cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-md bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                saving…
              </>
            ) : 'save →'}
          </button>
        </div>
      </div>
    </div>
  );
}
