/** Shared types and status helper for the HomeScreen and its sub-components. */
import type { AirtableItem, WorkflowInfo } from '@pap/shared';

export type { WorkflowInfo } from '@pap/shared';
export { effectiveStatus } from '@pap/shared';

export type EnrichedItem = AirtableItem & { source?: string; workflow?: WorkflowInfo };

export type LaunchPhase = 'confirming' | 'launching';
export type StatusFilter = 'all' | 'active' | 'review' | 'done' | 'stopped' | 'new' | 'mine';
export type WorkflowPreset = 'full' | 'small';

/** A togglable pipeline stage as shown in the launch confirmation modal. */
export interface StageOption {
  key: string;
  label: string;
  short: string;
}

export const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all',    label: 'All' },
  { key: 'mine',   label: 'Needs my approval' },
  { key: 'active', label: 'Running' },
  { key: 'review', label: 'Needs review' },
  { key: 'done',   label: 'Done' },
  { key: 'stopped', label: 'Stopped' },
  { key: 'new',    label: 'Not started' },
];
