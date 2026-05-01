import { useState, useEffect, useRef } from 'react';
import { AirtableItemList } from './components/sidebar';
import { DecisionLogPanel } from './components/decision-log';
import { ToastContainer } from './components/ToastContainer';
import { CoordinatorChat } from './components/coordinator';
import { WorkflowStageTracker, WorkflowHistory } from './components/workflow';
import { ArtifactViewer } from './components/artifact';
import { ContextEditorPanel } from './components/ContextEditorPanel';
import { TemplateEditorPanel } from './components/TemplateEditorPanel';
import { useThemeStore } from './stores/themeStore';
import { useModelStore } from './stores/modelStore';
import { useDecisionLogStore } from './stores/decisionLogStore';
import { useContextEditorStore } from './stores/contextEditorStore';
import { useTemplateEditorStore } from './stores/templateEditorStore';
import { useConfigStore } from './stores/configStore';
import { useWorkflowStore } from './stores/workflowStore';
import { api } from './services/api';


function App() {
  const { isDark, toggleTheme } = useThemeStore();
  const { setAvailableModels, setAgentModels } = useModelStore();
  const { isOpen: isDLOpen, openDecisionLog } = useDecisionLogStore();
  const { isOpen: isCEOpen, openContextEditor } = useContextEditorStore();
  const { isOpen: isTEOpen, openTemplateEditor } = useTemplateEditorStore();
  const { setConfig } = useConfigStore();
  const { activeWorkflow, viewingArtifactId } = useWorkflowStore();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const { config } = useConfigStore();
  const showRoadmapSidebar = config?.integrations?.roadmap && config.integrations.roadmap !== 'none';

  // Fetch app config, available models, and context status on mount
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
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

  // Left column width
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('leftColumnWidth');
    return saved ? parseInt(saved) : 280;
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('leftColumnWidth', leftWidth.toString());
  }, [leftWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setLeftWidth(Math.max(200, Math.min(newWidth, containerRect.width - 400)));
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, leftWidth]);

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
            {/* Context Editor Button */}
            <button
              onClick={openContextEditor}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/70 hover:border-slate-400 dark:hover:border-slate-500 transition-colors shadow-sm hover:shadow-glow-teal-sm"
              title="Open Context Editor"
            >
              <span>Context</span>
            </button>

            {/* Template Editor Button */}
            <button
              onClick={openTemplateEditor}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/70 hover:border-slate-400 dark:hover:border-slate-500 transition-colors shadow-sm hover:shadow-glow-teal-sm"
              title="Open Template Editor"
            >
              <span>Templates</span>
            </button>

            {/* Decision Log Button */}
            <button
              onClick={openDecisionLog}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/70 hover:border-slate-400 dark:hover:border-slate-500 transition-colors shadow-sm hover:shadow-glow-teal-sm"
              title="Open Decision Log"
            >
              <span>Decision Log</span>
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

      {/* Main Content - Two Column Layout */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar — stage tracker (active workflow), workflow history (idle), or initiative list */}
        <aside
          style={{ width: `${leftWidth}px` }}
          className="bg-white/90 dark:bg-slate-900/70 backdrop-blur-md border-r border-slate-200 dark:border-slate-700 overflow-y-auto flex-shrink-0"
        >
          {activeWorkflow ? (
            <WorkflowStageTracker />
          ) : showRoadmapSidebar ? (
            <AirtableItemList />
          ) : (
            <WorkflowHistory />
          )}
        </aside>
        <div
          onMouseDown={() => setIsDragging(true)}
          className="w-1 bg-slate-200 dark:bg-slate-700 hover:bg-teal-500 cursor-col-resize flex-shrink-0 transition-colors"
          style={{ cursor: 'col-resize' }}
        />

        {/* Main Column — Coordinator chat (the sole interface) */}
        <main className="flex-1 overflow-hidden min-w-0 relative">
          <CoordinatorChat />
        </main>

        {/* Decision Log Modal Overlay */}
        {isDLOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <DecisionLogPanel />
          </div>
        )}

        {/* Context Editor Modal Overlay */}
        {isCEOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <ContextEditorPanel />
          </div>
        )}

        {/* Template Editor Modal Overlay */}
        {isTEOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <TemplateEditorPanel />
          </div>
        )}

      </div>

      {/* Artifact Viewer Drawer */}
      {viewingArtifactId && <ArtifactViewer />}
    </div>
  );
}

export default App;
