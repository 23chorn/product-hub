import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import { useDecisionLogStore } from '../stores/decisionLogStore';
import { useModelStore } from '../stores/modelStore';
import { useThemeStore } from '../stores/themeStore';

/**
 * Extract a clean title from an ADR block heading.
 * Handles: ## [DD-MM-YYYY] Title  or  ## **ADR Draft: Title**  or  ## Title
 */
function extractAdrTitle(content: string): string {
  // Preferred: ## [date] Title
  const dateMatch = content.match(/^##\s+\[[\d-]+\]\s+(.+)$/m);
  if (dateMatch) return dateMatch[1].trim().replace(/\*\*/g, '');

  // Fallback: ## **anything** or ## anything
  const headingMatch = content.match(/^##\s+\*?\*?(.+?)\*?\*?\s*$/m);
  if (headingMatch) return headingMatch[1].trim();

  return 'Decision';
}

/**
 * Extract only the ADR block from an assistant message.
 * Looks for content between --- delimiters that contains a ## heading.
 * Returns null if no ADR block is found.
 */
function extractAdrBlock(content: string): string | null {
  // Match between --- delimiters containing any ## heading
  const blockMatch = content.match(/---\s*\n+(##[\s\S]*?)\n+---/);
  if (blockMatch) return blockMatch[1].trim();

  // Fallback: from ## heading to next --- or end of string
  const headingMatch = content.match(/(##[^\n]+\n[\s\S]*?)(?:\n---\s*(?:\n|$)|$)/);
  if (headingMatch) return headingMatch[1].trim();

  return null;
}

/**
 * Format YYYY-MM to display label (e.g. '2026-02' → 'Feb 2026')
 */
function formatMonthShort(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export function DecisionLogPanel() {
  const {
    sessionId,
    monthId,
    messages,
    isStreaming,
    streamingContent,
    currentMonthLog,
    availableMonths,
    closeDecisionLog,
    setSession,
    addMessage,
    setIsStreaming,
    appendStreamingContent,
    setStreamingContent,
    setCurrentMonthLog,
    setAvailableMonths,
    setSelectedMonth,
  } = useDecisionLogStore();

  const { selectedModelId } = useModelStore();
  const { isDark } = useThemeStore();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);
  const [viewingMonth, setViewingMonth] = useState<string | null>(null); // month log shown in preview

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  // Load session and months on mount
  useEffect(() => {
    if (sessionId) return; // Already loaded
    setIsLoading(true);

    Promise.all([
      api.getDecisionLogSession(),
      api.getDecisionLogMonths(),
    ]).then(([session, monthsData]) => {
      setSession(session.sessionId, session.monthId, session.messages as any);
      setAvailableMonths(monthsData.months);

      // Set the current month as the viewed month in preview
      const currentYearMonth = session.monthId.replace('dl-', '');
      setViewingMonth(currentYearMonth);

      // Load current month's log for preview
      if (session.logExists) {
        api.getDecisionLogFile(currentYearMonth).then(({ content }) => {
          setCurrentMonthLog(content ?? '');
        });
      }
    }).catch(console.error).finally(() => setIsLoading(false));
  }, []);

  const handleMonthSelect = async (yearMonth: string) => {
    setSelectedMonth(yearMonth);
    setViewingMonth(yearMonth);
    const { content } = await api.getDecisionLogFile(yearMonth);
    setCurrentMonthLog(content ?? '');
  };

  // Scan all assistant messages newest-first and return the most recent ADR block found.
  const findLatestAdrBlock = (): string | null => {
    for (const msg of [...messages].reverse()) {
      if (msg.role !== 'assistant') continue;
      const block = extractAdrBlock(msg.content);
      if (block) return block;
    }
    return null;
  };

  // Returns true if a recent ADR draft was found and logged successfully.
  const logLastAdr = async (): Promise<boolean> => {
    const adrBlock = findLatestAdrBlock();
    if (!adrBlock) return false;

    const title = extractAdrTitle(adrBlock);
    await api.logDecision(adrBlock, title);

    const [monthsData, currentYearMonth] = await Promise.all([
      api.getDecisionLogMonths(),
      Promise.resolve(monthId?.replace('dl-', '') ?? ''),
    ]);
    setAvailableMonths(monthsData.months);

    if (currentYearMonth) {
      setViewingMonth(currentYearMonth);
      const { content } = await api.getDecisionLogFile(currentYearMonth);
      setCurrentMonthLog(content ?? '');
    }

    setLogSuccess(`"${title}" logged successfully.`);
    setTimeout(() => setLogSuccess(null), 4000);
    return true;
  };

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || !sessionId || isStreaming) return;

    // Intercept /log command
    if (trimmed === '/log') {
      try { await logLastAdr(); } catch (err) { console.error('Failed to log decision:', err); }
      setInput('');
      return;
    }

    // Intercept affirmative replies when an ADR draft is pending
    const lower = trimmed.toLowerCase();
    const isApproval = ['yes', 'y', 'approve', 'approved', 'looks good', 'log it',
      'save it', 'confirm', 'ok', 'okay', 'go ahead', 'correct', 'perfect'].includes(lower);
    if (isApproval) {
      try {
        const logged = await logLastAdr();
        if (logged) { setInput(''); return; }
        // No ADR draft found — fall through and send normally
      } catch (err) {
        console.error('Failed to log decision:', err);
      }
    }

    // Regular message
    const userMsg = { role: 'user' as const, content: trimmed, timestamp: Date.now() };
    addMessage(userMsg);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    // Optimistically add placeholder for assistant response
    addMessage({ role: 'assistant', content: '', timestamp: Date.now() });

    let accumulated = '';

    try {
      await api.sendDecisionLogMessage(
        sessionId,
        trimmed,
        (chunk) => {
          accumulated += chunk;
          appendStreamingContent(chunk);
        },
        () => {
          setIsStreaming(false);
          // Replace the empty placeholder with the full response
          useDecisionLogStore.getState().updateLastMessage(accumulated || streamingContent);
          setStreamingContent('');
        },
        (err) => {
          setIsStreaming(false);
          console.error('DL streaming error:', err);
          setStreamingContent('');
        },
        selectedModelId ?? undefined
      );
    } catch (err) {
      setIsStreaming(false);
      setStreamingContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const currentYearMonth = monthId?.replace('dl-', '') ?? '';
  const currentMonthLabel = availableMonths.find(m => m.month === currentYearMonth)?.label
    ?? (monthId ? monthId.replace('dl-', '') : 'Current Month');

  return (
    <div className={`h-full flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 dark:ring-white/10 ${isDark ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">📝</span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Decision Log</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{currentMonthLabel}</p>
          </div>
        </div>
        <button
          onClick={closeDecisionLog}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Close Decision Log"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* Three-column body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Month Navigation */}
        <aside className="w-48 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Month</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Loading...</div>
            )}
            {/* Current month always first */}
            {!isLoading && (
              <button
                onClick={() => handleMonthSelect(currentYearMonth)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  viewingMonth === currentYearMonth
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <span className="block">{currentMonthLabel}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">Current</span>
              </button>
            )}
            {/* Past months */}
            {availableMonths
              .filter(m => m.month !== currentYearMonth)
              .map(m => (
                <button
                  key={m.month}
                  onClick={() => handleMonthSelect(m.month)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    viewingMonth === m.month
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {formatMonthShort(m.month)}
                </button>
              ))}
          </div>
        </aside>

        {/* Middle: Chat with Dex */}
        <main className="flex-1 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Chat header */}
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
            <div className="flex items-center space-x-2">
              <span className="text-lg">📝</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">Dex — Decision Logger</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Describe a decision and I'll structure it as an ADR. Type <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/log</code> to save the last draft.
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {isLoading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-400 dark:text-gray-500">Loading session...</div>
              </div>
            )}

            {!isLoading && messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-400 dark:text-gray-500 max-w-sm">
                  <span className="text-4xl block mb-3">📝</span>
                  <p className="font-medium text-gray-600 dark:text-gray-300">Hi, I'm Dex</p>
                  <p className="text-sm mt-1">Describe a decision you've made and I'll structure it as a formal ADR entry for the log.</p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              const isLastAssistant = !isUser && i === messages.length - 1;
              const content = isLastAssistant && isStreaming ? streamingContent : msg.content;

              if (!content && isStreaming && isLastAssistant) {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
                      <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    </div>
                  </div>
                );
              }
              if (!content) return null;

              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-4 py-3 ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {isUser ? (
                      <p className="text-sm whitespace-pre-wrap">{content}</p>
                    ) : (
                      <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Log success notification */}
            {logSuccess && (
              <div className="flex justify-center">
                <div className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm px-4 py-2 rounded-full">
                  ✓ {logSuccess}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex-shrink-0">
            <div className="flex space-x-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  resizeTextarea();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Describe a decision, or type /log to save the last draft..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
                disabled={isStreaming || !sessionId}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || isStreaming || !sessionId}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                Send
              </button>
            </div>
          </div>
        </main>

        {/* Right: Decision Log Preview */}
        <aside className="w-80 bg-white dark:bg-gray-800 flex flex-col flex-shrink-0 overflow-hidden">
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              {viewingMonth ? formatMonthShort(viewingMonth) : 'Log'} — Decisions
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {currentMonthLog ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                <ReactMarkdown>{currentMonthLog}</ReactMarkdown>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center text-gray-400 dark:text-gray-500">
                <div>
                  <p className="text-sm">No decisions logged</p>
                  <p className="text-xs mt-1">
                    {viewingMonth === currentYearMonth
                      ? 'Chat with Dex and type /log to add entries'
                      : 'No entries for this month'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
