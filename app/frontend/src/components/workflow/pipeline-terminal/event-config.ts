/** Event-type → display config and small formatters shared by the terminal rows. */

export const EVENT_CFG: Record<string, { icon: string; color: string; bgColor: string }> = {
  stage_started:       { icon: '▶', color: 'text-brand-700 dark:text-brand-500',    bgColor: 'bg-brand-50 dark:bg-brand-900/20' },
  stage_progress:      { icon: '·', color: 'text-surface-500 dark:text-surface-400',  bgColor: 'bg-surface-100 dark:bg-surface-800/40' },
  stage_completed:     { icon: '✓', color: 'text-green-700 dark:text-green-500',  bgColor: 'bg-green-50 dark:bg-green-900/20' },
  critic_verdict:      { icon: '◎', color: 'text-lime-700 dark:text-lime-500',  bgColor: 'bg-lime-50 dark:bg-lime-900/20' },
  checkpoint_created:  { icon: '⏸', color: 'text-amber-700 dark:text-amber-500',  bgColor: 'bg-amber-50 dark:bg-amber-900/20' },
  revision_started:    { icon: '↻', color: 'text-rose-700 dark:text-rose-500', bgColor: 'bg-rose-50 dark:bg-rose-900/20' },
  human_edit:          { icon: '✎', color: 'text-blue-700 dark:text-blue-500',    bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  cr_created:          { icon: '⊕', color: 'text-cyan-700 dark:text-cyan-500', bgColor: 'bg-cyan-50 dark:bg-cyan-900/20' },
  cr_assessed:         { icon: '◉', color: 'text-cyan-700 dark:text-cyan-500', bgColor: 'bg-cyan-50 dark:bg-cyan-900/20' },
  cr_stage_started:    { icon: '▶', color: 'text-cyan-700 dark:text-cyan-500', bgColor: 'bg-cyan-50 dark:bg-cyan-900/20' },
  cr_stage_completed:  { icon: '✓', color: 'text-cyan-700 dark:text-cyan-500', bgColor: 'bg-cyan-50 dark:bg-cyan-900/20' },
  cr_complete:         { icon: '✓', color: 'text-green-700 dark:text-green-500',    bgColor: 'bg-green-50 dark:bg-green-900/20' },
  curator_reasoning:   { icon: '📝', color: 'text-brand-700 dark:text-brand-400',   bgColor: 'bg-brand-50 dark:bg-brand-900/10' },
  wiki_synced:         { icon: '⬆', color: 'text-blue-700 dark:text-blue-500',    bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  ado_pushed:          { icon: '⬆', color: 'text-blue-700 dark:text-blue-500',    bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  board_synced:        { icon: '⬆', color: 'text-blue-700 dark:text-blue-500',    bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  workflow_started:    { icon: '🚀', color: 'text-brand-700 dark:text-brand-500',   bgColor: 'bg-brand-50 dark:bg-brand-900/20' },
  workflow_complete:   { icon: '✓', color: 'text-green-700 dark:text-green-500',  bgColor: 'bg-green-50 dark:bg-green-900/20' },
  workflow_cancelled:  { icon: '■', color: 'text-red-700 dark:text-red-500',     bgColor: 'bg-red-50 dark:bg-red-900/20' },
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
