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
