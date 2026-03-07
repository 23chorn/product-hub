import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../services/api';
import { useSessionStore } from '../stores/sessionStore';
import { useModelStore } from '../stores/modelStore';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '../hooks/useToast';
import type { BmadMenuItem } from '@pap/shared';

/**
 * Preprocess markdown from agent responses:
 * - Convert standalone bold lines (e.g. "**Header Text:**") into ### headers
 * - This handles the common LLM pattern of using bold instead of markdown headers
 */
function preprocessMarkdown(content: string): string {
  return content.replace(
    /^(\*\*(.+?)\*\*:?\s*)$/gm,
    (_match, _full, inner) => `### ${inner.replace(/:$/, '')}`
  );
}

/**
 * Process analyst citation links:
 * - Converts [N] inline citations to [[N]](url) links using the References section
 * - Converts bare URLs in the References section to clickable markdown links
 */
function processReferenceLinks(content: string): string {
  const refSectionMatch = content.match(/^(##\s+References\s*\n)/im);
  if (!refSectionMatch || refSectionMatch.index === undefined) return content;

  const splitIdx = refSectionMatch.index;
  const body = content.slice(0, splitIdx);
  const refsRest = content.slice(splitIdx);

  const refMap: Record<string, string> = {};
  const refLineRegex = /^\[(\d+)\][^\n]*?(https?:\/\/[^\s)]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = refLineRegex.exec(refsRest)) !== null) {
    refMap[m[1]] = m[2];
  }

  if (Object.keys(refMap).length === 0) return content;

  const processedBody = body.replace(/\[(\d+)\]/g, (full, num) => {
    const url = refMap[num];
    return url ? `[[${num}]](${url})` : full;
  });

  const processedRefs = refsRest.replace(/(https?:\/\/[^\s)]+)/g, (url) => `[${url}](${url})`);

  return processedBody + processedRefs;
}

/**
 * Strip conversational preamble and postamble from an exported document draft.
 * - Preamble: any text before the first markdown `#` heading
 * - Postamble: trailing lines that are conversational filler rather than document content
 *   (e.g. "Let me know if…", "Feel free to…", "Type 'e'…", "Would you like…")
 */
