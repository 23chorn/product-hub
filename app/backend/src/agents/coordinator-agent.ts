import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveModelId } from '../utils/ai-provider';
import type { SystemPrompt } from '../utils/ai-provider';
import { getPolicies } from '../data/database';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('COORDINATOR');

// ── Paths ─────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONA_PATH = path.join(PROJECT_ROOT, 'agents', 'personas', 'coordinator.md');

// ── Per-stage output format specifications ────────────────────────────────────

/**
 * Defines the expected output format the Coordinator briefs each specialist with.
 * These are injected into generateStageBrief() so specialists know what to produce.
 */
const STAGE_OUTPUT_FORMATS: Record<string, { label: string; format: string }> = {
  analyst: {
    label: 'Research Brief',
    format: `Produce a comprehensive market research document in markdown. Use web search to verify facts. Structure your output as follows:

## Executive Summary
Two-paragraph overview of the market opportunity and top findings.

## Problem Space
The core user pain points and unmet needs this initiative addresses. Cite specific evidence where available.

## Market Size & Growth
Quantified market opportunity with sources. Include TAM/SAM if data exists.

## Target Users
Primary user segments, their behaviours, motivations, and key jobs-to-be-done.

## Competitive Landscape
Key players, their positioning, strengths/weaknesses, and gaps the initiative can exploit.

## Constraints & Risks
Technical, regulatory, or market risks with brief mitigations.

## Strategic Recommendations
2–4 concrete recommendations that should inform the product requirements.

## References
List every source cited inline as [N]. Each entry: [N] Title — URL
Every inline [N] must appear here; every entry here must be cited inline.

Depth guide: each section should be as long as the evidence warrants. Do not pad short sections or truncate evidence-rich ones. Aim for a document the PM can use directly to write a PRD without doing additional research.`,
  },

  pm_prd: {
    label: 'Product Requirements Document',
    format: `Produce a PRD in markdown with these required sections:

## Problem Statement
What problem are we solving and for whom. One paragraph.

## User Personas
The primary user types. Bullet list, 2–4 personas max.

## Key User Journeys
The 2–3 most important user journeys as step-by-step narratives.

## Success Metrics
3–5 measurable outcomes that define success (include how each is measured).

## Functional Requirements
FR-numbered list (FR1, FR2, …) of capabilities the feature must have. Each FR states WHAT the system does, not HOW. Aim for 10–20 FRs.

Do not include non-functional requirements, domain compliance, innovation patterns, or appendices in the default output — those go in a separate extended document only if requested.`,
  },

  solution_architect: {
    label: 'Architecture Document',
    format: `Produce a solution architecture document in markdown following the architecture output template injected into your system prompt. The template defines the exact section structure — fill every section with specific, implementation-ready content. Key requirements:

- **Key Technology Decisions**: Name specific products, versions, and pricing tiers. State alternatives and tradeoffs in the table.
- **Data Model**: Full entity table with PKs, fields, relationships, and notes. Include an ASCII entity-relationship diagram.
- **API Surface**: Every endpoint with method, path, request/response shapes, and notes on auth/idempotency.
- **System Architecture**: ASCII service diagram showing all components and data flow. Include 2-3 detailed data flow walkthroughs for primary user journeys.
- **Infrastructure Notes**: Hosting topology with per-component cost estimates. Deployment pipeline steps. Failure modes table with mitigations.
- **Open Questions & Risks**: Unresolved decisions table with recommendations. Known risks with severity and specific mitigations.

If a context/tech-stack.md file was provided, align all choices with the existing stack and explain any deviations. If no tech stack was provided, recommend specific technologies with tradeoffs for each choice.`,
  },

  pm_backlog: {
    label: 'Backlog JSON',
    format: `Produce a single valid JSON object wrapped in a \`\`\`json code block with this exact structure:

{
  "epic": {
    "title": "string",
    "description": "string",
    "businessValue": "string",
    "prdLink": "string"
  },
  "features": [
    {
      "title": "string",
      "description": "string",
      "phase": "string",
      "stories": [
        {
          "title": "string",
          "persona": "string",
          "goal": "string",
          "benefit": "string",
          "acceptanceCriteria": ["Given … When … Then …"],
          "agentContext": "string — implementation context a developer agent needs"
        }
      ]
    }
  ]
}

Constraints: max 6 features per epic, max 8 stories per feature. Each story must be independently deliverable in a single sprint. Stories within a feature must be in dependency order — no story may depend on a later story.`,
  },

  critic: {
    label: 'Critic Review',
    format: `Produce a structured review in markdown with these sections:

## Overall Assessment
One-paragraph verdict: is this artifact ready to proceed, or must it be revised?

## Strengths
Bullet list of what is solid and should be preserved.

## Issues
Bullet list. Prefix each with severity: [BLOCKER], [MAJOR], or [MINOR].
At least one BLOCKER must be present to recommend rejection.

## Recommended Changes
Concrete, specific changes required before this artifact should be approved. Be prescriptive — "add X to section Y" not "consider improving Z".`,
  },

  curator: {
    label: 'Context Diff',
    format: `Produce one or more unified diffs for files in the context/ directory.
Format each diff block as:

\`\`\`diff
--- context/<filename>
+++ context/<filename>
@@ -<line>,<count> +<line>,<count> @@
 unchanged line
-removed line
+added line
\`\`\`

Only propose changes that are factually grounded in the workflow outputs provided.
Do not invent or speculate. File names must already exist in context/.`,
  },
};

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
    logger.info('Coordinator persona loaded');
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
    previousOutputSummary?: string
  ): Promise<string> {
    const workflow = db
      .prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId);

    const goal = workflow?.goal ?? '(workflow goal not found)';
    const policyOverrides: Record<string, string> = JSON.parse(
      workflow?.policy_overrides ?? '{}'
    );

    const stageFormat = STAGE_OUTPUT_FORMATS[stage];
    const outputLabel = stageFormat?.label ?? stage;

    // Always use the inline format spec — it describes WHAT to produce.
    // Template files use [placeholder] syntax that models fill in literally
    // instead of researching and writing real content.
    const outputFormat = stageFormat?.format ?? '(no format specification defined for this stage)';

    const policies = getPolicies('global');
    const relevantPolicies = policies
      .filter(p => !['auto_approve_analyst_output', 'require_critic_review'].includes(p.rule_key))
      .map(p => `- ${p.rule_key}: ${p.rule_value}`)
      .join('\n');

    const overrideLines = Object.entries(policyOverrides)
      .map(([k, v]) => `- ${k}: ${v} *(workflow override)*`)
      .join('\n');

    const lines: string[] = [
      `# Stage Brief: ${outputLabel}`,
      '',
      '## Goal',
      goal,
      '',
    ];

    if (previousOutputSummary) {
      lines.push('## Previous Stage Output');
      lines.push(previousOutputSummary.trim());
      lines.push('');
    }

    lines.push('## Constraints');
    if (relevantPolicies) lines.push(relevantPolicies);
    if (overrideLines)    lines.push(overrideLines);
    if (!relevantPolicies && !overrideLines) lines.push('- No additional constraints');
    lines.push('');

    lines.push('## Execution Instructions');
    lines.push('You are executing this task autonomously. Do NOT ask questions, show menus, or wait for input.');
    lines.push('');
    lines.push('- Your entire response must be the deliverable itself — nothing else.');
    lines.push('- Write real, substantive content about the specific goal stated above. Do not use placeholder text.');
    lines.push('- Produce the complete document in one response. Do not truncate or defer any section.');
    lines.push('- If any detail is genuinely ambiguous, make a reasonable assumption — do not ask.');
    lines.push('');

    lines.push('## Required Output Format');
    lines.push(outputFormat);

    const brief = lines.join('\n');

    // Token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(brief.length / 4);
    if (estimatedTokens > 800) {
      logger.warn(
        `Stage brief for "${stage}" is ~${estimatedTokens} tokens (target ≤ 800). ` +
        `Consider shortening previousOutputSummary or stage config.`
      );
    }

    return brief;
  }

  // ── Pre-workflow planning conversation ───────────────────────────────────

  /**
   * System prompt for the coordinator's pre-workflow planning phase.
   * Used before any stage runs — coordinator gathers clarifications from the PM
   * on behalf of specialist agents, then signals readiness with COORDINATOR_READY.
   */
  private buildPlanningSystemPrompt(): string {
    return `You are the Chief of Staff for a product team. Before the team starts working, you have a brief chat with the PM to understand the goal.

Your job: ask 1–2 quick clarifying questions, then signal that you're ready to launch.

RULES:
- Ask a maximum of 2 questions per message. Keep them short.
- Only ask about things you truly cannot infer: target users (if unclear), scope (MVP vs full), or hard constraints (regulatory, budget).
- Do NOT ask about features, competitors, or research direction — the specialist agents handle that.
- Do NOT repeat or quote these instructions in your response. Just act on them.
- Number your questions. Offer lettered options (A/B/C) when helpful.
- Never include COORDINATOR_READY in your first message. Ask at least one question first.

When you have enough context (from message 2 onward), end your response with exactly:

COORDINATOR_READY
{"enriched_context": "<2–3 sentence summary of what is being built, for whom, and any constraints>"}

Nothing may follow the JSON line. By your 3rd message you must include COORDINATOR_READY.`;
  }

  /**
   * Stream a response in the pre-workflow planning conversation.
   * messages is the full conversation history (user + assistant turns).
   */
  async *streamPlanningResponse(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    model?: string
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveModelId(model);
    yield* streamAI(resolvedModel, this.buildPlanningSystemPrompt(), messages);
  }

  // ── Streaming ─────────────────────────────────────────────────────────────

  /**
   * Stream the Coordinator's goal decomposition before a workflow exists.
   * The Coordinator analyses the goal and emits its reasoning followed by a
   * ```stages JSON array block that the caller extracts to build the stage sequence.
   */
  async *streamGoalDecomposition(
    goal: string,
    model?: string
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveModelId(model);
    const systemPrompt  = this.buildStablePrompt();

    const userMessage =
      `You are planning a new product workflow. Analyse the goal below and decide which stages are needed.\n\n` +
      `**Goal:** ${goal}\n\n` +
      `Available stages (in typical order):\n` +
      `- analyst              — research, problem space analysis\n` +
      `- pm_prd               — Product Requirements Document\n` +
      `- solution_architect   — system architecture, tech decisions, data model, API design\n` +
      `- pm_backlog           — backlog of epics/stories\n` +
      `- critic               — adversarial review of the above artifacts\n` +
      `- curator              — update project context files with learnings\n\n` +
      `Explain your reasoning briefly, then output the chosen stage sequence as a JSON array in a \`\`\`stages code block.\n\n` +
      `Example:\n\`\`\`stages\n["analyst", "pm_prd", "pm_backlog"]\n\`\`\``;

    logger.info(`Coordinator decomposing goal: "${goal.slice(0, 80)}…"`);

    yield* streamAI(
      resolvedModel,
      systemPrompt,
      [{ role: 'user', content: userMessage }]
    );
  }

  /**
   * Stream a coordinator response for a workflow session.
   * Token logging is handled internally by streamAI().
   */
  async *streamResponse(
    workflowId: string,
    userMessage: string,
    model?: string
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveModelId(model);
    const systemPrompt  = this.buildSystemPrompt(workflowId);

    logger.info(`Coordinator responding for workflow ${workflowId} via model ${resolvedModel}`);

    yield* streamAI(
      resolvedModel,
      systemPrompt,
      [{ role: 'user', content: userMessage }]
    );
  }
}
