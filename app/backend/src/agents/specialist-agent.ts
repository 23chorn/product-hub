import { AgentType } from '@pap/shared';
import { streamAI, resolveModelId, getActiveProvider, type SystemPrompt, type TokenUsage, type ToolDefinition } from '../utils/ai-provider';
import Logger from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('SPECIALIST-AGENT');

// Project root is three levels up from app/backend/src/agents/
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');
const CONTEXT_ROOT = path.join(PROJECT_ROOT, 'context');
const TEMPLATES_DIR = path.join(AGENTS_ROOT, 'templates');

/**
 * Maps workflow stage name to the output template file the specialist should follow.
 * Only the relevant template is injected — avoids wasting tokens on unrelated formats.
 */
const STAGE_TEMPLATE_MAP: Record<string, string> = {
  analyst:              'research.template.md',
  pm_prd:               'prd.template.md',
  epic_feature_planner: 'epic-features.template.md',
  solution_architect:   'architecture.template.md',
  story_decomposition:  'backlog.template.md',
  tech_refinement:      'tech-refinement.template.md',
  prototype:            'prototype.template.md',
  figma_design:         'figma-design.template.md',
  qa_engineer:          'qa-tests.template.md',
};

/**
 * Parsed representation of a context file after stripping YAML frontmatter.
 * Files without a `stages` key are injected into every agent (universal).
 * Files with `stages: [a, b]` are only injected when the current stage matches.
 */
type ContextFile = { body: string; stages: string[] | null };

/** Raw parsed files — loaded once, shared across all instances and stage calls. */
let _contextFilesCache: ContextFile[] | null = null;
/** Per-stage assembled strings derived from _contextFilesCache. */
const _contextByStageCache = new Map<string, string>();

/** Strip YAML frontmatter and extract `stages` list if present. */
function parseContextFrontmatter(raw: string): ContextFile {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { stages: null, body: raw };
  const stagesMatch = m[1].match(/^stages:\s*\[([^\]]*)\]/m);
  const body = raw.slice(m[0].length);
  if (!stagesMatch) return { stages: null, body };
  const stages = stagesMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  return { stages, body };
}

/** A file tagged `stages: [story_decomposition]` matches `story_decomposition_F1` etc. */
function stageMatches(fileStages: string[], stage: string): boolean {
  return fileStages.some(s => stage === s || stage.startsWith(s + '_'));
}

/**
 * Invalidate the shared in-memory project context cache.
 * Call after writing any context/*.md file so the next agent request
 * picks up the update without a server restart.
 */
export function invalidateContextCache(): void {
  _contextFilesCache = null;
  _contextByStageCache.clear();
  logger.info('Global project context cache invalidated — will reload on next request');
}

export class SpecialistAgent {
  private agentType: AgentType;
  private model: string;
  private persona: string | null = null;
  private userConfig: Record<string, string> | null = null;
  private isAutonomous = false;

  constructor(agentType: AgentType) {
    this.agentType = agentType;
    this.model = resolveModelId(undefined);
  }

  /** Load the agent persona from disk (agents/personas/{agentType}.md). */
  async loadPersona(stage?: string): Promise<string> {
    if (this.persona) return this.persona;

    const agentFilePath = path.join(AGENTS_ROOT, 'personas', `${this.agentType}.md`);
    logger.info(`Loading persona from disk: ${agentFilePath}`);

    const content = await fs.readFile(agentFilePath, 'utf-8');
    this.persona = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
    logger.info(`Loaded persona for agent type: ${this.agentType}`);

    return this.persona;
  }

