import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkflowStore } from '../stores/workflowStore';
import { useModelStore } from '../stores/modelStore';
import { api } from '../services/api';

const STAGE_LABELS: Record<string, string> = {
  analyst:    'Analyst Research',
  pm_prd:     'Product Requirements Document',
  pm_backlog: 'Backlog',
  critic:     'Critic Review',
  curator:    'Context Curation',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function StageChat() {
  const { activeWorkflow, currentStage, currentSessionId, applyWorkflowStatus } = useWorkflowStore();
  const { selectedModelId } = useModelStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load messages and trigger initial agent response when session changes
  useEffect(() => {
    if (!currentSessionId) return;
    if (sessionIdRef.current === currentSessionId) return; // already loaded
    sessionIdRef.current = currentSessionId;
    setMessages([]);
    setInitialised(false);
    setError(null);

    api.getSessionMessages(currentSessionId).then((existing) => {
      const visible = existing
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const lastRole = visible.length > 0 ? visible[visible.length - 1].role : null;

      if (lastRole === 'assistant' || lastRole === 'user') {
        // Session already has messages — show them as-is
        setMessages(visible);
        setInitialised(true);
      } else {
        // Fresh session — brief is in system prompt; auto-trigger the agent's opening questions.
        // We don't add the trigger message to the visible UI state; only the agent's reply shows.
        setInitialised(true);
        triggerAgentOpening(currentSessionId);
      }
    }).catch(() => {
      setInitialised(true);
    });
  }, [currentSessionId]);

  // Sends the opening trigger without showing it in the UI (it's just an instruction
  // for the agent to start Phase 1; not a real user turn the PM needs to see).
  async function triggerAgentOpening(sessionId: string) {
    setIsStreaming(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
    try {
      await api.sendBmadMessage(
        sessionId,
        'Please begin by asking your clarifying questions.',
        (chunk) => {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: 'assistant',
              content: next[next.length - 1].content + chunk,
            };
            return next;
          });
        },
        () => { setIsStreaming(false); },
        (err) => { setIsStreaming(false); setError(err); }
      );
    } catch (err: any) {
      setIsStreaming(false);
      setError(err.message ?? 'Error');
    }
  }

  async function streamAgentResponse(sessionId: string, userMessage: string) {
    setIsStreaming(true);
    setError(null);

    // Add assistant placeholder
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await api.sendBmadMessage(
        sessionId,
        userMessage,
        (chunk) => {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: 'assistant',
              content: next[next.length - 1].content + chunk,
            };
            return next;
          });
        },
        () => { setIsStreaming(false); },
        (err) => { setIsStreaming(false); setError(err); }
      );
    } catch (err: any) {
      setIsStreaming(false);
      setError(err.message ?? 'Error');
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming || !currentSessionId) return;

    const userText = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userText }]);
    await streamAgentResponse(currentSessionId, userText);
  }

  async function handleSubmitForReview() {
    if (!activeWorkflow || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const status = await api.completeStage(activeWorkflow.id);
      applyWorkflowStatus(status);
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? 'Failed to submit for review');
      setIsSubmitting(false);
    }
  }

  if (!currentSessionId || !activeWorkflow) return null;

  const stageLabel = STAGE_LABELS[currentStage ?? ''] ?? currentStage ?? 'Stage';

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stageLabel}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Answer the agent's questions, then submit for review when ready.
          </p>
        </div>
        <button
          onClick={handleSubmitForReview}
          disabled={isStreaming || isSubmitting || messages.length < 2}
          className="ml-3 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
          title="Submit current stage output for checkpoint review"
        >
          {isSubmitting ? 'Submitting…' : 'Submit for Review'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!initialised && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-3">
              <span className="text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading…</span>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content || (isStreaming && i === messages.length - 1 ? '▋' : '')}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming || !initialised}
            placeholder="Type your answer…"
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || !initialised}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
