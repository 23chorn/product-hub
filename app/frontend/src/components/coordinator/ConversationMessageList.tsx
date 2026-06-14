import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { type CoordinatorMessage } from '../../stores/workflowStore';
import { STAGE_LABELS } from '../../constants/stage-labels';
import { stripReadyMarker } from '../../utils/coordinator-helpers';

type RenderItem =
  | { kind: 'divider'; stage: string; key: string }
  | { kind: 'msg'; msg: CoordinatorMessage; idx: number };

interface ConversationMessageListProps {
  coordinatorMessages: CoordinatorMessage[];
  isStreaming: boolean;
  getArtifactForStage: (stage: string) => number | null;
  onViewArtifact: (artifactId: number) => void;
}

/**
 * Renders the coordinator conversation as a list of messages, inserting a stage
 * divider before each new stage's first progress event. Handles every message
 * variant: progress ticker, stage-completed milestone, critic verdict, curator
 * reasoning, human bubble, and default coordinator bubble.
 */
export function ConversationMessageList({
  coordinatorMessages,
  isStreaming,
  getArtifactForStage,
  onViewArtifact,
}: ConversationMessageListProps) {
  // Pre-process messages: insert stage dividers before each new stage
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    let lastProgressStage: string | null = null;
    coordinatorMessages.forEach((msg, idx) => {
      if (msg.isProgress && msg.stage && msg.stage !== lastProgressStage) {
        items.push({ kind: 'divider', stage: msg.stage, key: `divider-${msg.stage}-${idx}` });
        lastProgressStage = msg.stage;
      }
      items.push({ kind: 'msg', msg, idx });
    });
    return items;
  }, [coordinatorMessages]);

  return (
    <>
      {renderItems.map(item => {
        // Stage divider
        if (item.kind === 'divider') {
          return (
            <div key={item.key} className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-1">
                {STAGE_LABELS[item.stage] ?? item.stage}
              </span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            </div>
          );
        }

        const { msg, idx } = item;
        const isCoordinator = msg.role === 'coordinator';
        const displayContent = isCoordinator ? stripReadyMarker(msg.content) : msg.content;
        const isLast = idx === coordinatorMessages.length - 1;
        const isEmptyStreaming = isCoordinator && displayContent === '' && isStreaming && isLast;

        // Progress — compact live ticker
        if (msg.isProgress) {
          return (
            <div key={idx} className="flex items-center gap-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 dark:bg-teal-500 animate-pulse flex-shrink-0" />
              {displayContent}
            </div>
          );
        }

        // Stage completed — milestone row
        if (msg.eventType === 'stage_completed') {
          const artifactId = msg.stage ? getArtifactForStage(msg.stage) : null;
          return (
            <div key={idx} className="flex items-center gap-2.5 py-1">
              <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                <svg className="w-2.5 h-2.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex-1">
                {STAGE_LABELS[msg.stage ?? ''] ?? msg.stage ?? 'Stage'} complete
              </span>
              {artifactId && (
                <button
                  onClick={() => onViewArtifact(artifactId)}
                  className="text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:border-teal-300 dark:hover:border-teal-600 transition-colors flex-shrink-0"
                >
                  View →
                </button>
              )}
            </div>
          );
        }

        // Critic verdict — colored left-border card
        if (msg.eventType === 'critic_verdict') {
          const isPass = displayContent.includes('✓');
          return (
            <div key={idx} className={`rounded-r-lg border-l-[3px] px-3 py-2 text-sm ${
              isPass
                ? 'border-green-400 dark:border-green-600 bg-green-50/70 dark:bg-green-900/10'
                : 'border-amber-400 dark:border-amber-600 bg-amber-50/70 dark:bg-amber-900/10'
            }`}>
              <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_li]:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{displayContent}</ReactMarkdown>
              </div>
            </div>
          );
        }

        // Curator context updates — muted info card
        if (msg.eventType === 'curator_reasoning') {
          return (
            <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                Context updates
              </p>
              <div className="prose prose-xs dark:prose-invert max-w-none text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{displayContent}</ReactMarkdown>
              </div>
            </div>
          );
        }

        // Human message
        if (!isCoordinator) {
          return (
            <div key={idx} className="flex justify-end">
              <div className="max-w-[85%] bg-teal-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed">
                <p className="whitespace-pre-wrap">{displayContent}</p>
              </div>
            </div>
          );
        }

        // Default coordinator message
        return (
          <div key={idx} className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm bg-white border border-slate-200 dark:bg-slate-800/60 dark:border-transparent text-slate-900 dark:text-slate-100">
              {isEmptyStreaming ? (
                <span className="text-slate-400 dark:text-slate-500 animate-pulse text-xs">thinking…</span>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{displayContent}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
