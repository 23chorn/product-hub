import type { ReactNode } from 'react';

/** Form field label matching the `> label` terminal-prompt convention used on the
 *  sign-in form and initiative/ticket creation panels. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-mono text-surface-500 dark:text-surface-400 mb-1">
      <span className="text-brand-500">&gt;</span> {children}
    </label>
  );
}
