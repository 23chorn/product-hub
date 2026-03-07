import ReactMarkdown from 'react-markdown';
import { useSessionStore } from '../stores/sessionStore';
import { useToast } from '../hooks/useToast';

export function PRDPreview() {
  const toast = useToast();
  const { prdContent } = useSessionStore();

  const handleCopyMarkdown = async () => {
    if (!prdContent) return;

    try {
      await navigator.clipboard.writeText(prdContent);
      toast.success('PRD markdown copied to clipboard!');
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    if (!prdContent) return;

    const titleMatch = prdContent.match(/^#\s+(.+)/m);
    const filename = titleMatch
      ? titleMatch[1].replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase() + '.md'
      : 'prd-document.md';

    const blob = new Blob([prdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header with Action Buttons */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">PRD Preview</h2>
          {prdContent && (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopyMarkdown}
                className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center space-x-1.5"
                title="Copy markdown to clipboard"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy</span>
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center space-x-1.5"
                title="Download as .md file"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Markdown Preview or Empty State */}
      {!prdContent ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-700">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-lg font-medium">PRD preview will appear here</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Type <span className="font-mono bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-xs">e</span> in chat to export the generated PRD
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose prose-sm prose-blue dark:prose-invert max-w-none">
            <ReactMarkdown>{prdContent}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
