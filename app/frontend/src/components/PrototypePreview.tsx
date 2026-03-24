import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
} from '@codesandbox/sandpack-react';
import { api } from '../services/api';

export interface PrototypeData {
  title: string;
  description: string;
  screens: string[];
  entryScreen: string;
  files: Record<string, string>;
}

type DeviceFrame = 'tablet' | 'mobile';

const DEVICE_SIZES: Record<DeviceFrame, { width: string; height: string; label: string }> = {
  tablet: { width: '768px', height: '1024px', label: 'Tablet' },
  mobile: { width: '375px', height: '812px', label: 'Mobile' },
};

interface DesignSystem {
  tokens: string;
  utilities: string;
}

export function PrototypePreview({
  prototype,
  workflowId,
  onClose,
  onUpdate,
}: {
  prototype: PrototypeData;
  workflowId: string;
  onClose: () => void;
  onUpdate: (updated: PrototypeData) => void;
}) {
  const [device, setDevice] = useState<DeviceFrame>('mobile');
  const [showCode, setShowCode] = useState(false);
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [revisionStatus, setRevisionStatus] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const deviceSize = DEVICE_SIZES[device];

  const autoResize = useCallback(() => {
    const el = feedbackRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const handleRevise = async () => {
    if (!feedback.trim() || isRevising) return;
    setIsRevising(true);
    setRevisionStatus('Revising prototype...');
    try {
      await api.revisePrototype(workflowId, prototype, feedback.trim(), {
        onContent: () => {},
        onPrototype: (updated) => {
          onUpdate(updated);
          setRevisionStatus('Prototype updated');
          setTimeout(() => setRevisionStatus(null), 2000);
        },
        onError: (err) => setRevisionStatus(`Error: ${err}`),
        onDone: () => {
          setIsRevising(false);
          setFeedback('');
        },
      });
    } catch (err: any) {
      setRevisionStatus(`Error: ${err.message}`);
      setIsRevising(false);
    }
  };

  // Fetch design system on mount
  useEffect(() => {
    api.getDesignSystem().then(ds => {
      if (ds) setDesignSystem({ tokens: ds.tokens, utilities: ds.utilities });
    });
  }, []);

  // Build Sandpack files with design system injected
  const sandpackFiles = useMemo(() => {
    if (!designSystem) return {};

    const files: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(prototype.files)) {
      const key = filePath.startsWith('/') ? filePath : `/${filePath}`;
      files[key] = content;
    }

    // Inject design system CSS files
    files['/design-tokens.css'] = designSystem.tokens;
    files['/design-system-utilities.css'] = designSystem.utilities;

    // Build /styles.css that imports both design tokens and utilities
    const existingStyles = files['/styles.css'] ?? '';
    const imports = [
      '@import "./design-tokens.css";',
      '@import "./design-system-utilities.css";',
    ].join('\n');
    // Strip any existing design-tokens import to avoid duplication
    const cleaned = existingStyles
      .replace(/@import\s+["']\.\/design-tokens\.css["'];?\s*/g, '')
      .replace(/@import\s+["']\.\/design-system-utilities\.css["'];?\s*/g, '')
      .trim();
    files['/styles.css'] = imports + (cleaned ? '\n' + cleaned : '');

    return files;
  }, [prototype.files, designSystem]);

  // Don't render Sandpack until we have the design system
  if (!designSystem) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-gray-600 border-t-white rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading design system...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gray-900">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">{prototype.title}</h2>
          <span className="text-xs text-gray-400">{prototype.description}</span>
          <span className="text-xs text-gray-500">
            {prototype.screens.length} screen{prototype.screens.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Device frame toggle */}
          <div className="flex items-center bg-gray-700 rounded-lg p-0.5">
            {(Object.keys(DEVICE_SIZES) as DeviceFrame[]).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  device === d
                    ? 'bg-gray-500 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {DEVICE_SIZES[d].label}
              </button>
            ))}
          </div>

          {/* Toggle code editor */}
          <button
            onClick={() => setShowCode(!showCode)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              showCode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:text-white'
            }`}
          >
            {showCode ? 'Hide Code' : 'Show Code'}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sandpack area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SandpackProvider
          template="react-ts"
          files={sandpackFiles}
          customSetup={{
            dependencies: {
              'react': '^18.0.0',
              'react-dom': '^18.0.0',
            },
          }}
          options={{
            activeFile: '/App.tsx',
            visibleFiles: Object.keys(sandpackFiles).filter(f => f.endsWith('.tsx')),
            externalResources: [
              'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
            ],
          }}
          theme="dark"
        >
          <SandpackLayout style={{ height: '100%', border: 'none', borderRadius: 0 }}>
            {/* Code editor — shown on demand */}
            {showCode && (
              <SandpackCodeEditor
                style={{ flex: '1 1 50%', height: '100%' }}
                showLineNumbers
                showTabs
                wrapContent
              />
            )}

            {/* Preview area with device frame */}
            <div
              className="flex-1 flex items-center justify-center bg-gray-900 overflow-auto"
              style={{ height: '100%' }}
            >
              <div
                className="relative transition-all duration-200 rounded-[2rem] border-[8px] border-gray-700 shadow-2xl bg-white overflow-hidden"
                style={{
                  width: deviceSize.width,
                  height: deviceSize.height,
                  maxWidth: '100%',
                  maxHeight: '100%',
                }}
              >
                {/* Phone notch for mobile */}
                {device === 'mobile' && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-700 rounded-b-2xl z-10" />
                )}
                <SandpackPreview
                  style={{
                    width: '100%',
                    height: '100%',
                  }}
                  showNavigator={false}
                  showRefreshButton
                />
              </div>
            </div>
          </SandpackLayout>
        </SandpackProvider>
      </div>

      {/* Revision feedback bar */}
      <div className="flex-shrink-0 px-4 py-2.5 bg-gray-800 border-t border-gray-700">
        {revisionStatus && (
          <p className={`text-xs mb-1.5 ${revisionStatus.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
            {revisionStatus}
          </p>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); handleRevise(); }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={feedbackRef}
            value={feedback}
            onChange={(e) => { setFeedback(e.target.value); autoResize(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRevise(); }
            }}
            placeholder="Describe changes... (e.g. make the buttons larger, add a back button to the transfer screen)"
            rows={1}
            disabled={isRevising}
            className="flex-1 resize-none rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={!feedback.trim() || isRevising}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors self-end flex-shrink-0"
          >
            {isRevising ? 'Revising...' : 'Revise'}
          </button>
        </form>
      </div>
    </div>
  );
}
