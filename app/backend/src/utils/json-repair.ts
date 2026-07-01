// ── JSON fence stripping / loose parsing ───────────────────────────────────────

/**
 * Strip a ```json ... ``` (or plain ```) code fence wrapping model JSON output, and
 * drop any preamble before the first '{'. Returns the cleaned text, still a string.
 */
export function stripJsonFence(raw: string): string {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = cleaned.indexOf('{');
  return jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
}

// Valid JSON escape characters after the leading backslash.
const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

/**
 * Sanitize string values in JSON output from LLMs:
 *  - Replaces literal (unescaped) newlines/carriage-returns inside strings with spaces.
 *  - Removes backslashes before characters that are not valid JSON escape sequences
 *    (e.g. \p, \s from Windows paths or markdown), which cause "Bad escaped character".
 * Valid sequences (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX) are preserved unchanged.
 */
function sanitizeJsonStringValues(raw: string): string {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (!inString) {
      result += ch;
      if (ch === '"') inString = true;
      i++;
      continue;
    }

    if (ch === '\\') {
      const next = i + 1 < raw.length ? raw[i + 1] : '';
      if (VALID_JSON_ESCAPES.has(next)) {
        // Valid escape sequence — keep as-is
        result += ch + next;
        i += 2;
      } else {
        // Invalid escape (e.g. \p, \s) — drop the backslash, preserve the character
        result += next;
        i += 2;
      }
      continue;
    }

    if (ch === '"') {
      inString = false;
      result += ch;
      i++;
      continue;
    }

    // Replace literal newlines inside strings with spaces
    if (ch === '\n' || ch === '\r') {
      result += ' ';
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Strip a JSON code fence and parse it. Returns null on parse failure instead of
 * throwing — use where a missing/malformed artifact should be treated as "no data"
 * rather than an error. Sanitizes literal newlines in string values before parsing.
 */
export function parseJsonLoose(raw: string): any | null {
  try {
    const cleaned = stripJsonFence(raw);
    const sanitized = sanitizeJsonStringValues(cleaned);
    return JSON.parse(sanitized);
  } catch {
    return null;
  }
}

/**
 * Return the first complete, brace-balanced top-level JSON object in `s`, or null if the
 * input contains no balanced object. String/escape aware — a stray `{` or `}` inside a
 * quoted value (e.g. a field describing template syntax) won't throw off the brace count.
 *
 * Use when a model appends trailing prose after an otherwise-valid object (which makes
 * JSON.parse throw "... after JSON ..."), to recover just the object.
 */
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;

  let braceCount = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braceCount++;
    else if (ch === '}') {
      braceCount--;
      if (braceCount === 0) return s.slice(start, i + 1);
    }
  }
  return null; // never returned to balance — input was truncated mid-object
}

// ── JSON repair (for truncated model output) ───────────────────────────────────

/**
 * Best-effort repair of a JSON string truncated mid-generation (e.g. the model
 * hit its max_tokens ceiling). Closes an unterminated string, drops a trailing
 * comma, and closes any unbalanced braces/brackets. Returns the input unchanged
 * if it already parses.
 */
export function repairTruncatedJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  s = sanitizeJsonStringValues(s);
  try { JSON.parse(s); return s; } catch { /* needs repair */ }

  let inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') inString = !inString;
  }
  if (inString) {
    if (s.endsWith('\\')) s = s.slice(0, -1);
    s += '"';
  }
  s = s.replace(/,\s*$/, '');

  const stack: string[] = [];
  inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && inString) { i++; continue; }
    if (s[i] === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (s[i] === '{') stack.push('}');
    else if (s[i] === '[') stack.push(']');
    else if (s[i] === '}' || s[i] === ']') stack.pop();
  }
  while (stack.length > 0) s += stack.pop();
  return s;
}
