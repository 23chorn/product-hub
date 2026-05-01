import * as fs from 'fs';
import db from '../data/database';

// ── Section extraction ───────────────────────────────────────────────────────

/**
 * Extract the body of a top-level `## Heading` section from PRD markdown.
 * Returns everything between that heading and the next `##` heading, trimmed.
 */
export function extractPrdSection(content: string, heading: string): string {
  const lines = content.split('\n');
  let collecting = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (collecting) break;
      if (line.replace(/^##\s+/, '').trim().toLowerCase() === heading.toLowerCase()) {
        collecting = true;
      }
      continue;
    }
    if (collecting) out.push(line);
  }
  return out.join('\n').trim();
}

// ── Markdown → ADO HTML ──────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(text: string): string {
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

/**
 * Convert a PRD markdown section body into ADO-compatible HTML.
 * Handles paragraphs, bullet/numbered lists, tables, and ### sub-headings.
 */
export function markdownToAdoHtml(markdown: string): string {
  if (!markdown.trim()) return '';

  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;
  let inTable = false;
  let tableHasHeader = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  const closeTable = () => {
    if (inTable) { out.push('</table>'); inTable = false; tableHasHeader = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Table separator row (|---|---| or |:---|:---|) → marks end of header
    if (/^\|[\s|:-]+\|$/.test(line) && !/[^|\s:|=-]/.test(line)) {
      if (inTable) tableHasHeader = true;
      continue;
    }

    // Table data row
    if (line.startsWith('|') && line.endsWith('|')) {
      closeList();
      if (!inTable) { out.push('<table>'); inTable = true; }
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (!tableHasHeader) {
        out.push(`<tr>${cells.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr>`);
      } else {
        out.push(`<tr>${cells.map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`);
      }
      continue;
    }

    closeTable();

    // ### sub-heading
    if (/^###\s+/.test(line)) {
      closeList();
      out.push(`<b>${esc(line.replace(/^###\s+/, ''))}</b><br>`);
      continue;
    }

    // Bullet list item
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    // Numbered list item
    if (/^\d+\.\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    closeList();

    // Horizontal rule — skip
    if (/^---+$/.test(line.trim())) continue;

    // Empty line — skip (tables/lists already provide spacing via HTML structure)
    if (!line.trim()) continue;

    // Regular paragraph
    out.push(`<p>${inlineMd(line)}</p>`);
  }

  closeList();
  closeTable();

  return out.join('');
}

// ── Selective section filtering ──────────────────────────────────────────────

/** Normalise a functional-requirement ID for comparison. "FR-01" → "FR1", "FR1" → "FR1". */
function normalizeFrId(id: string): string {
  const m = id.match(/^(FR)-?0*(\d+)$/i);
  return m ? `${m[1].toUpperCase()}${parseInt(m[2], 10)}` : id.toUpperCase();
}

/**
 * Filter a Functional Requirements markdown table to only the rows whose IDs
 * appear in `frIds`. Header row is always included.
 * Falls back to the full section when `frIds` is empty or no rows match.
 */
export function filterFrSection(frSection: string, frIds: Set<string>): string {
  if (!frIds.size) return frSection;

  const normalizedIds = new Set([...frIds].map(normalizeFrId));
  const lines = frSection.split('\n');
  const header: string[] = [];
  const matched: string[] = [];
  let headerDone = false;

  for (const line of lines) {
    // Separator row
    if (/^\|[\s|:-]+\|$/.test(line) && !/[^|\s:|=-]/.test(line)) {
      header.push(line);
      headerDone = true;
      continue;
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      if (!headerDone) {
        header.push(line);
      } else {
        const firstCell = line.slice(1, -1).split('|')[0].trim();
        // First cell may be "FR1" or just a raw number "1"
        const candidate = /^FR/i.test(firstCell) ? firstCell : `FR${firstCell}`;
        if (normalizedIds.has(normalizeFrId(candidate))) {
          matched.push(line);
        }
      }
      continue;
    }

    if (!headerDone) header.push(line); // pre-table prose
  }

  return matched.length > 0 ? [...header, ...matched].join('\n') : frSection;
}

/**
 * Extract only the `### Journey N: Name` sub-sections that are referenced by
 * the provided journey name strings (e.g. "Onboarding · Step 3 — First login").
 * The part before `·` is used as the match key.
 * Falls back to the full section when `journeyRefs` is empty or no match found.
 */
export function filterJourneySection(journeySection: string, journeyRefs: Set<string>): string {
  if (!journeyRefs.size) return journeySection;

  const matchKeys = new Set(
    [...journeyRefs].map(r => r.split('·')[0].trim().toLowerCase())
  );

  const lines = journeySection.split('\n');
  const matched: string[][] = [];
  let currentBlock: string[] = [];
  let blockMatches = false;

  const saveBlock = () => {
    if (blockMatches && currentBlock.length) matched.push([...currentBlock]);
  };

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      saveBlock();
      currentBlock = [line];
      // Match: "### Journey 1: Onboarding" → extract "Onboarding"
      const name = line.replace(/^###\s+/, '').replace(/^Journey\s+\d+:\s+/i, '').toLowerCase();
      blockMatches = [...matchKeys].some(k => name.includes(k));
    } else {
      currentBlock.push(line);
    }
  }
  saveBlock();

  return matched.length > 0
    ? matched.map(b => b.join('\n')).join('\n\n')
    : journeySection;
}

// ── Artifact loading ─────────────────────────────────────────────────────────

/** Load the latest PRD artifact content for a workflow item. Returns '' if absent. */
export function loadPrdForItem(itemId: string): string {
  const row = db.prepare<[string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'prd'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  if (!row?.file_path) return '';
  try {
    return fs.readFileSync(row.file_path, 'utf-8');
  } catch {
    return '';
  }
}

// ── Top-level enrichment builders ────────────────────────────────────────────

/**
 * Build the HTML block to append to an epic description.
 * Includes: Problem Statement, Success Metrics, Out of Scope.
 */
export function buildEpicEnrichment(prdContent: string): string {
  const sections: Array<[string, string]> = [
    ['Problem Statement', 'Problem Statement'],
    ['Success Metrics', 'Success Metrics'],
    ['Out of Scope', 'Out of Scope'],
  ];

  let html = '';
  for (const [heading, label] of sections) {
    const body = extractPrdSection(prdContent, heading);
    if (body) html += `<h4>${label}</h4>${markdownToAdoHtml(body)}`;
  }
  return html;
}

/**
 * Build the HTML block to append to a feature description.
 * Includes the FR rows referenced by this feature's stories, and the relevant
 * Key User Journey sub-sections.
 *
 * @param prdContent - full PRD markdown
 * @param frIds      - FR IDs from story prdRef.functionalRequirements (e.g. "FR-01")
 * @param journeyRefs - journey strings from story prdRef.userJourney (e.g. "Onboarding · Step 3")
 */
export function buildFeatureEnrichment(
  prdContent: string,
  frIds: Set<string>,
  journeyRefs: Set<string>
): string {
  let html = '';

  const frSection = extractPrdSection(prdContent, 'Functional Requirements');
  if (frSection) {
    const filtered = filterFrSection(frSection, frIds);
    if (filtered) html += `<h4>Functional Requirements</h4>${markdownToAdoHtml(filtered)}`;
  }

  const journeySection = extractPrdSection(prdContent, 'Key User Journeys');
  if (journeySection) {
    const filtered = filterJourneySection(journeySection, journeyRefs);
    if (filtered) html += `<h4>Key User Journeys</h4>${markdownToAdoHtml(filtered)}`;
  }

  return html;
}
