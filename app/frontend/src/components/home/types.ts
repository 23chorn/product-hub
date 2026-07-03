/** Shared types and status helper for the HomeScreen and its sub-components. */
import type { AirtableItem, AssignedUser, WorkflowInfo } from '@pap/shared';

export type { WorkflowInfo, AssignedUser } from '@pap/shared';
export { effectiveStatus } from '@pap/shared';

export type EnrichedItem = AirtableItem & { source?: string; workflow?: WorkflowInfo; isPaused?: boolean; pausedAt?: number; assignedUsers?: AssignedUser[] };

export type LaunchPhase = 'confirming' | 'launching';
export type StatusFilter = 'all' | 'active' | 'review' | 'done' | 'stopped' | 'new' | 'mine' | 'archived' | 'paused' | 'assigned';
export type WorkflowPreset = 'full' | 'small';

/** A togglable pipeline stage as shown in the launch confirmation modal. */
export interface StageOption {
  key: string;
  label: string;
  short: string;
}

// Primary filters always visible as chips; secondary filters go in the "More filters" dropdown.
export const PRIMARY_FILTER_KEYS: StatusFilter[] = ['all', 'active', 'mine', 'assigned'];

export const STATUS_FILTERS: Array<{ key: StatusFilter; label: string; adminOnly?: boolean }> = [
  { key: 'all',      label: 'All' },
  { key: 'active',   label: 'Running' },
  { key: 'mine',     label: 'Needs my approval' },
  { key: 'assigned', label: 'Assigned to Me' },
  { key: 'review',   label: 'Needs review' },
  { key: 'done',     label: 'Done' },
  { key: 'stopped',  label: 'Stopped' },
  { key: 'new',      label: 'Not started' },
  { key: 'paused',   label: 'Paused', adminOnly: true },
  { key: 'archived', label: 'Archived', adminOnly: true },
];
