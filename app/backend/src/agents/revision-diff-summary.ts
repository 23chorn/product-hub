/**
 * AI revision summary — turns a raw line-level diff into a short, reviewer-facing
 * note that says what changed and whether the requested changes were addressed, so a
 * human can confirm their feedback was applied before approving without reading the
 * whole document or the raw diff.
 *
 * Surfaced inline at the checkpoint (stored in coordinator_action.revision_summary).
 * Lives in its own leaf module — depends only on the AI provider + logger — so either
 * stage runner can import it without cycle risk.
 */
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import Logger from '../utils/logger';

const logger = new Logger('REVISION-SUMMARY');

// Keep token cost bounded — the request brief and diff can both be large.
const MAX_REQUEST_CHARS = 4_000;
const MAX_DIFF_CHARS = 16_000;

/**
 * Summarise a revision for the reviewer. Returns a short markdown block, or '' on any
 * failure — callers fall back to showing nothing rather than blocking the checkpoint.
 *
 * @param stageLabel     Human-readable artifact label (e.g. "PRD", "Feature 2 Backlog").
 * @param requestContext What was asked for — the revision brief / human feedback / critic issues.
 * @param diffText       Unified diff from computeRevisionDiff (previous → revised).
 */
export async function summarizeRevisionDiff(params: {
  stageLabel: string;
  requestContext: string;
  diffText: string;
}): Promise<string> {
  const { stageLabel, requestContext, diffText } = params;

  // Nothing meaningful to summarise — skip the LLM call entirely.
  if (!diffText.trim() || !requestContext.trim()) return '';

  try {
    const system =
      `You are a review assistant. A specialist has just revised a ${stageLabel} in response to reviewer ` +
      `feedback. Given the feedback and a line-level diff of what changed, write a brief summary a reviewer ` +
      `can read in ~15 seconds to confirm the feedback was addressed before approving.`;

    const user =
      `## Reviewer feedback / change request\n${requestContext.slice(0, MAX_REQUEST_CHARS)}\n\n` +
      `## Diff (previous → revised)\n${diffText.slice(0, MAX_DIFF_CHARS)}\n\n` +
      `Write the summary as markdown:\n` +
      `- One sentence overview of what was revised.\n` +
      `- One bullet per distinct request: briefly restate the request and mark it ✅ Addressed, ` +
      `⚠️ Partially addressed, or ❌ Not addressed, with a few words of evidence from the diff.\n` +
      `- If the diff includes changes not tied to any request, list them under a final "Other changes" line.\n` +
      `Keep it under 150 words. Do not paste raw diff lines.`;

    let out = '';
    for await (const chunk of streamAI(resolveAgentModel('critic'), system, [{ role: 'user', content: user }], 1_024)) {
      out += chunk;
    }
    return out.trim();
  } catch (err: any) {
    logger.warn(`Failed to summarize revision for "${stageLabel}": ${err.message}`);
    return '';
  }
}
