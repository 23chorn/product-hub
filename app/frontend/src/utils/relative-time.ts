/** Absolute local-time label for a nullable epoch-ms timestamp — 'never' when unset. */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

/** "3h ago" / "2d ago" — coarse, since the dashboard only needs a sense of staleness. */
export function relativeTime(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
