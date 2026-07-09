import { useState, useEffect } from 'react';

interface VersionData {
  version: string;
  buildTime: string;
  git?: {
    commitShort: string;
    branch: string;
    tag?: string | null;
    isDirty: boolean;
  };
}

/** Version badge shown in bottom-right corner. Click to see full details. */
export function VersionInfo() {
  const [version, setVersion] = useState<VersionData | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetch('/version.json')
      .then(r => r.json())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  if (!version) return null;

  const versionLabel = version.git?.tag || version.version;
  const commitLabel = version.git?.commitShort || 'unknown';

  return (
    <>
      <button
        onClick={() => setShowDetails(true)}
        className="fixed bottom-4 right-4 px-2 py-1 text-[10px] bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 rounded border border-surface-200 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors z-50"
        title="Click for version details"
      >
        v{versionLabel} ({commitLabel})
      </button>

      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 px-4" onClick={() => setShowDetails(false)}>
          <div className="bg-surface-50 dark:bg-surface-800 rounded-lg shadow-xl border border-surface-200 dark:border-surface-700 p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Version Info</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-surface-500 dark:text-surface-400">Version:</span>
                <span className="ml-2 font-mono text-surface-900 dark:text-surface-100">{version.version}</span>
              </div>

              {version.git && (
                <>
                  <div>
                    <span className="text-surface-500 dark:text-surface-400">Commit:</span>
                    <span className="ml-2 font-mono text-surface-900 dark:text-surface-100">
                      {version.git.commitShort}
                      {version.git.isDirty && <span className="ml-1 text-amber-600 dark:text-amber-400">(dirty)</span>}
                    </span>
                  </div>

                  <div>
                    <span className="text-surface-500 dark:text-surface-400">Branch:</span>
                    <span className="ml-2 font-mono text-surface-900 dark:text-surface-100">{version.git.branch}</span>
                  </div>

                  {version.git.tag && (
                    <div>
                      <span className="text-surface-500 dark:text-surface-400">Tag:</span>
                      <span className="ml-2 font-mono text-surface-900 dark:text-surface-100">{version.git.tag}</span>
                    </div>
                  )}
                </>
              )}

              <div>
                <span className="text-surface-500 dark:text-surface-400">Build Time:</span>
                <span className="ml-2 font-mono text-surface-900 dark:text-surface-100 text-xs">
                  {new Date(version.buildTime).toLocaleString()}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowDetails(false)}
              className="mt-6 w-full py-2 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
