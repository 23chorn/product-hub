/**
 * Frontend-only PRD artifact utilities.
 * Structured JSON→markdown converters live in @pap/shared so the backend wiki
 * rendering stays in sync — import renderArtifactMarkdown / isDocumentArtifact
 * from there directly instead of adding wrappers here.
 */

export interface OpenQuestion {
  id: string;
  type: string;
  description: string;
  impact: string;
  owner: string;
}

/**
 * Sanitize literal newlines in JSON string values by replacing them with spaces.
 * Handles cases where the model outputs unescaped line breaks in string fields.
 */
function sanitizeJsonNewlines(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    // Replace literal newlines inside strings with spaces
    if (inString && (ch === '\n' || ch === '\r')) {
      result += ' ';
      continue;
    }

    result += ch;
  }

  return result;
}

/** Parse a raw PRD artifact string into FR and NFR id→text lookup maps for tooltip display. */
export function buildPrdMaps(prdContent: string): { frMap: Record<string, string>; nfrMap: Record<string, string> } {
  const normId = (id: string) => id.replace(/-0*(\d+)$/, '$1');
  try {
    const stripped = prdContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const prd = JSON.parse(stripped);
    const frMap: Record<string, string> = {};
    for (const fr of prd.functional_requirements ?? []) { if (fr.id && fr.requirement) frMap[normId(fr.id)] = fr.requirement; }
    const nfrMap: Record<string, string> = {};
    for (const nfr of prd.non_functional_requirements ?? []) { if (nfr.id && nfr.requirement) nfrMap[normId(nfr.id)] = `[${nfr.category ?? nfr.priority ?? ''}] ${nfr.requirement}`.trim(); }
    return { frMap, nfrMap };
  } catch {
    return { frMap: {}, nfrMap: {} };
  }
}

/**
 * Extract open (unresolved) questions from a PRD artifact.
 * Handles both JSON-structured PRDs and markdown-table PRDs.
 */
export function parseOpenQuestions(content: string): OpenQuestion[] {
  // JSON path
  if (content.trimStart().startsWith('{')) {
    try {
      const sanitized = sanitizeJsonNewlines(content);
      const parsed = JSON.parse(sanitized);
      if (Array.isArray(parsed.open_questions)) {
        return parsed.open_questions
          .filter((q: any) => (q.status ?? 'open').toLowerCase() === 'open')
          .map((q: any) => ({
            id:          String(q.id ?? ''),
            type:        String(q.type ?? 'Question'),
            description: String(q.description ?? ''),
            impact:      String(q.impact ?? ''),
            owner:       String(q.owner ?? ''),
          }));
      }
    } catch {}
    return [];
  }

  // Markdown path — find "Open Questions" section, parse the table
  const sectionMatch = content.match(/##\s+Open Questions[^\n]*\n([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (!sectionMatch) return [];

  const tableLines = sectionMatch[1].split('\n').filter(l => l.trim().startsWith('|'));
  const questions: OpenQuestion[] = [];

  // Skip header (row 0) and separator (row 1)
  for (let i = 2; i < tableLines.length; i++) {
    const cells = tableLines[i]
      .split('|')
      .slice(1, -1)
      .map(c => c.trim());
    if (cells.length < 6) continue;
    const [id, type, description, impact, owner, status] = cells;
    if ((status ?? '').toLowerCase() === 'open') {
      questions.push({ id, type, description, impact, owner });
    }
  }

  return questions;
}
