import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AppConfig } from '@pap/shared';
import { HomeScreen, resetHomeScreenFilter } from './components/home/HomeScreen';
import { ToastContainer } from './components/toast/ToastContainer';
import { CoordinatorChat } from './components/coordinator';
import { ArtifactViewer } from './components/artifact';
import { SkillManagerPanel } from './components/skill/SkillManagerPanel';
import { DiscoveryScreen } from './components/discovery/DiscoveryScreen';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { QuickTicketPanel } from './components/ticket/QuickTicketPanel';
import { CompletedInitiativesPage } from './components/completed-initiatives/CompletedInitiativesPage';
import { QuickFeaturePanel } from './components/quick-feature/QuickFeaturePanel';
import { PageHeader } from './components/common/PageHeader';
import { PageHeaderTitle } from './components/common/PageHeaderTitle';
import { LoginPage } from './pages/LoginPage';
import { useModelStore } from './stores/modelStore';
import { useSettingsStore } from './stores/settingsStore';
import { useConfigStore } from './stores/configStore';
import { useWorkflowStore } from './stores/workflowStore';
import { usePageNavStore, type PageKey } from './stores/pageNavStore';
import { useAuthStore, ROLE_LABELS, canLaunchWorkflow } from './stores/authStore';
import { api } from './services/api';

type NavTabVisibilityCtx = { canLaunch: boolean; navTabs: AppConfig['features']['navTabs'] | undefined };

// Top-level page nav tabs shown in the header strip below the title.
// Initiatives is always on; the rest are gated by features.navTabs from /api/config
// (see app-config.ts — env-controlled, off in prod by default) on top of any role check.
const NAV_TABS: Array<{ key: PageKey; label: string; visible?: (ctx: NavTabVisibilityCtx) => boolean }> = [
  { key: 'home', label: 'Initiatives' },
  { key: 'completed', label: 'Progress Tracker', visible: ({ navTabs }) => navTabs?.progressTracker ?? true },
  { key: 'discovery', label: 'Discovery', visible: ({ canLaunch, navTabs }) => canLaunch && (navTabs?.discovery ?? false) },
  { key: 'knowledge', label: 'Knowledge Studio', visible: ({ navTabs }) => navTabs?.knowledgeStudio ?? true },
  { key: 'quickFeature', label: 'Quick Feature', visible: ({ canLaunch, navTabs }) => canLaunch && (navTabs?.quickFeature ?? false) },
];

/** Same gating NAV_TABS uses for which buttons render — reused to catch a persisted
 *  `activePage` (see pageNavStore) that's no longer valid for this user/config. */
function isPageVisible(key: PageKey, ctx: NavTabVisibilityCtx): boolean {
  const tab = NAV_TABS.find(t => t.key === key);
  return tab?.visible ? tab.visible(ctx) : true;
}

// Description shown in the shared PageHeader's title slot for whichever tab is active
// (the page name itself is already shown by the active nav tab).
const PAGE_DESCRIPTIONS: Record<PageKey, string> = {
  home: 'Browse, launch, and track initiatives across the pipeline.',
  completed: 'Azure DevOps ticket state for initiatives whose pipeline has finished.',
  discovery: 'Surface opportunities from interviews, reviews, and competitor notes.',
  knowledge: 'Manage project context, behaviour docs, agent personas, output templates, and repo documentation review.',
  quickFeature: 'Describe a small feature and get sprint-ready stories with acceptance criteria, ready to push to ADO.',
};

