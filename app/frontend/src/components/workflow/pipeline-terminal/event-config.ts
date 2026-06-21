/** Event-type → display config and small formatters shared by the terminal rows. */

export const EVENT_CFG: Record<string, { icon: string; color: string; bgColor: string }> = {
  stage_started:       { icon: '▶', color: 'text-brand-600 dark:text-brand-400',    bgColor: 'bg-brand-100 dark:bg-brand-900/30' },
  stage_progress:      { icon: '·', color: 'text-surface-500 dark:text-surface-400',  bgColor: 'bg-surface-100 dark:bg-surface-800/40' },
  stage_completed:     { icon: '✓', color: 'text-green-600 dark:text-green-400',  bgColor: 'bg-green-100 dark:bg-green-900/30' },
  critic_verdict:      { icon: '◎', color: 'text-amber-600 dark:text-amber-400',  bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  checkpoint_created:  { icon: '⏸', color: 'text-amber-600 dark:text-amber-400',  bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  revision_started:    { icon: '↻', color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-100 dark:bg-violet-900/30' },
  human_edit:          { icon: '✎', color: 'text-blue-600 dark:text-blue-400',    bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  cr_created:          { icon: '⊕', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_assessed:         { icon: '◉', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_stage_started:    { icon: '▶', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_stage_completed:  { icon: '✓', color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cr_complete:         { icon: '✓', color: 'text-green-600 dark:text-green-400',    bgColor: 'bg-green-100 dark:bg-green-900/30' },
  curator_reasoning:   { icon: '📝', color: 'text-brand-600 dark:text-brand-300',   bgColor: 'bg-brand-100 dark:bg-brand-900/20' },
  wiki_synced:         { icon: '⬆', color: 'text-blue-600 dark:text-blue-400',    bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  ado_pushed:          { icon: '⬆', color: 'text-blue-600 dark:text-blue-400',    bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  board_synced:        { icon: '⬆', color: 'text-blue-600 dark:text-blue-400',    bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  workflow_started:    { icon: '🚀', color: 'text-brand-600 dark:text-brand-400',   bgColor: 'bg-brand-100 dark:bg-brand-900/30' },
  workflow_complete:   { icon: '✓', color: 'text-green-600 dark:text-green-400',  bgColor: 'bg-green-100 dark:bg-green-900/30' },
  workflow_cancelled:  { icon: '■', color: 'text-red-600 dark:text-red-400',     bgColor: 'bg-red-100 dark:bg-red-900/30' },
};

export function getEventCfg(eventType: string) {
  return EVENT_CFG[eventType] ?? { icon: '●', color: 'text-surface-500', bgColor: 'bg-surface-100 dark:bg-surface-800/30' };
}

export function formatTs(ts: number) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return `${date} ${time}`;
}
