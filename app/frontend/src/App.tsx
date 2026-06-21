import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { HomeScreen, resetHomeScreenFilter } from './components/home/HomeScreen';
import { DecisionLogPanel } from './components/decision-log';
import { ToastContainer } from './components/toast/ToastContainer';
import { CoordinatorChat } from './components/coordinator';
import { ArtifactViewer } from './components/artifact';
import { SkillManagerPanel } from './components/skill/SkillManagerPanel';
import { DiscoveryScreen } from './components/discovery/DiscoveryScreen';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { QuickTicketPanel } from './components/ticket/QuickTicketPanel';
import { StatsDashboardPanel } from './components/stats/StatsDashboardPanel';
import { LoginPage } from './pages/LoginPage';
import { useModelStore } from './stores/modelStore';
import { useDecisionLogStore } from './stores/decisionLogStore';
import { useSkillManagerStore } from './stores/skillManagerStore';
import { useDiscoveryStore } from './stores/discoveryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useConfigStore } from './stores/configStore';
import { useWorkflowStore } from './stores/workflowStore';
import { useStatsStore } from './stores/statsStore';
import { useAuthStore, ROLE_LABELS, canViewStats } from './stores/authStore';
import { api } from './services/api';

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
  const { isOpen: isDLOpen } = useDecisionLogStore();
  const { isOpen: isSMOpen, openSkillManager } = useSkillManagerStore();
  const { isOpen: isDiscoveryOpen, openDiscovery } = useDiscoveryStore();
  const { isOpen: isSettingsOpen, openSettings, closeSettings, setDemoMode } = useSettingsStore();
  const { isOpen: isStatsOpen, openStats } = useStatsStore();
  const { setConfig } = useConfigStore();
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
    const savedId = localStorage.getItem('activeWorkflowId');
    if (savedId) {
      api.getWorkflowStatus(savedId)
        .then((status) => {
          useWorkflowStore.getState().applyWorkflowStatus(status);
        })
        .catch(() => localStorage.removeItem('activeWorkflowId'));
    }
  }, []);

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
      <header className="bg-white/90 dark:bg-surface-900/80 backdrop-blur-lg border-b border-surface-200 dark:border-surface-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">
              Product Hub
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
              Chief of Staff-driven product workflow
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Discovery Button */}
            <button
              onClick={openDiscovery}
              className="flex items-center px-3 py-1.5 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/50 hover:bg-surface-50 dark:hover:bg-surface-700/70 hover:border-surface-400 dark:hover:border-surface-500 transition-colors shadow-sm"
              title="Open Discovery"
            >
              Discovery
            </button>

            {/* Agent Studio Button */}
            <button
              onClick={openSkillManager}
              className="flex items-center px-3 py-1.5 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/50 hover:bg-surface-50 dark:hover:bg-surface-700/70 hover:border-surface-400 dark:hover:border-surface-500 transition-colors shadow-sm"
              title="Open Agent Studio"
            >
              Studio
            </button>

            {/* Stats Dashboard Button */}
            {canViewStats(user, noAuth) && (
              <button
                onClick={openStats}
                className="flex items-center px-3 py-1.5 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/50 hover:bg-surface-50 dark:hover:bg-surface-700/70 hover:border-surface-400 dark:hover:border-surface-500 transition-colors shadow-sm"
                title="Open Stats Dashboard"
              >
                Stats
              </button>
            )}

            {/* Settings Button */}
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

            {/* User badge + logout */}
            {user && (
              <div className="flex items-center gap-2 pl-1">
                <span className="text-xs font-medium text-surface-700 dark:text-surface-300">{user.name}</span>
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <main className="flex-1 overflow-hidden min-w-0 relative">
          {activeWorkflow
            ? <CoordinatorChat />
            : <HomeScreen />}
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

        {/* Decision Log Modal Overlay */}
        {isDLOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <DecisionLogPanel />
          </div>
        )}

        {/* Agent Studio Modal Overlay */}
        {isSMOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <SkillManagerPanel />
          </div>
        )}

        {/* Discovery Modal Overlay */}
        {isDiscoveryOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <DiscoveryScreen />
          </div>
        )}

        {/* Stats Dashboard Modal Overlay */}
        {isStatsOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <StatsDashboardPanel />
          </div>
        )}

        {/* Settings Modal Overlay */}
        {isSettingsOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center px-4 py-6 bg-black/20 dark:bg-black/40" onClick={closeSettings}>
            <div className="w-full max-w-lg h-full max-h-[680px] flex flex-col" onClick={e => e.stopPropagation()}>
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
