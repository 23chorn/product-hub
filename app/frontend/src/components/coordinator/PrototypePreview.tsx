import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { api } from '../../services/api';

export interface PrototypeData {
  title: string;
  description: string;
  screens: string[];
  entryScreen: string;
  files: Record<string, string>;
  /** Which platform this was generated for — fixes the preview frame (no switcher). */
  platform?: 'web' | 'mobile';
}

type DeviceFrame = 'mobile' | 'desktop';

const DEVICE_SIZES: Record<DeviceFrame, { width: string; height: string; label: string }> = {
  mobile:  { width: '375px',  height: '812px',  label: 'Mobile' },
  desktop: { width: '1280px', height: '800px',  label: 'Desktop' },
};

interface DesignSystem {
  tokens: string;
  utilities: string;
}

/**
 * Build a self-contained HTML document that renders the prototype files using
 * React 18 UMD + Babel Standalone (JSX transpilation in the browser).
 * No external sandbox service required.
 */
function buildSrcdoc(
  files: Record<string, string>,
  _entryScreen: string,
  designSystem: DesignSystem,
): string {
  // Combine CSS: tokens + utilities + any styles.css from the prototype
  const existingStyles = files['/styles.css'] ?? files['styles.css'] ?? '';
  const combinedCss = [
    designSystem.tokens,
    designSystem.utilities,
    existingStyles
      .replace(/@import\s+['"]\.\/design-tokens\.css['"];?\s*/g, '')
      .replace(/@import\s+['"]\.\/design-system-utilities\.css['"];?\s*/g, '')
      .trim(),
  ].filter(Boolean).join('\n\n');

  // Collect all .ts/.tsx files, sorted so dependencies come before App.tsx
  // Order: data/* → types/* → utils/* → components/* → screens/* → App.tsx
  const fileOrder = (p: string): number => {
    if (p.includes('/data/'))       return 0;
    if (p.includes('/types'))       return 1;
    if (p.includes('/utils'))       return 2;
    if (p.includes('/components/')) return 3;
    if (p.includes('/screens/'))    return 4;
    if (p === '/App.tsx' || p === 'App.tsx') return 6;
    return 5;
  };

  const tsxFiles: Array<[string, string]> = Object.entries(files)
    .filter(([p]) => p.endsWith('.tsx') || p.endsWith('.ts'))
    .map(([p, code]): [string, string] => [p.startsWith('/') ? p : `/${p}`, code])
    .sort(([a], [b]) => fileOrder(a) - fileOrder(b));

  // Strip imports/exports so all files share a single flat scope.
  const moduleCode = tsxFiles
    .map(([filePath, code]) => {
      const stripped = code
        // Remove all imports — React/hooks are injected via preamble, components share flat scope
        .replace(/^import\s+type\s+.*\n?/gm, '')
        .replace(/^import\s+.*\s+from\s+['"][^'"]*['"]\s*;?\s*\n?/gm, '')
        .replace(/^import\s+['"][^'"]*['"]\s*;?\s*\n?/gm, '')
        // export default function/class → keep the declaration, bind name
        .replace(/^export\s+default\s+(function|class)\s+(\w+)/gm, '$1 $2')
        // export default <expression> → assign to variable
        .replace(/^export\s+default\s+/m, 'const __defaultExport__ = ')
        // Remove export prefix from named declarations
        .replace(/^export\s+(const|let|function|class|type|interface|enum)\s+/gm, '$1 ')
        // Remove re-export / barrel export lines
        .replace(/^export\s+\{[^}]*\}\s*(?:from\s+['"][^'"]*['"])?\s*;?\s*$/gm, '')
        // Convert top-level bindings to var — prevents redeclaration errors when
        // multiple files declare the same identifier in the concatenated flat scope.
        // var redeclarations are silently ignored; last assignment wins.
        .replace(/^const /gm, 'var ')
        .replace(/^let /gm, 'var ')
        .replace(/^function (\w+)/gm, 'var $1 = function')
        .replace(/^async function (\w+)/gm, 'var $1 = async function');
      return `// ── ${filePath} ──\n${stripped}`;
    })
    .join('\n\n');

  // Embed source as a JS string literal using JSON.stringify.
  // Replace </ with <\/ so the HTML parser doesn't see </script> and close the tag.
  // In JS string literals \/ === / so no runtime decoding is needed.
  const embeddedSource = JSON.stringify(moduleCode).replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Prototype</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js" crossorigin="anonymous"></script>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; }
body { font-family: 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif; }
${combinedCss}
</style>
</head>
<body>
<div id="root"></div>
<div id="err" style="display:none;position:fixed;inset:0;background:#0f0f1a;color:#ff6b6b;font-family:monospace;font-size:12px;padding:20px;overflow:auto;z-index:9999;white-space:pre-wrap;line-height:1.5;"></div>
<script>
(function () {
  function showErr(label, msg) {
    document.getElementById('root').style.display = 'none';
    var el = document.getElementById('err');
    el.style.display = 'block';
    el.textContent = label + '\\n\\n' + msg;
  }

  window.onerror = function (msg, _src, line, col, err) {
    showErr('Runtime error', err ? err.stack : (msg + ' (line ' + line + ':' + col + ')'));
    return true;
  };

  window.addEventListener('unhandledrejection', function (e) {
    showErr('Unhandled promise rejection', e.reason ? (e.reason.stack || String(e.reason)) : 'Unknown');
  });

  // Source is embedded directly as a JSON-encoded string — no DOM element needed.
  var raw = ${embeddedSource};

  // Inject React hooks + auto-mount into shared scope alongside the component code.
  var preamble = 'var { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, useId, createContext, forwardRef } = React;';
  var mountSuffix = [
    '',
    'var __rootEl = document.getElementById("root");',
    'if (typeof App !== "undefined" && __rootEl) {',
    '  ReactDOM.createRoot(__rootEl).render(React.createElement(App));',
    '}',
  ].join('\\n');

  var compiled;
  try {
    compiled = Babel.transform(preamble + '\\n' + raw + mountSuffix, {
      presets: ['react', 'typescript'],
      filename: 'prototype.tsx',
    }).code;
  } catch (e) {
    showErr('Compile error', e.message || String(e));
    return;
  }

  try {
    // eslint-disable-next-line no-eval
    (0, eval)(compiled);
  } catch (e) {
    showErr('Runtime error', e.stack || e.message || String(e));
  }
})();
</script>
</body>
</html>`;
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
  // Fixed frame based on what platform this prototype was actually generated for —
  // no switcher, since a mobile-shaped layout (bottom tab bar, 44px touch targets)
  // doesn't make sense viewed in a desktop frame and vice versa.
  const device: DeviceFrame = prototype.platform === 'web' ? 'desktop' : 'mobile';
  const [showCode, setShowCode] = useState(false);
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [revisionStatus, setRevisionStatus] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState('/App.tsx');
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRevisionStatus(`Error: ${msg}`);
      setIsRevising(false);
    }
  };

  useEffect(() => {
    api.getDesignSystem().then(ds => {
      if (ds) setDesignSystem({ tokens: ds.tokens, utilities: ds.utilities });
    });
  }, []);

  const srcdoc = useMemo(() => {
    if (!designSystem) return '';
    return buildSrcdoc(prototype.files, prototype.entryScreen, designSystem);
  }, [prototype.files, prototype.entryScreen, designSystem]);

  const tsxFiles = Object.keys(prototype.files).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));

  if (!designSystem) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-100 dark:bg-surface-900">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-surface-300 dark:border-surface-600 border-t-surface-700 dark:border-t-white rounded-full mx-auto mb-3" />
          <p className="text-sm text-surface-500 dark:text-surface-400">Loading design system...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-surface-100 dark:bg-surface-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">{prototype.title}</h2>
          <span className="text-xs text-surface-500 dark:text-surface-400">{prototype.description}</span>
          <span className="text-xs text-surface-400 dark:text-surface-500">
            {prototype.screens.length} screen{prototype.screens.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Platform indicator — fixed, not a switcher (this prototype was only built for one platform) */}
          <span className="px-2.5 py-1 text-xs rounded-md bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
            {DEVICE_SIZES[device].label}
          </span>

          {/* Code toggle */}
          <button
            onClick={() => setShowCode(!showCode)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              showCode
                ? 'bg-brand-600 text-white'
                : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:text-surface-800 dark:hover:text-white'
            }`}
          >
            {showCode ? 'Hide Code' : 'Show Code'}
          </button>

          <button onClick={onClose} className="p-1.5 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Code panel */}
        {showCode && (
          <div className="flex flex-col w-1/2 border-r border-surface-200 dark:border-surface-700">
            <div className="flex gap-0 overflow-x-auto border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 flex-shrink-0">
              {tsxFiles.map(f => (
                <button
                  key={f}
                  onClick={() => setSelectedFile(f)}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap border-r border-surface-200 dark:border-surface-700 transition-colors ${
                    selectedFile === f
                      ? 'bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-white'
                      : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-750'
                  }`}
                >
                  {f.split('/').pop()}
                </button>
              ))}
            </div>
            <pre className="flex-1 overflow-auto text-xs text-surface-700 dark:text-surface-300 bg-surface-50 dark:bg-surface-950 p-4 m-0">
              <code>{prototype.files[selectedFile] ?? prototype.files[selectedFile.replace(/^\//, '')] ?? ''}</code>
            </pre>
          </div>
        )}

        {/* Preview — keep dark for device frame contrast */}
        <div className={`flex items-center justify-center bg-surface-800 dark:bg-surface-900 p-6 overflow-hidden min-h-0 ${showCode ? 'w-1/2' : 'flex-1'}`}>
          <div
            className="relative transition-all duration-200 rounded-[2rem] border-[8px] border-surface-600 dark:border-surface-700 shadow-2xl bg-white overflow-hidden"
            style={{
              width: deviceSize.width,
              height: deviceSize.height,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            {device === 'mobile' && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-surface-600 dark:bg-surface-700 rounded-b-2xl z-10 pointer-events-none" />
            )}
            <iframe
              key={srcdoc}
              srcDoc={srcdoc}
              title="Prototype Preview"
              sandbox="allow-scripts"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
          </div>
        </div>
      </div>

      {/* Revision bar */}
      <div className="flex-shrink-0 px-4 py-2.5 bg-surface-50 dark:bg-surface-800 border-t border-surface-200 dark:border-surface-700">
        {revisionStatus && (
          <p className={`text-xs mb-1.5 ${revisionStatus.startsWith('Error') ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {revisionStatus}
          </p>
        )}
        <form onSubmit={(e) => { e.preventDefault(); handleRevise(); }} className="flex items-end gap-2">
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
            className="flex-1 resize-none rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={!feedback.trim() || isRevising}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-sm font-medium rounded-lg transition-colors self-end flex-shrink-0"
          >
            {isRevising ? 'Revising...' : 'Revise'}
          </button>
        </form>
      </div>
    </div>
  );
}