function DemoToast({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl bg-[#161b22] border border-rose-700/50 shadow-xl text-sm font-mono animate-fade-in">
      <span className="text-rose-400">⚡</span>
      <div>
        <span className="text-rose-300 font-semibold">Full demo started</span>
        <span className="text-surface-400 ml-2 text-xs">"{title}" pipeline running</span>
      </div>
      <button onClick={onDismiss} className="ml-2 text-surface-600 hover:text-surface-400 text-xs">✕</button>
    </div>
  );
}


function App() {
  const { setAvailableModels, setAgentModels } = useModelStore();
  const { isOpen: isSettingsOpen, openSettings, closeSettings, setDemoMode } = useSettingsStore();
  const { activePage, setActivePage } = usePageNavStore();
  const { config, setConfig } = useConfigStore();
  const { activeWorkflow, viewingArtifactId } = useWorkflowStore();
  const { user, realUser, noAuth, loading: authLoading, setUser, setNoAuth, setLoading: setAuthLoading, logout: authLogout, impersonating, impersonate, stopImpersonating } = useAuthStore();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isQTOpen, setIsQTOpen] = useState(false);
  const [demoToast, setDemoToast] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [allUsers, setAllUsers] = useState<import('./stores/authStore').CurrentUser[]>([]);
  const [showUserSwitcher, setShowUserSwitcher] = useState(false);
  const switcherBtnRef = useRef<HTMLButtonElement>(null);

  // Bootstrap auth on mount
  useEffect(() => {
    api.getMe().then(data => {
      if (data.noAuth) {
        setNoAuth(true);
        setShowLogin(false);
      } else if (data.user) {
        setUser(data.user);
        setShowLogin(false);
        if (data.user.is_admin) {
          api.listUsers().then(d => setAllUsers(d.users)).catch(() => {});
        }
      } else {
        setAuthLoading(false);
        setShowLogin(true);
      }
    }).catch(() => {
      setAuthLoading(false);
      setShowLogin(true);
    });
  }, []);

  // Fetch app config, available models, and context status on mount
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
    api.getSettings().then((s: any) => setDemoMode(s.demo?.enabled ?? false)).catch(() => {});
    api.getModels().then(({ models, agentModels }) => {
      setAvailableModels(models);
      if (agentModels) setAgentModels(agentModels);
    }).catch(() => {});

    // Workflow mode is always on — force it and restore any in-progress workflow
    useWorkflowStore.getState().setWorkflowMode(true);

    // Slack notification links land here as ?workflowId=... — open that workflow's
    // preview directly instead of whatever was last open locally.
    const urlParams = new URLSearchParams(window.location.search);
    const deepLinkWorkflowId = urlParams.get('workflowId');
    const deepLinkArtifactId = urlParams.get('artifactId');

    if (deepLinkWorkflowId) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      setActivePage('home');
    }

    const targetWorkflowId = deepLinkWorkflowId || localStorage.getItem('activeWorkflowId');
    if (targetWorkflowId) {
      api.getWorkflowStatus(targetWorkflowId)
        .then((status) => {
          useWorkflowStore.getState().applyWorkflowStatus(status);
          // If artifactId is provided, open that artifact
          if (deepLinkArtifactId) {
            useWorkflowStore.getState().setViewingArtifactId(Number(deepLinkArtifactId));
          }
        })
        .catch(() => {
          if (!deepLinkWorkflowId) localStorage.removeItem('activeWorkflowId');
        });
    }
  }, []);

  // A persisted activePage (see pageNavStore) may no longer be valid for this session —
  // e.g. a different, lower-privilege user, or a feature flag disabled server-side since
  // last visit. Only check once auth and config have both resolved, so the gated tabs
  // (discovery/quickFeature default to hidden pre-config) aren't wrongly bounced to home.
  useEffect(() => {
    if (authLoading || config == null) return;
    if (!isPageVisible(activePage, { canLaunch: canLaunchWorkflow(user, noAuth), navTabs: config.features.navTabs })) {
      setActivePage('home');
    }
  }, [authLoading, config, user, noAuth, activePage, setActivePage]);

  useEffect(() => {
    const onDemoStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail;
      if (detail?.title) setDemoToast(detail.title);
    };
    window.addEventListener('demo-run-started', onDemoStarted);
    return () => window.removeEventListener('demo-run-started', onDemoStarted);
  }, []);

  // Health check polling
  useEffect(() => {
    const checkHealth = async () => {
      const healthy = await api.healthCheck();
      setIsConnected(healthy);
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    try { await api.logout(); } catch { /* */ }
    authLogout();
    resetHomeScreenFilter();
    setActivePage('home');
    setShowLogin(true);
  }

  // Show login page if not yet authenticated
  if (showLogin) {
    return <LoginPage onAuthenticated={() => {
      api.getMe().then(data => {
        if (data.user) {
          setUser(data.user);
          if (data.user.is_admin) {
            api.listUsers().then(d => setAllUsers(d.users)).catch(() => {});
          }
        } else if (data.noAuth) {
          setNoAuth(true);
        }
        setShowLogin(false);
      }).catch(() => {});
    }} />;
  }

  // Brief auth loading spinner (only when we haven't resolved yet and login isn't shown)
  if (authLoading && !noAuth && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface-100 dark:bg-surface-950">
      {/* Toast Notifications */}
      <ToastContainer />

      {/* Header */}
      <header className="bg-white/90 dark:bg-surface-900/80 backdrop-blur-lg border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center justify-between px-6 pt-4 pb-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">
              xCube Flow
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              The Self-Documenting Product & Quality Workflow
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Admin user switcher */}
            {realUser?.is_admin && allUsers.length > 1 && (() => {
              const rect = switcherBtnRef.current?.getBoundingClientRect();
              return (
                <div className="flex items-center gap-1">
                  {impersonating && (
                    <button
                      onClick={stopImpersonating}
                      className="px-2 py-1 text-xs rounded-md bg-amber-500/20 border border-amber-500/50 text-amber-400 hover:bg-amber-500/30 transition-colors"
                      title="Back to your account"
                    >
                      ← Admin
                    </button>
                  )}
                  <button
                    ref={switcherBtnRef}
                    onClick={() => setShowUserSwitcher(v => !v)}
                    title="Switch view to another user (admin testing)"
                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                      impersonating
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-surface-100 dark:bg-surface-800 border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-300 hover:border-surface-400 dark:hover:border-surface-500'
                    }`}
                  >
                    {impersonating ? `Viewing as ${user?.name?.split(' ')[0]}` : 'Switch user'}
                    <span className="ml-1 opacity-60">▾</span>
                  </button>

                  {showUserSwitcher && createPortal(
                    <>
                      <div className="fixed inset-0 z-[9998]" onClick={() => setShowUserSwitcher(false)} />
                      <div
                        className="fixed z-[9999] w-60 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl shadow-2xl overflow-hidden"
                        style={rect ? { top: rect.bottom + 8, right: window.innerWidth - rect.right } : { top: 60, right: 16 }}
                      >
                        <div className="px-3 py-2 border-b border-surface-200 dark:border-surface-700">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">View as user</p>
                        </div>
                        {allUsers.map(u => (
                          <button
                            key={u.id}
                            onClick={() => { impersonate(u); setShowUserSwitcher(false); }}
                            className={`w-full text-left px-3 py-2.5 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors ${user?.id === u.id ? 'bg-surface-100 dark:bg-surface-800/50' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">{u.name}</p>
                                <p className="text-[10px] text-surface-500 dark:text-surface-500 font-mono">@{u.username}</p>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
                                {u.is_admin && <span className="text-[9px] bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-700/50 px-1 py-0.5 rounded">admin</span>}
                                {u.roles.map(r => (
                                  <span key={r} className="text-[9px] bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-700/40 px-1 py-0.5 rounded">{ROLE_LABELS[r] ?? r}</span>
                                ))}
                                {!u.is_admin && u.roles.length === 0 && <span className="text-[9px] text-surface-400 dark:text-surface-600">viewer</span>}
                              </div>
                            </div>
                          </button>
                        ))}
                        {impersonating && (
                          <div className="border-t border-surface-200 dark:border-surface-700">
                            <button
                              onClick={() => { stopImpersonating(); setShowUserSwitcher(false); }}
                              className="w-full text-left px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                            >
                              ← Back to {realUser.name}
                            </button>
                          </div>
                        )}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              );
            })()}

            {/* User badge + settings + logout */}
            <div className="flex items-center gap-2 pl-1">
              {user && (
                <span className="text-xs font-medium text-surface-700 dark:text-surface-300">{user.name}</span>
              )}
              <button
                onClick={openSettings}
                className="p-2 rounded-lg text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
                title="Settings"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              {user && (
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Page nav */}
        <nav className="flex items-center gap-1 px-6">
          {NAV_TABS.filter(tab => isPageVisible(tab.key, { canLaunch: canLaunchWorkflow(user, noAuth), navTabs: config?.features.navTabs })).map(tab => {
            const active = activePage === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActivePage(tab.key)}
                className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
          <PageHeader />
          {/* When an initiative is open, the pipeline view portals its own back
              button/name/status into the title slot instead of this description. */}
          {!(activePage === 'home' && activeWorkflow) && activePage !== 'completed' && (
            <PageHeaderTitle>
              <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{PAGE_DESCRIPTIONS[activePage]}</p>
            </PageHeaderTitle>
          )}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activePage === 'home' && activeWorkflow
              ? <CoordinatorChat />
              : activePage === 'completed'
                ? <CompletedInitiativesPage />
                : activePage === 'discovery'
                  ? <DiscoveryScreen />
                  : activePage === 'knowledge'
                    ? <SkillManagerPanel />
                    : activePage === 'quickFeature'
                      ? <QuickFeaturePanel />
                      : <HomeScreen />}
          </div>
        </main>

        <div className="shrink-0 flex justify-end px-4 py-2 border-t border-surface-200 dark:border-surface-800/60 bg-white/80 dark:bg-surface-950/80 backdrop-blur-sm">
          <div
            className="inline-flex items-center gap-2 text-[11px] font-mono text-surface-500 dark:text-surface-400"
            title={isConnected === null ? 'Checking connection...' : isConnected ? 'Connected' : 'Disconnected'}
          >
            <span className={`block w-2 h-2 rounded-full ${
              isConnected === null ? 'bg-surface-400' : isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`} />
            <span>
              {isConnected === null ? 'checking' : isConnected ? 'connected' : 'disconnected'}
            </span>
          </div>
        </div>

        {/* Settings Modal Overlay */}
        {isSettingsOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center px-4 py-6 bg-black/20 dark:bg-black/40" onClick={closeSettings}>
            <div className="w-full max-w-2xl h-full max-h-[680px] flex flex-col" onClick={e => e.stopPropagation()}>
              <SettingsPanel />
            </div>
          </div>
        )}

        {/* Quick Ticket Modal Overlay */}
        {isQTOpen && (
          <div className="absolute inset-0 z-50 p-3 flex items-start justify-center pt-8">
            <div className="w-full max-w-2xl max-h-[calc(100vh-5rem)] flex flex-col">
              <QuickTicketPanel onClose={() => setIsQTOpen(false)} />
            </div>
          </div>
        )}

      </div>

      {/* Artifact Viewer Drawer */}
      {viewingArtifactId && <ArtifactViewer />}

      {/* Demo toast */}
      {demoToast && <DemoToast title={demoToast} onDismiss={() => setDemoToast(null)} />}
    </div>
  );
}

export default App;
