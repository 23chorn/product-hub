/**
 * Compute a unified-style diff between two texts and return a markdown document.
 * Uses LCS (Myers-style backtrack) on lines. Practical for typical LLM outputs
 * of up to ~2 000 lines — beyond that it falls back to a stats-only summary.
 */
export function computeRevisionDiff(oldText: string, newText: string, stageLabel: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Safety cap: fall back to stats only for very large documents
  if (m * n > 2_000_000) {
    return `# Revision Diff — ${stageLabel}\n\n_Document too large for line-by-line diff._\n\n- Original: ${m} lines\n- Revised: ${n} lines\n`;
  }

  // Build LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce edit operations
  type Op = { op: '+' | '-' | '='; line: string };
  const ops: Op[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ op: '=', line: oldLines[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: '+', line: newLines[j - 1] }); j--;
    } else {
      ops.push({ op: '-', line: oldLines[i - 1] }); i--;
    }
  }
  ops.reverse();

  // Emit unified diff with 3-line context windows
  const CONTEXT = 3;
  const chunks: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === '=') { k++; continue; }
    // Found a changed region — collect context around it
    const start = Math.max(0, k - CONTEXT);
    let end = k;
    while (end < ops.length && (ops[end].op !== '=' || end - k < CONTEXT)) end++;
    end = Math.min(ops.length, end + CONTEXT);

    const block: string[] = [];
    for (let x = start; x < end; x++) {
      const { op, line } = ops[x];
      block.push(op === '+' ? `+ ${line}` : op === '-' ? `- ${line}` : `  ${line}`);
    }
    chunks.push(block.join('\n'));
    k = end;
  }

  const added   = ops.filter(o => o.op === '+').length;
  const removed = ops.filter(o => o.op === '-').length;

  if (chunks.length === 0) {
    return `# Revision Diff — ${stageLabel}\n\n_No line-level changes detected between drafts._\n`;
  }

  return [
    `# Revision Diff — ${stageLabel}`,
    '',
    `_${added} line${added !== 1 ? 's' : ''} added · ${removed} line${removed !== 1 ? 's' : ''} removed_`,
    '',
    '```diff',
    chunks.join('\n~~\n'),
    '```',
  ].join('\n');
}
