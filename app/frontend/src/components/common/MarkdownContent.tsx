import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * App-native element styling for rendered markdown. We deliberately do NOT use the
 * `prose` (Tailwind Typography) plugin here: its document-scale sizes, weights and
 * margins read like an article and don't match the compact, hand-styled structured
 * views (QATestsView / BacklogView). Instead every element gets the same surface-/brand-
 * utility classes and `font-sans` (Space Grotesk) the rest of the app uses, so previewers
 * look like part of the app. Defined once at module scope so it isn't rebuilt per render.
 */
const COMPONENTS: Components = {
  h1: ({ node, ...p }) => <h1 className="mt-4 mb-2 first:mt-0 text-base font-bold tracking-tight text-surface-900 dark:text-surface-100" {...p} />,
  h2: ({ node, ...p }) => <h2 className="mt-4 mb-2 first:mt-0 text-sm font-bold tracking-tight text-surface-900 dark:text-surface-100" {...p} />,
  h3: ({ node, ...p }) => <h3 className="mt-3 mb-1.5 first:mt-0 text-sm font-semibold text-surface-800 dark:text-surface-200" {...p} />,
  h4: ({ node, ...p }) => <h4 className="mt-3 mb-1 first:mt-0 text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400" {...p} />,
  p: ({ node, ...p }) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
  a: ({ node, ...p }) => <a className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold text-surface-900 dark:text-surface-100" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  ul: ({ node, ...p }) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
  ol: ({ node, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
  li: ({ node, ...p }) => <li className="marker:text-surface-400 dark:marker:text-surface-500" {...p} />,
  blockquote: ({ node, ...p }) => <blockquote className="my-2 border-l-2 border-surface-300 pl-3 italic text-surface-600 dark:border-surface-600 dark:text-surface-400" {...p} />,
  hr: ({ node, ...p }) => <hr className="my-3 border-surface-200 dark:border-surface-700" {...p} />,
  // Inline code. Block code (inside <pre>) has its inline chrome reset by the `pre` styles below.
  code: ({ node, className, ...p }) => <code className="rounded bg-surface-100 px-1 py-0.5 font-mono text-[0.85em] text-brand-600 dark:bg-surface-800 dark:text-brand-400" {...p} />,
  pre: ({ node, ...p }) => <pre className="my-2 overflow-x-auto rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs leading-relaxed dark:border-surface-700 dark:bg-surface-900 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-surface-700 dark:[&_code]:text-surface-300" {...p} />,
  table: ({ node, ...p }) => <table className="my-2 w-full border-collapse text-xs" {...p} />,
  th: ({ node, ...p }) => <th className="border border-surface-200 bg-surface-50 px-2 py-1 text-left font-semibold text-surface-800 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200" {...p} />,
  td: ({ node, ...p }) => <td className="border border-surface-200 px-2 py-1 text-surface-700 dark:border-surface-700 dark:text-surface-300" {...p} />,
  img: ({ node, ...p }) => <img className="my-2 max-w-full rounded" {...p} />,
};

interface MarkdownContentProps {
  children: string;
  /**
   * Layout-only tweaks (margins, padding, inline, per-element spacing like `[&_p]:my-1`).
   * Typography colour/size/weight is owned by COMPONENTS above so every previewer matches
   * the structured views — don't reintroduce per-site type styling here.
   */
  className?: string;
  /** Base font size. Chat bubbles use 'xs'; document/preview surfaces use 'sm' (default). */
  size?: 'xs' | 'sm';
  /**
   * Treat single newlines as line breaks (remark-breaks). On for chat/notes/editors where
   * authors expect soft wraps; off for authored documents that delimit paragraphs with blank
   * lines.
   */
  breaks?: boolean;
}

/**
 * The one Markdown renderer. Every previewer (PRD, Architecture, knowledge docs, revision
 * summaries, critic questions, chat) renders through this so they share one look.
 */
export function MarkdownContent({ children, className = '', size = 'sm', breaks = false }: MarkdownContentProps) {
  const plugins = breaks ? [remarkGfm, remarkBreaks] : [remarkGfm];
  const base = `font-sans leading-relaxed text-surface-700 dark:text-surface-300 ${size === 'xs' ? 'text-xs' : 'text-sm'}`;
  return (
    <div className={`${base}${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={plugins} components={COMPONENTS}>{children}</ReactMarkdown>
    </div>
  );
}