  /**
   * Load context/*.md files, filtered by stage if the file declares a `stages` frontmatter key.
   * Files without `stages` are universal and always included.
   * Files with `stages: [a, b]` are only included when the current stage matches one of those keys
   * (prefix-matched, so `story_decomposition` matches `story_decomposition_F1` etc.).
   */
  async loadProjectContext(stage?: string): Promise<string> {
    const cacheKey = stage ?? '*';
    if (_contextByStageCache.has(cacheKey)) return _contextByStageCache.get(cacheKey)!;

    // Load and parse files once; reuse across all stage calls until invalidated.
    if (_contextFilesCache === null) {
      _contextFilesCache = [];
      try {
        const entries = await fs.readdir(CONTEXT_ROOT, { withFileTypes: true });
        const mdFiles = entries.filter(e =>
          e.isFile() &&
          e.name.endsWith('.md') &&
          !e.name.endsWith('.example.md') &&
          e.name.toLowerCase() !== 'readme.md'
        );
        for (const file of mdFiles) {
          const raw = await fs.readFile(path.join(CONTEXT_ROOT, file.name), 'utf-8');
          _contextFilesCache.push(parseContextFrontmatter(raw.trim()));
        }
        logger.info(`Parsed ${mdFiles.length} context file(s) from context/`);
      } catch (error: any) {
        logger.warn(`Could not load project context: ${error.message}`);
      }
    }

    const relevant = _contextFilesCache.filter(f =>
      f.stages === null || (stage !== undefined && stageMatches(f.stages, stage))
    );
    const assembled = relevant.map(f => f.body).join('\n\n');
    _contextByStageCache.set(cacheKey, assembled);
    return assembled;
  }

