/**
 * In-app (display) rendering of structured JSON artifacts to markdown. The converters
 * themselves live in @pap/shared so the backend's wiki/publish rendering can't drift from
 * what the UI shows; this module only pins the 'display' variant and the UI's null-on-
 * missing-converter contract, plus the frontend-only open-questions parser.
 */
import { renderArtifactMarkdown, isDocumentArtifact } from '@pap/shared';

export { isDocumentArtifact };

/**
 * Convert a JSON artifact string to markdown for display.
 * Returns null if the artifactType has no converter (i.e. it was always markdown or a specialized view).
 */
export function convertArtifactToMarkdown(artifactType: string, content: string): string | null {
  return renderArtifactMarkdown(artifactType, content, 'display');
}

// ── Open questions parser ─────────────────────────────────────────────────────

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