function cleanDocumentDraft(content: string): string {
  // Strip preamble — everything before the first # heading
  const firstHeading = content.search(/^#{1,6}\s/m);
  const body = firstHeading > 0 ? content.slice(firstHeading) : content;

  // Strip postamble — trailing lines that are conversational filler.
  // Checks the whole line for key signals so patterns like
  // "Chris, you can now type 'e' to export…" are caught regardless of how they start.
  const isPostambleLine = (line: string): boolean => {
    const t = line.trim().toLowerCase();
    if (!t) return true;
    if (/type\s+[`'"]?e[`'"]?/.test(t)) return true;       // "type 'e'", "type `e`"
    if (/press\s+[`'"]?e[`'"]?/.test(t)) return true;      // "press 'e'"
    if (/ready for export/.test(t)) return true;            // "ready for export!"
    if (/complete and ready/.test(t)) return true;          // "complete and ready!"
    if (/^let me know/.test(t)) return true;
    if (/^feel free/.test(t)) return true;
    if (/^would you like/.test(t)) return true;
    if (/^if you('d| would)/.test(t)) return true;
    if (/^any (questions|feedback|changes|adjustments|revisions)/.test(t)) return true;
    if (/^please (let|feel)/.test(t)) return true;
    if (/^i('m| am) here/.test(t)) return true;
    if (/^(happy|glad) to/.test(t)) return true;
    return false;
  };
  const lines = body.split('\n');
  let end = lines.length;
  while (end > 0 && isPostambleLine(lines[end - 1])) {
    end--;
  }

  return lines.slice(0, end).join('\n').trim();
}

const MODE_LABELS: Record<string, string> = {
  prd: 'PRD',
  backlog: 'Backlog',
  analyst: 'Analysis',
  'decision-log': 'Decision Log',
};

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { selectedModelId } = useModelStore();

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = 200;
    const needsScroll = el.scrollHeight > maxH;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
    el.style.overflowY = needsScroll ? 'auto' : 'hidden';
  }, []);

  const toast = useToast();
  const {
    mode,
    selectedItem,
    selectedQuickItem,
    sessionId,
    setSessionId,
    agentInfo,
    setAgentInfo,
    agentMenu,
    setAgentMenu,
    activeWorkflow,
    setActiveWorkflow,
    messages,
    addMessage,
    updateLastMessage,
    setPRDContent,
    setBacklogContent,
    setAnalystContent,
    isStreaming,
    setIsStreaming,
    clearSession,
  } = useSessionStore();

  // Effective itemId for API calls — quick session takes precedence over roadmap item
  const effectiveItemId = selectedItem?.id ?? selectedQuickItem?.id;

  const handleClearSession = async () => {
    // Hard reset: delete on server, then clear local state
    if (sessionId) {
      try {
        await api.resetBmadSession(sessionId);
      } catch (err: any) {
        console.error('Failed to delete session on server:', err);
      }
    }
    clearSession();
    setShowClearConfirm(false);
    toast.info('Session reset. Starting fresh.');
  };

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Reset session when item, quick item, or mode changes (use IDs to avoid object reference churn)
  useEffect(() => {
    clearSession();
  }, [selectedItem?.id, selectedQuickItem?.id, mode]);

  // Load agent info (no session created) when an item or quick session is selected
  useEffect(() => {
    if (mode !== 'context' && effectiveItemId && !sessionId && !agentMenu.length && !isLoading) {
      loadAgentInfo();
    }
  }, [mode, effectiveItemId, sessionId, agentMenu.length]);

  const loadAgentInfo = async () => {
    if (mode === 'context' || !effectiveItemId || isLoading) return;

    try {
      setIsLoading(true);

      const info = await api.getAgentInfo(mode, effectiveItemId);

      setAgentInfo({
        name: info.agentName,
        icon: info.agentIcon,
        title: info.agentTitle,
      });
      setAgentMenu(info.menu);

      // Check if there's an existing session to resume
      if (info.existingSession && info.existingSession.messages.length > 0) {
        setSessionId(info.existingSession.sessionId);

        // Restore all past messages
        for (const msg of info.existingSession.messages) {
          addMessage({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            timestamp: msg.timestamp || Date.now(),
          });
        }

        // Only set active workflow if one was actually started
        if (info.existingSession.activeWorkflow) {
          setActiveWorkflow(info.existingSession.activeWorkflow);
        }

        // Restore preview from latest artifact if available
        if (info.existingSession.latestArtifact) {
          if (mode === 'prd') {
            setPRDContent(info.existingSession.latestArtifact);
          } else if (mode === 'backlog') {
            setBacklogContent(info.existingSession.latestArtifact);
          } else if (mode === 'analyst') {
            setAnalystContent(info.existingSession.latestArtifact);
          }
        }

        setTimeout(() => scrollToBottom(true), 50);
        toast.info('Resumed previous session.');
      } else {
        // New — show greeting message (no session created yet)
        addMessage({
          role: 'assistant',
          content: info.greeting,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load agent info');
      console.error('Error loading agent info:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMenuSelect = async (menuItem: BmadMenuItem) => {
    if (isStreaming) return;

    // If no session yet, create one first
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      try {
        setIsLoading(true);
        const startResponse = await api.startBmadSession(mode, effectiveItemId);
        currentSessionId = startResponse.sessionId;
        setSessionId(currentSessionId);
      } catch (err: any) {
        toast.error(err.message || 'Failed to start session');
        setIsLoading(false);
        return;
      } finally {
        setIsLoading(false);
      }
    }

    // Handle chat mode
    if (menuItem.code === 'CH') {
      setActiveWorkflow('CH');
      addMessage({
        role: 'assistant',
        content: `${agentInfo?.icon || '🤖'} Great, let's chat! Ask me anything about your initiative.`,
        timestamp: Date.now(),
      });
      return;
    }

    setActiveWorkflow(menuItem.code);

    // Add user selection as message
    addMessage({
      role: 'user',
      content: `Start workflow: ${menuItem.label}`,
      timestamp: Date.now(),
    });

    try {
      setIsStreaming(true);
      let accumulatedContent = '';
      let isFirstChunk = true;

      await api.selectMenuItem(
        currentSessionId,
        menuItem.code,
        (content) => {
          accumulatedContent += content;
          if (isFirstChunk) {
            addMessage({
              role: 'assistant',
              content: accumulatedContent,
              timestamp: Date.now(),
            });
            isFirstChunk = false;
          } else {
            updateLastMessage(accumulatedContent);
          }
        },
        () => {
          setIsStreaming(false);
        },
        (errorMsg) => {
          setIsStreaming(false);
          toast.error(errorMsg);
        },
        selectedModelId || undefined
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to start workflow');
      setIsStreaming(false);
    }
  };

  const handleExport = async () => {
    if (!sessionId) return;

    addMessage({ role: 'user', content: 'Export document', timestamp: Date.now() });

    const label = mode === 'prd' ? 'PRD' : mode === 'analyst' ? 'research report' : 'backlog';

    // ── PRD / Analyst: the document was already produced in chat. ──────────────
    // Find the last substantial assistant message (the draft) and use it directly
    // rather than making another expensive API call to regenerate it.
    if (mode !== 'backlog') {
      const draft = [...messages]
        .reverse()
        .find(m => m.role === 'assistant' && m.content.trim().length > 500);

      if (draft) {
        const cleanedDraft = cleanDocumentDraft(draft.content);
        if (mode === 'prd') setPRDContent(cleanedDraft);
        else if (mode === 'analyst') setAnalystContent(cleanedDraft);

        let filePath: string | undefined;
        try {
          const result = await api.exportDocument(sessionId, cleanedDraft);
          filePath = result.filePath;
        } catch (err: any) {
          toast.error(err.message || 'Failed to save export file');
        }

        addMessage({
          role: 'assistant',
          content: `Preview updated with your ${label}${filePath ? ` — saved to \`${filePath}\`` : ''}. Let me know if you'd like any changes.`,
          timestamp: Date.now(),
        });
        return;
      }

      // No substantial draft found — fall through to the API-based path below
      toast.info('No draft found in chat — generating from conversation history.');
    }

    // ── Backlog (or fallback): ask the AI to produce / convert the content. ────
    const exportPrompt = mode === 'backlog'
      ? `Based on our entire conversation, produce the final, complete backlog as a single JSON object matching this exact schema. Output ONLY the raw JSON object — no code fences, no commentary:\n{"epic":{"title":"...","description":"...","businessValue":"...","prdLink":""},"features":[{"title":"...","description":"...","phase":"...","stories":[{"title":"...","persona":"...","goal":"...","benefit":"...","acceptanceCriteria":["..."]}]}]}`
      : mode === 'analyst'
      ? 'Based on our entire conversation, produce the final research report as a single cohesive markdown document. Requirements: (1) Use rich markdown formatting throughout — bullet lists, numbered lists, sub-headings (###), bold key terms, and tables where appropriate. Do not collapse list-like content into dense paragraphs. (2) Let each section be as long as it needs to be; do not pad or truncate artificially. (3) EVERY factual claim, statistic, market figure, and data point must have a [N] inline citation immediately after it — every single one, no exceptions. (4) Re-number all references sequentially from [1] with no gaps or duplicates. (5) End with a COMPLETE ## References section — every [N] used inline must appear here as "[N] Title — https://url". Never omit or truncate this section. Output ONLY the markdown, no commentary or preamble.'
      : 'Based on our entire conversation, produce the final, complete PRD as a single cohesive markdown document. Output ONLY the PRD markdown, no commentary or preamble.';

    try {
      setIsStreaming(true);
      let accumulatedContent = '';

      await api.sendBmadMessage(
        sessionId,
        exportPrompt,
        (content) => { accumulatedContent += content; },
        async () => {
          setIsStreaming(false);

          if (!accumulatedContent.trim()) {
            toast.error('No content generated. Try running a workflow first.');
            return;
          }

          const exportContent = mode === 'backlog'
            ? accumulatedContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
            : cleanDocumentDraft(accumulatedContent);

          if (mode === 'prd') setPRDContent(exportContent);
          else if (mode === 'backlog') setBacklogContent(exportContent);
          else if (mode === 'analyst') setAnalystContent(exportContent);

          let filePath: string | undefined;
          try {
            const result = await api.exportDocument(sessionId!, exportContent);
            filePath = result.filePath;
          } catch (err: any) {
            toast.error(err.message || 'Failed to save export file');
          }

          addMessage({
            role: 'assistant',
            content: `Preview updated with your ${label}${filePath ? ` — saved to \`${filePath}\`` : ''}. Let me know if you'd like any changes.`,
            timestamp: Date.now(),
          });
        },
        (errorMsg) => {
          setIsStreaming(false);
          toast.error(errorMsg);
        },
        true, // skipHistory
        selectedModelId || undefined
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate export');
      setIsStreaming(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || !sessionId || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.overflowY = 'hidden';
    }

    // Intercept export command
    if (/^e(xport)?$/i.test(userMessage)) {
      handleExport();
      return;
    }

    addMessage({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    try {
      setIsStreaming(true);
      let accumulatedContent = '';
      let isFirstChunk = true;

      await api.sendBmadMessage(
        sessionId,
        userMessage,
        (content) => {
          accumulatedContent += content;
          if (isFirstChunk) {
            addMessage({
              role: 'assistant',
              content: accumulatedContent,
              timestamp: Date.now(),
            });
            isFirstChunk = false;
          } else {
            updateLastMessage(accumulatedContent);
          }
        },
        () => {
          setIsStreaming(false);
        },
        (errorMsg) => {
          setIsStreaming(false);
          toast.error(errorMsg);
        },
        undefined, // skipHistory
        selectedModelId || undefined
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
      setIsStreaming(false);
    }
  };

  // Context mode uses its own right-column panel — show idle state here
  if (mode === 'context') {
    return (
      <div className="h-full flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Context Keeper</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Use the panel on the right to check for status changes and review proposed context document updates.
          </p>
        </div>
      </div>
    );
  }

  // No item or quick session selected
  if (!effectiveItemId) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-700">
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
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <p className="text-lg font-medium">Select an initiative</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Choose an item from the left panel to begin</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && !agentMenu.length) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <svg className="animate-spin mx-auto h-8 w-8 text-blue-500 mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading {MODE_LABELS[mode]} agent...</p>
        </div>
      </div>
    );
  }

  // Agent info loaded — show menu + chat
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Restart Session"
        message="This will permanently delete the conversation history for this initiative and mode. You'll start fresh. Are you sure?"
        confirmText="Reset & Start Over"
        cancelText="Keep Current"
        onConfirm={handleClearSession}
        onCancel={() => setShowClearConfirm(false)}
        type="warning"
      />

      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {agentInfo && (
              <span className="text-xl" title={agentInfo.title}>{agentInfo.icon}</span>
            )}
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {agentInfo ? `${agentInfo.name} — ${MODE_LABELS[mode]}` : MODE_LABELS[mode]}: {selectedQuickItem ? selectedQuickItem.title : selectedItem?.initiative}
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {sessionId && <span className="font-mono">{sessionId.slice(0, 8)}</span>}
                {activeWorkflow
                  ? ` · Workflow: ${agentMenu.find(m => m.code === activeWorkflow)?.label || activeWorkflow}`
                  : sessionId ? ` · ${messages.length} messages` : ''}
              </p>
            </div>
          </div>
          {sessionId && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={isStreaming}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
              title="Restart session"
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Restart Session
            </button>
          )}
        </div>
      </div>

      {/* Messages + Menu Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] lg:max-w-3xl rounded-lg px-4 py-3 overflow-hidden ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100'
              }`}
            >
              {message.role === 'assistant' ? (
                <div className="chat-message prose prose-sm dark:prose-invert max-w-none break-words prose-pre:overflow-x-auto prose-pre:max-w-full prose-code:break-all prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-ul:text-gray-700 dark:prose-ul:text-gray-300 prose-ol:text-gray-700 dark:prose-ol:text-gray-300 prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-a:text-blue-600 dark:prose-a:text-blue-400">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" />
                      ),
                    }}
                  >{processReferenceLinks(preprocessMarkdown(message.content))}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Menu cards — show when agent info loaded but no workflow selected yet */}
        {!activeWorkflow && agentMenu.length > 0 && !isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-3xl w-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {agentMenu.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => handleMenuSelect(item)}
                    disabled={isLoading}
                    className="text-left p-3 rounded-lg border-2 border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group disabled:opacity-50"
                  >
                    <div className="flex items-start space-x-2">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold flex-shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/40">
                        {item.code}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{item.label}</p>
                        {item.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{item.description}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-3">
              <div className="flex items-center space-x-3">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {agentInfo?.name || 'AI'} is working...
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form — show once a workflow is active or chat selected */}
      {activeWorkflow && (
        <form onSubmit={handleSubmit} className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-end space-x-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                resizeTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && sessionId && !isStreaming) {
                    handleSubmit(e);
                  }
                }
              }}
              placeholder={`Chat with ${agentInfo?.name || 'the agent'}... (Shift+Enter for new line)`}
              disabled={isStreaming}
              rows={1}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none overflow-hidden leading-normal"
              style={{ maxHeight: '200px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-500 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed font-medium transition-colors flex-shrink-0"
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
