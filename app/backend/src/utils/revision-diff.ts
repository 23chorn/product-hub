/**
 * Line-level diffing shared by the revision-diff markdown report and the
 * Knowledge Studio commit history stats. Uses LCS (Myers-style backtrack) on
 * lines. Practical for typical documents of up to ~2 000 lines — beyond that
 * callers fall back to a stats-only summary.
 */
type Op = { op: '+' | '-' | '='; line: string };

const MAX_CELLS = 2_000_000;

/** Returns line-level edit operations, or null if the pair is too large to diff precisely. */
function diffLines(oldLines: string[], newLines: string[]): Op[] | null {
  const m = oldLines.length;
  const n = newLines.length;
  if (m * n > MAX_CELLS) return null;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

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
  return ops;
}

/** Compute a unified-style diff between two texts and return a markdown document. */
export function computeRevisionDiff(oldText: string, newText: string, stageLabel: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const ops = diffLines(oldLines, newLines);

  if (!ops) {
    return `# Revision Diff — ${stageLabel}\n\n_Document too large for line-by-line diff._\n\n- Original: ${oldLines.length} lines\n- Revised: ${newLines.length} lines\n`;
  }

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

/** Line-level insertion/deletion counts between two texts, without building diff text. */
export function countLineChanges(oldText: string, newText: string): { added: number; removed: number } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const ops = diffLines(oldLines, newLines);

  if (!ops) {
    // Too large to diff precisely — approximate from the net line-count delta.
    return {
      added: Math.max(0, newLines.length - oldLines.length),
      removed: Math.max(0, oldLines.length - newLines.length),
    };
  }

  let added = 0, removed = 0;
  for (const o of ops) {
    if (o.op === '+') added++;
    else if (o.op === '-') removed++;
  }
  return { added, removed };
}
