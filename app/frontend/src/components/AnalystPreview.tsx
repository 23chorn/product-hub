import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSessionStore } from '../stores/sessionStore';
import { useToast } from '../hooks/useToast';

/**
 * Process analyst report markdown to make citations and references clickable:
 * - Converts [N] inline citations to [[N]](url) links using the References section
 * - Converts bare URLs in the References section to clickable markdown links
 */
function processReferenceLinks(content: string): string {
  const refSectionMatch = content.match(/^(##\s+References\s*\n)/im);
  if (!refSectionMatch || refSectionMatch.index === undefined) return content;

  const splitIdx = refSectionMatch.index;
  const body = content.slice(0, splitIdx);
  const refsRest = content.slice(splitIdx);

  // Build map: citation number -> URL from lines like "[1] Title — https://..."
  const refMap: Record<string, string> = {};
  const refLineRegex = /^\[(\d+)\][^\n]*?(https?:\/\/[^\s)]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = refLineRegex.exec(refsRest)) !== null) {
    refMap[m[1]] = m[2];
  }

  if (Object.keys(refMap).length === 0) return content;

  // Replace [N] in body with [[N]](url) for known references
  const processedBody = body.replace(/\[(\d+)\]/g, (full, num) => {
    const url = refMap[num];
    return url ? `[[${num}]](${url})` : full;
  });

  // Make bare URLs in the References section clickable markdown links
  const processedRefs = refsRest.replace(/(https?:\/\/[^\s)]+)/g, (url) => `[${url}](${url})`);

  return processedBody + processedRefs;
}

export function AnalystPreview() {
  const toast = useToast();
  const { analystContent } = useSessionStore();

  const handleCopyMarkdown = async () => {
    if (!analystContent) return;
    try {
      await navigator.clipboard.writeText(analystContent);
      toast.success('Report markdown copied to clipboard!');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    if (!analystContent) return;

    const titleMatch = analystContent.match(/^#\s+(.+)/m);
    const filename = titleMatch
      ? titleMatch[1].replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase() + '.md'
      : 'research-report.md';

    const blob = new Blob([analystContent], { type: 'text/markdown' });
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
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Analysis Preview</h2>
          {analystContent && (
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

      {!analystContent ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-700">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-lg font-medium">Analysis preview will appear here</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Type <span className="font-mono bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-xs">e</span> in chat to export the research report
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose prose-sm prose-blue dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >{processReferenceLinks(analystContent)}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