  /**
   * Build system prompt from persona + optional workflow context.
   *
   * Returns { stable, dynamic } for Anthropic prompt caching:
   *   - stable: persona + project context + workflow steps — large and identical
   *     across all messages in a workflow session. Marked cache_control:ephemeral
   *     so Anthropic caches its KV prefix. Cache hits pay 10% of normal cost.
   *   - dynamic: per-initiative item context — small (~200 tokens) and varies
   *     across sessions so it is intentionally excluded from the cached prefix.
   *
   * Callers pass the result directly to streamResponse(), which threads both
   * parts to the provider-specific streaming function.
   */
  async buildSystemPrompt(persona: string, workflowContext?: string, itemContext?: string, autonomous?: boolean, stage?: string): Promise<SystemPrompt> {
    this.isAutonomous = autonomous ?? false;
    const config = await this.loadUserConfig();
    const userName = config.user_name ?? 'User';
    const language = config.communication_language ?? 'English';
    const skillLevel = config.user_skill_level ?? 'intermediate';

    let stable = autonomous
      ? `You are executing a document-production task as part of an automated workflow.

## Your Persona
${persona}

## Operating Mode
You are running autonomously as part of a coordinator-driven workflow. There is no user interaction.
- Respond with ONLY the deliverable — no greetings, no preamble, no questions, no meta-commentary
- Do not present a menu or ask what the user wants — your task is defined in the message you receive
- Write real, substantive content for the specific topic given — never use placeholder text
- Produce the complete document in one response; do not truncate or defer any section
- Use rich markdown formatting: headings, bullet lists, tables, bold for key terms`
      : `## Your Persona
${persona}

## User Context
- **Name:** ${userName} (address them by name)
- **Communication language:** ${language}
- **Skill level:** ${skillLevel}

## Instructions
Stay in character throughout the conversation. Be helpful, collaborative, and proactive.

## Response Length
Keep conversational responses short and focused to minimise output tokens:
- Open with one sentence acknowledging or summarising what has been decided so far
- Then ask only the single next question or request only the single next piece of information needed
- Do NOT generate full document sections, outlines, or summaries during the conversation — those are produced only at export time when the user explicitly requests them
- Bullet points and short prose only; no padding, no re-stating everything that was already agreed

The full document is assembled at export. Mid-conversation your job is to gather and confirm information efficiently.`;

    // Load shared project context, filtered to files relevant for this stage.
    const projectContext = await this.loadProjectContext(stage);
    if (projectContext) {
      stable += `\n\n## Project & Company Context\nUse this as background for your output. It describes the company, product, and strategy context.\n\n${projectContext}`;
    }

    // Inject the output template for the current stage, read from disk.
    // Stages without a template (critic, curator) skip this.
    if (autonomous && stage && STAGE_TEMPLATE_MAP[stage]) {
      try {
        const templatePath = path.join(TEMPLATES_DIR, STAGE_TEMPLATE_MAP[stage]);
        const templateContent = await fs.readFile(templatePath, 'utf-8');
        stable += `\n\n## Output Template\nFollow this structure for your output:\n\n${templateContent}`;
        logger.info(`Injected output template from disk: ${STAGE_TEMPLATE_MAP[stage]}`);
      } catch {
        logger.warn(`Could not load output template: ${STAGE_TEMPLATE_MAP[stage]}`);
      }
    }

    if (workflowContext) {
      stable += `\n\n## Active Workflow Instructions\nFollow these workflow instructions to guide the conversation:\n\n${workflowContext}`;
    }

    if (this.agentType === 'analyst' && getActiveProvider() === 'anthropic') {
      // Web search is available — enforce strict citation discipline
      stable += `\n\n## Source Citation Requirements
You are producing cited research. Citation accuracy is paramount — a fabricated or mismatched reference is worse than no reference at all and destroys the reader's trust.

**The golden rule: only cite what you actually read in a search result.**
- You may ONLY use a URL as a citation if that URL was returned by a web search you performed in this conversation
- You may ONLY attach a [N] to a claim if that specific fact, figure, or statement appeared in the content of that search result
- Never construct, guess, or paraphrase a URL — use the exact URL the search tool returned
- Never cite a source as supporting a claim unless you can point to the exact passage in that source that contains it

**When sources are unavailable:**
- If no search results confirm a claim, you may still include it using your best available knowledge — but you MUST explicitly label it as an assumption: *"[Assumption]"* or *"Based on general industry knowledge, …"*
- Never fabricate a reference to back up an assumption — uncited claims with an honest caveat are far better than fake citations
- If an entire section lacks verifiable sources, open it with a note: *"No specific sources were found for this section; the following is based on general domain knowledge."*

**Workflow — search first, then write:**
- Before writing each section, run a web search for the specific facts you intend to state
- Write only what your search results actually confirm, supplemented by clearly labelled assumptions where needed
- If search results contradict your expectation, report what the sources say

**Citation format — STRICT, NO EXCEPTIONS:**
- Assign each unique source a sequential number: [1], [2], [3], etc.
- Place the bracketed number inline immediately after the specific claim it supports
- CORRECT: "The global market reached $4.2B in 2024 [1] with 15% CAGR [2]."
- WRONG: "According to source¹..." or "...market (Source: McKinsey)" or "(see footnote)"
- WRONG: inline URLs like "...per https://example.com" — never put URLs in the body text
- The same source reused later keeps its original number: "...as noted above [1]"
- Every paragraph with factual claims must contain at least one [N] reference

**References section — mandatory at the end of every research response:**
  [1] Exact page title or article headline — https://exact-url-returned-by-search
  [2] Exact page title or article headline — https://exact-url-returned-by-search
Every [N] used inline must appear here. Every entry here must be used inline. No orphaned references.

**Anti-hallucination rules:**
- Never fabricate a URL. If your web search returned no results for a topic, do NOT invent a plausible-looking URL.
- Never cite a source you did not actually find via web search in this conversation.
- If no source exists for a claim, mark it: "[Assumption — no source found]" — this is always preferable to a fabricated citation.
- If a web search returns limited results, say so explicitly: "Limited sources available for this topic."
- When in doubt, under-cite rather than over-cite. Three verified references are worth more than ten fabricated ones.`;
    } else if (this.agentType === 'analyst') {
      // No web search available (Bedrock/Ollama) — use prior knowledge, no fake citations
      stable += `\n\n## Source & Citation Policy (No Web Search Available)
You do NOT have access to web search in this session. Do not pretend to search or fabricate URLs.

**Rules:**
- Use your training knowledge to produce substantive, well-reasoned analysis
- Do NOT include a References section with URLs — you have no way to verify them
- Do NOT use [N] inline citation markers pointing to fabricated sources
- Instead of citations, use qualitative attribution where relevant: "Industry analysts generally estimate…", "According to widely reported figures…"
- When a claim is based on your general knowledge and may need verification, mark it: *"[Unverified — recommend manual confirmation]"*
- Be direct and confident about well-established facts; flag speculative or rapidly-changing data points
- Focus on the quality and depth of analysis rather than the appearance of sourcing
- **CRITICAL — OUTPUT ONLY THE DOCUMENT:** Your response must contain ONLY the research brief document itself. Never include any of the following before, within, or after the document:
  - Disclaimers or notes about web search, citations, or sourcing limitations
  - Internal reasoning, self-correction, or revision commentary (e.g. "Let me revise...", "The validation flagged...", "I can reduce some by...")
  - Meta-commentary about the document production process or your own capabilities
  - Any preamble, postamble, or explanation of what you are about to do or just did
  Start your response with the first heading of the research brief and end it with the last line of content.**`;
    }

    if (this.agentType === 'analyst') {
      stable += `\n\n## Output Formatting & Completeness
Your responses have a token ceiling. A document that is cut off is always worse than a complete one.

**Use rich formatting throughout:**
- Use bullet lists and numbered lists wherever items, steps, or options are being described — avoid collapsing list-like content into dense paragraphs
- Use sub-headings (###) to break long sections into scannable parts
- Use **bold** to highlight key terms, findings, and conclusions
- Use tables for comparisons, feature matrices, or structured data
- Paragraphs are for narrative and analysis; lists are for facts, options, and criteria

**Section depth:** Let each section be as long as it needs to be. A complex competitive landscape deserves more space than a simple definition. Do not pad short sections or truncate long ones artificially.

**Mandatory completion order — never deviate from this:**
1. Complete the current section you are writing
2. Continue through all remaining sections at appropriate depth
3. Write the closing summary

**If you are approaching your token limit:** tighten prose in remaining sections but never skip or truncate sections.`;
    }

    // Item context is small (~200 tokens) and changes per initiative, so it goes
    // in the dynamic (uncached) block — keeping the stable prefix identical across
    // sessions that use the same workflow, maximising cache hit rate.
    const dynamic = itemContext ? `## Current Initiative Context\n${itemContext}` : undefined;

    return { stable, dynamic };
  }

