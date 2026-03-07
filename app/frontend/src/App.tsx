import { useState, useEffect, useRef } from 'react';
import { AirtableItemList } from './components/AirtableItemList';
import { DecisionLogPanel } from './components/DecisionLogPanel';
import { ToastContainer } from './components/ToastContainer';
import { ModelSelector } from './components/ModelSelector';
import { CoordinatorChat } from './components/CoordinatorChat';
import { WorkflowStageTracker } from './components/WorkflowStageTracker';
import { CheckpointPanel } from './components/CheckpointPanel';
import { useThemeStore } from './stores/themeStore';
import { useModelStore } from './stores/modelStore';
import { useDecisionLogStore } from './stores/decisionLogStore';
import { useConfigStore } from './stores/configStore';
import { useWorkflowStore } from './stores/workflowStore';
import { api } from './services/api';


function App() {
  const { isDark, toggleTheme } = useThemeStore();
  const { setAvailableModels } = useModelStore();
  const { isOpen: isDLOpen, openDecisionLog } = useDecisionLogStore();
  const { setConfig } = useConfigStore();
  const { activeWorkflow } = useWorkflowStore();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  // Fetch app config, available models, and context status on mount
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
    api.getModels().then(({ models }) => setAvailableModels(models)).catch(() => {});

    // Workflow mode is always on — force it and restore any in-progress workflow
    useWorkflowStore.getState().setWorkflowMode(true);
    const savedId = localStorage.getItem('activeWorkflowId');
    if (savedId) {
      api.getWorkflowStatus(savedId)
        .then((status) => useWorkflowStore.getState().applyWorkflowStatus(status))
        .catch(() => localStorage.removeItem('activeWorkflowId'));
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

  // Column widths (in pixels)
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem('leftColumnWidth');
    return saved ? parseInt(saved) : 320;
  });
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem('rightColumnWidth');
    return saved ? parseInt(saved) : 384;
  });

  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save to localStorage when widths change
  useEffect(() => {
    localStorage.setItem('leftColumnWidth', leftWidth.toString());
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem('rightColumnWidth', rightWidth.toString());
  }, [rightWidth]);

  // Handle mouse move for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;

      if (isDraggingLeft) {
        const newWidth = e.clientX - containerRect.left;
        const minWidth = 200;
        const maxWidth = containerWidth - rightWidth - 100;
        setLeftWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
      } else if (isDraggingRight) {
        const newWidth = containerRect.right - e.clientX;
        const minWidth = 200;
        const maxWidth = containerWidth - leftWidth - 100;
        setRightWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
    };

    if (isDraggingLeft || isDraggingRight) {
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
  }, [isDraggingLeft, isDraggingRight, leftWidth, rightWidth]);

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* Toast Notifications */}
      <ToastContainer />

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Product Automation Pipeline
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Coordinator-driven product workflow
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {/* Decision Log Button */}
            <button
              onClick={openDecisionLog}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-colors shadow-sm"
              title="Open Decision Log"
            >
              <span>📝</span>
              <span>Decision Log</span>
            </button>

            {/* Model Selector */}
            <ModelSelector />

            {/* Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                : isConnected
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
            }`}>
              <span className={`w-2 h-2 rounded-full mr-2 ${
                isConnected === null
                  ? 'bg-gray-400'
                  : isConnected
                  ? 'bg-green-500 animate-pulse'
                  : 'bg-red-500'
              }`}></span>
              {isConnected === null ? 'Checking...' : isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content - Three Column Layout */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar — initiative list or stage tracker */}
        <aside
          style={{ width: `${leftWidth}px` }}
          className="bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto flex-shrink-0"
        >
          {activeWorkflow ? <WorkflowStageTracker /> : <AirtableItemList />}
        </aside>
        <div
          onMouseDown={() => setIsDraggingLeft(true)}
          className="w-1 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors"
          style={{ cursor: 'col-resize' }}
        />

        {/* Middle Column — always the Coordinator chat */}
        <main className="flex-1 border-r border-gray-200 dark:border-gray-700 overflow-hidden min-w-0 relative">
          <CoordinatorChat />
        </main>

        {/* Right Resize Handle */}
        <div
          onMouseDown={() => setIsDraggingRight(true)}
          className="w-1 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors"
          style={{ cursor: 'col-resize' }}
        />

        {/* Right Sidebar — checkpoint review + artifact viewer */}
        <aside
          style={{ width: `${rightWidth}px` }}
          className="bg-white dark:bg-gray-800 overflow-hidden flex-shrink-0"
        >
          {activeWorkflow?.status === 'paused_at_checkpoint'
            ? <CheckpointPanel />
            : <div className="p-4 text-xs text-gray-400 dark:text-gray-600">
                {activeWorkflow ? 'Agent output will appear here at each checkpoint.' : 'Start a workflow to see stage outputs here.'}
              </div>
          }
        </aside>

        {/* Decision Log Modal Overlay */}
        {isDLOpen && (
          <div className="absolute inset-0 z-50 p-3">
            <DecisionLogPanel />
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
