import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import type { SystemPrompt, TokenUsage } from '../utils/ai-provider';
import { getPolicies } from '../data/database';
import db from '../data/database';
import { STAGE_LABELS_BRIEF, STAGE_OUTPUT_FORMATS, stageGoal, stageNotDecide } from './stage-metadata';
import { readProductArea } from './item-metadata';
import Logger from '../utils/logger';
import type { CriticIssue } from './critic-agent';
import { buildPlanningSystemPrompt } from './coordinator-prompts';
import { findRepoRoot } from '../utils/find-repo-root';

const logger = new Logger('COORDINATOR');

// ── Paths ─────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = findRepoRoot(__dirname);
const PERSONA_PATH = path.join(PROJECT_ROOT, 'agents', 'personas', 'coordinator.md');

// ── Database row types ────────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  status: string;
  current_stage: string | null;
  stage_sequence: string;
  policy_overrides: string;
  created_at: number;
  updated_at: number;
}

interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  status: string;
  human_feedback: string | null;
  coordinator_action: string | null;
  created_at: number;
  resolved_at: number | null;
}

// ── CoordinatorAgent ──────────────────────────────────────────────────────────

export class CoordinatorAgent {
  private readonly persona: string;

  constructor() {
    this.persona = fs.readFileSync(PERSONA_PATH, 'utf-8');
    logger.info('Coordinator persona loaded from disk');
  }

  private resolveStageFormat(stage: string): { label: string; format: string } {
    return STAGE_OUTPUT_FORMATS[stage] ?? { label: stage, format: '(no format specification defined for this stage)' };
  }

  // ── Prompt construction ──────────────────────────────────────────────────

  /**
   * Build the stable portion of the system prompt: persona + governance policies.
   * This portion is cacheable across requests for the same coordinator session.
   */
  private buildStablePrompt(): string {
    const policies = getPolicies('global');
    const policyLines = policies.length > 0
      ? policies.map(p => `- **${p.rule_key}**: ${p.rule_value}`).join('\n')
      : '- (no global policies defined)';

    return `${this.persona}

## Governance Policies

The following policies govern all workflow decisions. Apply them without being asked:

${policyLines}`;
  }