  /**
   * Stream a response via the configured AI provider (Anthropic or Bedrock).
   * modelOverride allows per-request model selection without changing the cached agent.
   * system accepts the structured SystemPrompt returned by buildSystemPrompt() so
   * Anthropic prompt caching is applied automatically.
   */
  async *streamResponse(
    system: SystemPrompt,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelOverride?: string,
    onTokens?: (usage: TokenUsage) => void,
    maxOutputTokens?: number,
    tools?: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const model = modelOverride || this.model;
    const webSearch = this.agentType === 'analyst' && getActiveProvider() === 'anthropic';
    const defaultMax = (this.agentType === 'analyst' || this.isAutonomous) ? 12_000 : 8_192;
    const maxTokens = maxOutputTokens ?? defaultMax;
    const hasTools = tools && tools.length > 0;
    logger.info(`Streaming response (${messages.length} messages in history, model: ${model}, webSearch: ${webSearch}, tools: ${hasTools ? tools!.map(t => t.name).join(',') : 'none'}, maxTokens: ${maxTokens})`);

    try {
      yield* streamAI(model, system, messages, maxTokens, { webSearch, onTokens, tools, signal });
      logger.info('Completed streaming response');
    } catch (error: any) {
      // Re-throw abort errors so the caller can detect cancellation
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      logger.error('Failed to stream response', error);
      throw new Error(`Failed to stream response: ${error.message}`);
    }
  }

  /**
   * Invalidate the in-memory project context cache.
   * Call after writing a context file so the next AI message picks up the change.
   */
  clearContextCache(): void {
    _contextFilesCache = null;
    _contextByStageCache.clear();
    logger.info('Project context cache cleared — will reload on next request');
  }

  // --- Private helpers ---

  /**
   * Load user-identity fields from agents/config.yaml.
   * Only reads non-path keys (user_name, communication_language, etc.).
   * If config.yaml is missing, copy config.example.yaml and customise it.
   */
  private async loadUserConfig(): Promise<Record<string, string>> {
    if (this.userConfig) return this.userConfig;

    const USER_KEYS = new Set([
      'user_name', 'communication_language', 'document_output_language',
      'user_skill_level', 'project_name',
    ]);
    const result: Record<string, string> = {};

    try {
      const raw = await fs.readFile(path.join(AGENTS_ROOT, 'config.yaml'), 'utf-8');
      for (const line of raw.split('\n')) {
        const match = line.match(/^(\w+):\s*["']?(.+?)["']?\s*$/);
        if (match && USER_KEYS.has(match[1])) result[match[1]] = match[2];
      }
      logger.info('Loaded user config from agents/config.yaml');
    } catch {
      logger.warn('Could not load agents/config.yaml — using defaults. Copy config.example.yaml to config.yaml to customise.');
    }

    this.userConfig = result;
    return result;
  }

}
