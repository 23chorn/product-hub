/**
 * Extract a clean title from an ADR block heading.
 * Handles: ## [DD-MM-YYYY] Title  or  ## **ADR Draft: Title**  or  ## Title
 */
export function extractAdrTitle(content: string): string {
  // Preferred: ## [date] Title
  const dateMatch = content.match(/^##\s+\[[\d-]+\]\s+(.+)$/m);
  if (dateMatch) return dateMatch[1].trim().replace(/\*\*/g, '');

  // Fallback: ## **anything** or ## anything
  const headingMatch = content.match(/^##\s+\*?\*?(.+?)\*?\*?\s*$/m);
  if (headingMatch) return headingMatch[1].trim();

  return 'Decision';
}

/**
 * Extract only the ADR block from an assistant message.
 * Looks for content between --- delimiters that contains a ## heading.
 * Returns null if no ADR block is found.
 */
export function extractAdrBlock(content: string): string | null {
  // Match between --- delimiters containing any ## heading
  const blockMatch = content.match(/---\s*\n+(##[\s\S]*?)\n+---/);
  if (blockMatch) return blockMatch[1].trim();

  // Fallback: from ## heading to next --- or end of string
  const headingMatch = content.match(/(##[^\n]+\n[\s\S]*?)(?:\n---\s*(?:\n|$)|$)/);
  if (headingMatch) return headingMatch[1].trim();

  return null;
}

/**
 * Format YYYY-MM to display label (e.g. '2026-02' -> 'Feb 2026')
 */
export function formatMonthShort(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
