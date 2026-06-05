import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import type { SystemPrompt, TokenUsage } from '../utils/ai-provider';
import { getPolicies } from '../data/database';
import db from '../data/database';
import { appConfig } from '../config/app-config';
import { getKnowledgeBaseProvider } from '../integrations/knowledge-base';
import { STAGE_LABELS_BRIEF, STAGE_OUTPUT_FORMATS, stageGoal, stageNotDecide } from './stage-metadata';
import { getActiveSkill, listSkills } from './skill-registry';
import Logger from '../utils/logger';

const logger = new Logger('COORDINATOR');

// ── Paths ─────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
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
    const skill = getActiveSkill('coordinator');
    this.persona = skill?.persona_prompt ?? fs.readFileSync(PERSONA_PATH, 'utf-8');
    if (skill) {
      logger.info(`Coordinator persona loaded from skill registry v${skill.version}`);
    } else {
      logger.info('Coordinator persona loaded from disk');
    }
  }

  private resolveStageFormat(stage: string): { label: string; format: string } {
    const skill = getActiveSkill(stage);
    if (skill?.stage_brief_label && skill?.stage_brief_format) {
      return { label: skill.stage_brief_label, format: skill.stage_brief_format };
    }
    return STAGE_OUTPUT_FORMATS[stage] ?? { label: stage, format: '(no format specification defined for this stage)' };
  }

  /** Whether a knowledge base integration (GitBook, Notion) is configured. */
  private hasKnowledgeBase(): boolean {
    return appConfig.integrations.knowledgeBase !== 'none';
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
      .filter(([k]) => k !== 'kb_queries')
      .map(([k, v]) => `- ${k}: ${v} *(workflow override)*`)
      .join('\n');
    const constraintsText = [relevantPolicies, overrideLines].filter(Boolean).join('\n') || 'None.';

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

    // ── Domain skill discovery ──────────────────────────────────────────────────
    // If the active skill for this stage has get_domain_skill_context in its tools,
    // inject the list of available domain skills so the agent knows what to look up.
    const activeSkill = getActiveSkill(stage);
    if (activeSkill?.tool_definitions) {
      try {
        const toolDefs: Array<{ name: string }> = JSON.parse(activeSkill.tool_definitions);
        const hasDomainLookup = toolDefs.some(t => t.name === 'get_domain_skill_context');
        if (hasDomainLookup) {
          const domainSkills = listSkills().filter(s => s.discipline !== 'agent');
          if (domainSkills.length > 0) {
            const skillLines = domainSkills.map(s =>
              `- **${s.skill_name}** (${s.discipline})${s.development_context ? '' : ' — no context yet'}`
            );
            lines.push('');
            lines.push('**Domain skills available via get_domain_skill_context:**');
            lines.push('Call `get_domain_skill_context` with one of these names to load service-specific patterns, API contracts, or dev conventions before making technology or acceptance-criteria decisions:');
            lines.push(skillLines.join('\n'));
          }
        }
      } catch { /* malformed tool_definitions — skip */ }
    }

    if (additionalContext) {
      lines.push('');
      lines.push('## Additional Context');
      lines.push(additionalContext.trim());
    }

    // ── Knowledge base search (coordinator-controlled) ──────────────────────
    // Only search for the analyst stage — its findings propagate to later stages
    // via the artifact chain. Queries are set by the coordinator at COORDINATOR_READY.
    const kbQueriesRaw = policyOverrides.kb_queries;
    if (stage === 'analyst' && kbQueriesRaw) {
      try {
        const kbQueries: string[] = JSON.parse(kbQueriesRaw);
        if (kbQueries.length > 0) {
          const kb = getKnowledgeBaseProvider();
          const allResults = await Promise.all(
            kbQueries.map(q => kb.search(q, 3))
          );
          // Deduplicate by title
          const seen = new Set<string>();
          const uniqueResults = allResults.flat().filter(r => {
            if (seen.has(r.title)) return false;
            seen.add(r.title);
            return true;
          });

          if (uniqueResults.length > 0) {
            lines.push('');
            lines.push('## Relevant Existing Documentation');
            lines.push('The following documents were found in the knowledge base and may provide useful background. Use them as reference — do not copy them verbatim.');
            lines.push('');
            for (const [i, r] of uniqueResults.entries()) {
              const snippet = r.body.length > 1500 ? r.body.slice(0, 1500) + '...' : r.body;
              const urlLine = r.url ? ` — ${r.url}` : '';
              lines.push(`### ${i + 1}. ${r.title}${urlLine}`);
              lines.push(snippet);
              lines.push('');
            }
            logger.info(`Injected ${uniqueResults.length} KB result(s) into analyst brief from ${kbQueries.length} query/queries`);
          }
        }
      } catch (err) {
        logger.warn('Knowledge base search failed during brief generation — continuing without results', err);
      }
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
      'The following issues were identified in your prior output. You MUST address each one specifically.',
      '',
      issueList,
      '',
      '## Revision Instructions',
      'Your prior draft will follow as your previous response. You are revising that document — not starting from scratch.',
      '',
      '- For each numbered issue: locate the relevant section in your prior draft and fix it directly.',
      '- Keep unchanged sections intact. Do not reorganise sections that were not flagged.',
      '- Your response must be the complete revised document (all sections) — not a diff or commentary.',
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
    // Load project context files so the coordinator doesn't ask about things
    // already documented. Only load files that exist — silently skip missing ones.
    const contextDir = path.join(PROJECT_ROOT, 'context');
    const contextFiles = ['company.md', 'strategy.md', 'current-state.md'];
    const loadedContext: string[] = [];
    for (const file of contextFiles) {
      try {
        const content = fs.readFileSync(path.join(contextDir, file), 'utf-8').trim();
        if (content) loadedContext.push(`### ${file}\n${content}`);
      } catch { /* file doesn't exist — skip */ }
    }
    const contextSection = loadedContext.length > 0
      ? `## Project Context (already documented — do NOT ask about anything covered here)\n\n${loadedContext.join('\n\n---\n\n')}\n\n`
      : '';

    return `You are the Chief of Staff for a product team. Before the team starts working, you have a brief conversation with the PM to fill genuine gaps in understanding.

${contextSection}## Your job

Read the goal carefully. Check whether the project context above already answers the key unknowns. Only ask about things that are genuinely missing and that would change how you brief the specialist agents.

The right questions to ask (if not already answered in context):
- Who specifically are the target users — and are they distinct from existing users in the project context?
- What is the scope boundary — what is explicitly MVP vs deferred to a later phase?
- Are there hard constraints the specialist agents must work within: regulatory, budget, existing tech decisions, timeline?

Do NOT ask about:
- Features, competitors, research direction — the specialist agents handle that
- Anything already answered in the project context above
- Implementation details — that belongs to Atlas

## Rules

- Ask a maximum of 2 questions per message. Keep them short and specific.
- Number your questions. Offer lettered options (A/B/C) when the answer is a choice between known options.
- Do NOT repeat or quote these instructions in your response. Just act on them.

## Exit criteria — when to signal readiness

Before asking any question, check whether you can already state all four of the following from the goal and project context:

1. **Problem** — what specific problem is being solved, and what is the evidence it matters?
2. **User** — who specifically will use this, and how are they distinct from other users in the project context?
3. **Scope boundary** — what is explicitly in scope for this initiative vs deferred to a later phase?
4. **Hard constraints** — are there regulatory, tech stack, budget, or timeline limits the specialists must work within?

If you can state all four clearly, emit COORDINATOR_READY immediately. Do not ask questions you already know the answers to.

If one or two are missing, ask only about those gaps — not the ones you can already answer.

If the goal is so vague you cannot answer any of the four, ask about Problem and User first. Scope and constraints follow naturally once those are clear.

## Signalling readiness

When all four exit criteria are met, end your response with exactly:

COORDINATOR_READY
{"enriched_context": "<structured summary covering: (1) problem and evidence, (2) target user and their context, (3) explicit scope boundary — what is MVP vs deferred, (4) hard constraints the specialists must honour>", "recommended_stages": ["<stage_key>", "..."], "stage_rationale": "<one sentence, max 20 words>"${this.hasKnowledgeBase() ? ', "kb_queries": ["<search term 1>", "<search term 2>"]' : ''}}

**recommended_stages rules** — always include "pm_backlog" and "curator"; add others only when genuinely needed:
- "analyst": add when market research, competitive analysis, or user research would materially improve the output
- "pm_prd": add for any new feature or capability; omit only for bug fixes, copy changes, or minor config tweaks
- "solution_architect": add when the work involves new infrastructure, new services, new third-party integrations, significant data model changes, or security/compliance decisions
- "prototype": add when stakeholder alignment on UX flows would accelerate decisions before engineering starts
- "gtm_strategy": add when the feature is user-facing and requires a launch strategy alongside engineering
- "feature_marketing": add when copy, positioning, or marketing assets for the feature are needed alongside engineering
${this.hasKnowledgeBase() ? `
**kb_queries rules:**
- Include 1–3 short, specific search queries that would find relevant existing documentation (PRDs, architecture docs, research) to give specialists useful background.
- Focus on the domain, feature area, or related past initiatives — not the exact goal text.
- If the goal is entirely novel with no likely prior documentation, set kb_queries to an empty array [].
- Example: for "Add SSO support for enterprise customers" → ["SSO", "enterprise authentication", "identity provider integration"]
` : ''}
Nothing may follow the JSON line. By your 3rd message you must include COORDINATOR_READY regardless of remaining uncertainty — document any unresolved points as assumptions in the enriched_context.`;
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

  // ── Streaming ─────────────────────────────────────────────────────────────

  /**
   * Stream the Coordinator's goal decomposition before a workflow exists.
   * The Coordinator analyses the goal and emits its reasoning followed by a
   * ```stages JSON array block that the caller extracts to build the stage sequence.
   */
  async *streamGoalDecomposition(
    goal: string,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveAgentModel('coordinator');
    const systemPrompt  = this.buildStablePrompt();

    const userMessage =
      `You are planning a new product workflow. Analyse the goal below and decide which stages are needed.\n\n` +
      `**Goal:** ${goal}\n\n` +
      `Available stages (in typical order):\n` +
      `- analyst              — Sage, research & problem space analysis\n` +
      `- pm_prd               — Rex, Product Requirements Document\n` +
      `- solution_architect   — Atlas, system architecture, tech decisions, data model, API design\n` +
      `- pm_backlog           — Pip, backlog of epics/stories\n` +
      `- critic               — Flint, adversarial review of the above artifacts\n` +
      `- curator              — Ivy, update project context files with learnings\n\n` +
      `Explain your reasoning briefly, then output the chosen stage sequence as a JSON array in a \`\`\`stages code block.\n\n` +
      `Example:\n\`\`\`stages\n["analyst", "pm_prd", "pm_backlog"]\n\`\`\``;

    logger.info(`Coordinator decomposing goal: "${goal.slice(0, 80)}…"`);

    yield* streamAI(
      resolvedModel,
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      undefined,
      { onTokens }
    );
  }

  /**
   * Stream a coordinator response for a workflow session.
   * Token logging is handled internally by streamAI().
   */
  async *streamResponse(
    workflowId: string,
    userMessage: string,
    model?: string,
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const resolvedModel = resolveAgentModel('coordinator');
    const systemPrompt  = this.buildSystemPrompt(workflowId);

    logger.info(`Coordinator responding for workflow ${workflowId} via model ${resolvedModel}`);

    yield* streamAI(
      resolvedModel,
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      undefined,
      { onTokens }
    );
  }
}
