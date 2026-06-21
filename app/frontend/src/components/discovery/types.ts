import type { DiscoverySourceType } from '@pap/shared';

export const SOURCE_TYPE_LABELS: Record<DiscoverySourceType, string> = {
  user_interview: 'User Interview',
  app_store_review: 'App Store Review',
  play_store_review: 'Play Store Review',
  competitor_note: 'Competitor Note',
  other: 'Other',
};

export const SOURCE_TYPE_OPTIONS: DiscoverySourceType[] = [
  'user_interview',
  'app_store_review',
  'play_store_review',
  'competitor_note',
  'other',
];