  /**
   * Build the dynamic portion of the system prompt: workflow goal + completed stage
   * summaries + pending checkpoint feedback. Changes per workflow and per message.
   */
  private buildDynamicPrompt(workflowId: string): string {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    if (!workflow) return '';

    const stageSequence: string[] = JSON.parse(workflow.stage_sequence ?? '[]');

    // Completed checkpoints provide the stage summary
    const completedCheckpoints = db
      .prepare<[string], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE workflow_id = ? AND status IN ('approved', 'revised')
         ORDER BY created_at ASC`
      )
      .all(workflowId);

    // Pending checkpoint = current pause point awaiting human input
    const pendingCheckpoint = db
      .prepare<[string], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE workflow_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(workflowId);

    const lines: string[] = [
      '## Current Workflow',
      '',
      `**Goal:** ${workflow.goal}`,
      `**Status:** ${workflow.status}`,
      `**Planned stages:** ${stageSequence.join(' → ') || '(not yet determined)'}`,
      `**Current stage:** ${workflow.current_stage ?? 'not started'}`,
    ];

    if (completedCheckpoints.length > 0) {
      lines.push('', '## Completed Stage Summaries', '');
      for (const cp of completedCheckpoints) {
        lines.push(`### Stage: ${cp.stage}`);
        lines.push(`Status: ${cp.status}`);
        if (cp.human_feedback) {
          lines.push(`Human feedback: ${cp.human_feedback}`);
        }
        lines.push('');
      }
    }

    if (pendingCheckpoint) {
      lines.push('## Pending Checkpoint', '');
      lines.push(`Stage: **${pendingCheckpoint.stage}** — awaiting human decision.`);
      if (pendingCheckpoint.human_feedback) {
        lines.push(`Human feedback received: ${pendingCheckpoint.human_feedback}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Returns the full split system prompt for a workflow session.
   */
  buildSystemPrompt(workflowId: string): SystemPrompt {
    return {
      stable:  this.buildStablePrompt(),
      dynamic: this.buildDynamicPrompt(workflowId),
    };
  }

  // ── Stage briefing ────────────────────────────────────────────────────────

  /**
   * Generate a structured handoff brief for a specialist agent.
   * The brief is injected as the opening user message of the specialist's session.
   *
   * Warns if the brief exceeds 800 tokens (~3200 chars) — it should stay tight
   * because the specialist's own system prompt is already large.
   */
  async generateStageBrief(
    workflowId: string,
    stage: string,
    additionalContext?: string   // critic feedback text or revision notes (used in auto-revise path)
  ): Promise<string> {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    const goal = workflow?.goal ?? '(workflow goal not found)';
    const policyOverrides: Record<string, string> = JSON.parse(
      workflow?.policy_overrides ?? '{}'
    );

    // Resolve productArea from item metadata (set at workflow start from Airtable)
    const productAreaScope = workflow?.item_id ? readProductArea(workflow.item_id) : null;

    const stageFormat = this.resolveStageFormat(stage);
    const outputLabel = stageFormat.label;
    const outputFormat = stageFormat.format;

    // ── Constraints ────────────────────────────────────────────────────────────
    const policies = getPolicies('global');
    const relevantPolicies = policies
      .filter(p => !['auto_approve_analyst_output', 'require_critic_review'].includes(p.rule_key))
      .map(p => `- ${p.rule_key}: ${p.rule_value}`)
      .join('\n');
    const overrideLines = Object.entries(policyOverrides)
      .map(([k, v]) => `- ${k}: ${v} *(workflow override)*`)
      .join('\n');
    const platformLine = productAreaScope
      ? `- Platform scope: ${productAreaScope} — design only for the platforms this tag implies; do not design for others`
      : null;
    const constraintsText = [relevantPolicies, overrideLines, platformLine].filter(Boolean).join('\n') || 'None.';

    // ── Prior stage outputs & human preferences (from approved checkpoints) ────
    const approvedCheckpoints = db
      .prepare<[string], CheckpointRow>(`
        SELECT stage, human_feedback FROM checkpoints
        WHERE workflow_id = ? AND status = 'approved'
        ORDER BY created_at ASC
      `)
      .all(workflowId);

    const priorStages = approvedCheckpoints.map(cp => cp.stage);
    const priorOutputsText = priorStages.length > 0
      ? priorStages
          .map(s => `- ${STAGE_LABELS_BRIEF[s] ?? s} — approved and available in this workflow`)
          .join('\n')
      : 'None — this is the first stage.';

    // Key decisions: approved stages are settled; list them so specialist knows what is locked
    const decisionsText = priorStages.length > 0
      ? priorStages
          .map(s => `- ${STAGE_LABELS_BRIEF[s] ?? s} is approved and final — do not re-litigate its scope or findings`)
          .join('\n')
      : 'None.';

    // Human preferences: non-null human_feedback from approved checkpoints
    const feedbackCheckpoints = approvedCheckpoints.filter(cp => cp.human_feedback);
    const humanPrefsText = feedbackCheckpoints.length > 0
      ? feedbackCheckpoints
          .map(cp => `- At ${STAGE_LABELS_BRIEF[cp.stage] ?? cp.stage} review: "${cp.human_feedback!.slice(0, 300)}"`)
          .join('\n')
      : 'None.';

    // ── Per-stage goal (one sentence) ──────────────────────────────────────────
    const stageGoalText = stageGoal(stage, goal);

    // ── Explicit boundaries (what this specialist must NOT decide) ─────────────
    const notDecideText = stageNotDecide(stage);

    // ── Assemble brief using structured schema ─────────────────────────────────
    const lines: string[] = [
      `# Stage Brief: ${outputLabel}`,
      '',
      `**Goal:** ${stageGoalText}`,
      '',
      `**Original request:** ${goal}`,
      '',
      '**Constraints:**',
      constraintsText,
      '',
      '**Prior stage outputs available:**',
      priorOutputsText,
      '',
      '**Key decisions already made:**',
      decisionsText,
      '',
      '**Human preferences expressed:**',
      humanPrefsText,
      '',
      '**Output required:**',
      outputFormat,
      '',
      `**What this specialist must NOT decide:** ${notDecideText}`,
      '',
      '---',
      '',
      '## Execution Instructions',
      'You are executing this task autonomously. Do NOT ask questions, show menus, or wait for input.',
      '',
      '- Your entire response must be the deliverable itself — nothing else.',
      '- Write real, substantive content about the specific goal stated above. Do not use placeholder text.',
      '- Produce the complete document in one response. Do not truncate or defer any section.',
      '- If any detail is genuinely ambiguous, make a reasonable assumption — do not ask.',
    ];

    if (additionalContext) {
      lines.push('');
      lines.push('## Additional Context');
      lines.push(additionalContext.trim());
    }

    const brief = lines.join('\n');

    // Token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(brief.length / 4);
    if (estimatedTokens > 1200) {
      logger.warn(
        `Stage brief for "${stage}" is ~${estimatedTokens} tokens (target ≤ 1200). ` +
        `Consider shortening format spec or human feedback entries.`
      );
    }

    return brief;
  }

  /**
   * Build a revision brief for a specialist stage.
   *
   * Unlike generateStageBrief (which produces a from-scratch brief), this tells
   * the specialist exactly what was wrong with its prior output and instructs it
   * to fix those specific issues — not rewrite the document from scratch.
   *
   * @param workflowId   Active workflow ID (used to fetch the goal).
   * @param stage        Stage name (e.g. 'analyst').
   * @param priorDraft   Full text of the specialist's previous output.
   * @param issues       Critic issues formatted as "[SEVERITY] description" strings.
   */
  generateRevisionBrief(
    workflowId: string,
    stage: string,
    priorDraft: string,
    issues: string[]
  ): string {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    const goal = workflow?.goal ?? '(workflow goal not found)';
    const stageFormat = this.resolveStageFormat(stage);
    const outputLabel = stageFormat.label;
    const outputFormat = stageFormat.format;

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

    const lines: string[] = [
      `# Revision Required: ${outputLabel}`,
      '',
      '## Goal',
      goal,
      '',
      '## Issues to Fix',
      'The following issues were identified in your prior output. Address each one with a SURGICAL EDIT — change only what is flagged.',
      '',
      issueList,
      '',
      '## Revision Instructions',
      'Your prior draft will follow as your previous response. You are performing a TARGETED EDIT of that document — not a rewrite.',
      '',
      '- For each numbered issue: locate the EXACT field, sentence, or paragraph that needs changing and fix it in-place.',
      '- Leave all other content untouched — same wording, same structure, same order as your prior draft.',
      '- Do NOT rewrite, reorganise, or "improve" any section that was not explicitly flagged.',
      '- Do NOT add new sections, remove existing sections, or change section headings.',
      '- Do NOT reorder array items or object keys that were not mentioned in the issues.',
      '- Your response must be the complete revised document (all sections included) — not a diff or commentary.',
      '- Do not use placeholder text. Every factual claim needs a [N] citation or an [Assumption — no source found] marker.',
      '- If a fix requires researching new information, do so before writing.',
      '- You are executing this revision autonomously. Do NOT ask questions, show menus, or wait for input.',
      '',
      '## Required Output Format',
      outputFormat,
    ];

    return lines.join('\n');
  }

  // ── Change Request briefing ──────────────────────────────────────────────

  /**
   * Build a CR-specific revision brief for a specialist stage.
   * Unlike generateRevisionBrief (which is driven by critic issues), this tells
   * the specialist what changed via the CR and scopes modifications to affected
   * sections only.
   */
  generateCRBrief(
    workflowId: string,
    stage: string,
    crDescription: string,
    priorDraft: string
  ): string {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    const goal = workflow?.goal ?? '(workflow goal not found)';
    const stageFormat = this.resolveStageFormat(stage);
    const outputLabel = stageFormat.label;
    const outputFormat = stageFormat.format;

    const lines: string[] = [
      `# Change Request Revision: ${outputLabel}`,
      '',
      '## Goal',
      goal,
      '',
      '## Change Request',
      crDescription,
      '',
      '## Revision Instructions',
      'A change request has been filed against this workflow. Your prior draft will follow as your previous response.',
      'You are revising that document to incorporate the change described above — not starting from scratch.',
      '',
      '- Locate and modify ONLY the sections affected by this change request.',
      '- Keep all unchanged sections intact. Do not reorganise or rewrite content that is not impacted.',
      '- Your response must be the complete revised document (all sections) — not a diff or commentary.',
      '- If the change affects downstream assumptions in other sections, update those too.',
      '- You are executing this revision autonomously. Do NOT ask questions, show menus, or wait for input.',
      '',
      '## Required Output Format',
      outputFormat,
    ];

    return lines.join('\n');
  }

  // ── Pre-workflow planning conversation ───────────────────────────────────

  /**
   * System prompt for the coordinator's pre-workflow planning phase.
   * Used before any stage runs — coordinator gathers clarifications from the PM
   * on behalf of specialist agents, then signals readiness with COORDINATOR_READY.
   */
  private buildPlanningSystemPrompt(): string {
    return buildPlanningSystemPrompt();
  }

  /**
   * Stream a response in the pre-workflow planning conversation.
   * messages is the full conversation history (user + assistant turns).
   */
  async *streamPlanningResponse(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveAgentModel('coordinator');
    yield* streamAI(resolvedModel, this.buildPlanningSystemPrompt(), messages, undefined, { onTokens });
  }

  // ── Critic verdict filter ────────────────────────────────────────────────

  /**
   * Evaluate the Critic's flagged issues against the initiative's stated scope.
   * Issues that contradict explicit scope boundaries, stated exclusions, or
   * already-documented constraints are filtered out before the auto-revision
   * decision is made — preventing noisy, off-scope issues from triggering
   * unnecessary revision cycles.
   *
   * Fails safe: if the LLM call or JSON parse fails, all issues are preserved.
   *
   * @returns validIssues   Only the issues that survive scope validation.
   * @returns filteredCount Number of issues removed.
   * @returns reasoning     One-sentence explanation from the Coordinator.
   */
  async filterCriticIssues(
    workflowId: string,
    stage: string,
    issues: CriticIssue[],
    onTokens?: (usage: TokenUsage) => void
  ): Promise<{ validIssues: CriticIssue[]; filteredCount: number; reasoning: string }> {
    const noOp = { validIssues: issues, filteredCount: 0, reasoning: '' };
    if (issues.length === 0) return noOp;

    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);
    if (!workflow) return noOp;

    const issueList = issues
      .map((issue, i) => `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`)
      .join('\n');

    const systemPrompt = `You are the Chief of Staff validating a quality reviewer's findings against the stated initiative scope. You output ONLY a JSON object — no other text.`;

    const userMessage =
`**Initiative goal and scope:**
${workflow.goal}

**Stage reviewed:** ${stage}

**Issues flagged by the quality reviewer:**
${issueList}

Classify each issue as one of:
- "valid" — genuinely in-scope and should be fixed
- "out_of_scope" — contradicts an explicit scope exclusion, stated constraint, or MVP boundary
- "already_addressed" — the goal or constraints already cover this concern

Return exactly:
{"assessments":[{"index":1,"status":"valid"|"out_of_scope"|"already_addressed","reason":"<brief>"}...],"recommendation":"proceed_with_revision"|"override_to_approve","reasoning":"<one sentence>"}`;

    try {
      const resolvedModel = resolveAgentModel('coordinator');
      let fullText = '';
      for await (const chunk of streamAI(resolvedModel, systemPrompt,
        [{ role: 'user', content: userMessage }], undefined, { onTokens })) {
        fullText += chunk;
      }

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return noOp;
      const parsed = JSON.parse(jsonMatch[0]) as {
        assessments: Array<{ index: number; status: string; reason: string }>;
        recommendation: string;
        reasoning: string;
      };

      const validIssues = issues.filter((_, i) => {
        const a = parsed.assessments?.find(a => a.index === i + 1);
        return !a || a.status === 'valid';
      });

      const filteredCount = issues.length - validIssues.length;
      logger.info(`Coordinator filtered ${filteredCount}/${issues.length} critic issues for stage "${stage}" — ${parsed.reasoning}`);
      return { validIssues, filteredCount, reasoning: parsed.reasoning ?? '' };
    } catch (err: any) {
      logger.warn(`Coordinator issue filter failed for stage "${stage}": ${err.message} — preserving all issues`);
      return noOp;
    }
  }

}
