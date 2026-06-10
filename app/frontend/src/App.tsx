import { useState, useEffect, useCallback } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { DecisionLogPanel } from './components/decision-log';
import { ToastContainer } from './components/ToastContainer';
import { CoordinatorChat } from './components/coordinator';
import { ArtifactViewer } from './components/artifact';
import { SkillManagerPanel } from './components/SkillManagerPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { QuickTicketPanel } from './components/QuickTicketPanel';
import { ClaudeCodeStudio } from './components/ClaudeCodeStudio';
import { useThemeStore } from './stores/themeStore';
import { useModelStore } from './stores/modelStore';
import { useDecisionLogStore } from './stores/decisionLogStore';
import { useSkillManagerStore } from './stores/skillManagerStore';
import { useSettingsStore } from './stores/settingsStore';
import { useConfigStore } from './stores/configStore';
import { useWorkflowStore } from './stores/workflowStore';
import { useSessionStore } from './stores/sessionStore';
import { useToast } from './hooks/useToast';
import { api } from './services/api';
import type { AirtableItem } from '@pap/shared';

function DemoToast({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl bg-[#161b22] border border-violet-700/50 shadow-xl text-sm font-mono animate-fade-in">
      <span className="text-violet-400">⚡</span>
      <div>
        <span className="text-violet-300 font-semibold">Full demo started</span>
        <span className="text-slate-400 ml-2 text-xs">"{title}" pipeline running</span>
      </div>
      <button onClick={onDismiss} className="ml-2 text-slate-600 hover:text-slate-400 text-xs">✕</button>
    </div>
  );
}


function App() {
  const { isDark, toggleTheme } = useThemeStore();
  const { setAvailableModels, setAgentModels } = useModelStore();
  const { isOpen: isDLOpen, openDecisionLog } = useDecisionLogStore();
  const { isOpen: isSMOpen, openSkillManager } = useSkillManagerStore();
  const { isOpen: isSettingsOpen, isDemoMode, openSettings, closeSettings, setDemoMode } = useSettingsStore();
  const { setConfig } = useConfigStore();
  const { activeWorkflow, viewingArtifactId, resetWorkflow, applyWorkflowStatus, addCoordinatorMessage } = useWorkflowStore();
  const { setSelectedItem, clearSession } = useSessionStore();
  const toast = useToast();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isQTOpen, setIsQTOpen] = useState(false);
  const [isCodeStudioOpen, setIsCodeStudioOpen] = useState(false);
  const [isDemoFiring, setIsDemoFiring] = useState(false);
  const [demoToast, setDemoToast] = useState<string | null>(null);
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
    } else {
      // No active workflow — check for an in-progress pre-workflow planning session
      const planningSessionId = localStorage.getItem('coordinatorPlanningSessionId');
      if (planningSessionId) {
        api.getCoordinatorSession(planningSessionId).then((session) => {
          if (!session) { localStorage.removeItem('coordinatorPlanningSessionId'); return; }
          const store = useWorkflowStore.getState();
          store.setPlanningSessionId(planningSessionId);
          store.setPlanningPhase('gathering');
          // Restore conversation: skip first user msg (goal injection), map rest to display format
          const msgs = session.messages.slice(1).map((m: { role: string; content: string }) => ({
            role: m.role === 'user' ? 'human' as const : 'coordinator' as const,
            content: m.content,
            timestamp: Date.now(),
          }));
          store.clearCoordinatorMessages();
          msgs.forEach((m: { role: 'coordinator' | 'human'; content: string; timestamp: number }) => store.addCoordinatorMessage(m));
        }).catch(() => localStorage.removeItem('coordinatorPlanningSessionId'));
      }
    }
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


  const handleFullDemo = useCallback(async () => {
    if (isDemoFiring) return;
    setIsDemoFiring(true);
    try {
      const result = await api.triggerDemoWebhook(0);
      window.dispatchEvent(new CustomEvent('refresh-initiatives'));
      try {
        const status = await api.getWorkflowStatus(result.workflowId);
        const newItem = {
          id: result.itemId,
          initiative: result.initiative,
          description: '',
          status: 'In Progress' as const,
          businessValue: 0,
          priorityScore: 0,
          estimate: 'M' as const,
          confidence: 0,
          workflow: { id: result.workflowId, status: status.workflow.status, currentStage: status.currentStage, summary: null },
        } as AirtableItem & { workflow: any };
        setSelectedItem(newItem);
        clearSession();
        resetWorkflow();
        applyWorkflowStatus(status);
        addCoordinatorMessage({
          role: 'coordinator',
          content: `Full demo pipeline started for **${result.initiative}**. Running all stages — research, PRD, architecture, backlog, prototype, QA, and tech refinement. Code generation follows automatically.`,
          timestamp: Date.now(),
        });
      } catch { /* navigation failed — toast still shows */ }
      setDemoToast(result.initiative);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Demo trigger failed');
    } finally {
      setIsDemoFiring(false);
    }
  }, [isDemoFiring, setSelectedItem, clearSession, resetWorkflow, applyWorkflowStatus, addCoordinatorMessage, toast]);

  return (
    <div className="h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Toast Notifications */}
      <ToastContainer />

      {/* Header */}
      <header className="bg-white/90 dark:bg-slate-900/80 backdrop-blur-lg border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Product Hub
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Chief of Staff-driven product workflow
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {/* Full Demo Button — only shown when demo mode is enabled */}
            {isDemoMode && (
              <button
                onClick={handleFullDemo}
                disabled={isDemoFiring}
                title="Full demo: runs the complete AI pipeline (research → PRD → architecture → backlog → prototype → QA → tech refinement), then writes code to the demo project via headless Claude CLI"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 bg-white dark:bg-slate-800/50 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {isDemoFiring ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : <span>⚡</span>}
                Demo
              </button>
            )}

            {/* Settings Button */}
            <button
              onClick={openSettings}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* Agent Studio Button */}
            <button
              onClick={openSkillManager}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/70 hover:border-slate-400 dark:hover:border-slate-500 transition-colors shadow-sm hover:shadow-glow-teal-sm"
              title="Open Agent Studio"
            >
              <span>Studio</span>
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* Connection Status */}
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
              isConnected === null
                ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                : isConnected
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
            }`}>
              <span className={`w-2 h-2 rounded-full mr-2 ${
                isConnected === null
                  ? 'bg-slate-400'
                  : isConnected
                  ? 'bg-green-500 animate-pulse'
                  : 'bg-red-500'
              }`}></span>
              {isConnected === null ? 'Checking...' : isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 overflow-hidden min-w-0 relative">
          {activeWorkflow
            ? <CoordinatorChat onOpenCodeStudio={() => setIsCodeStudioOpen(true)} />
            : <HomeScreen />}
        </main>

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

        {/* AI Code Studio Overlay */}
        {isCodeStudioOpen && activeWorkflow && (
          <ClaudeCodeStudio
            workflowId={activeWorkflow.id}
            onClose={() => setIsCodeStudioOpen(false)}
          />
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
