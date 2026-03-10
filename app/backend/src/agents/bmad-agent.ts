import { AgentType, AppMode, BmadPersona } from '@pap/shared';
import { streamAI, resolveModelId, type SystemPrompt, type TokenUsage } from '../utils/ai-provider';
import Logger from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('BMAD-AGENT');

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
  solution_architect:   'architecture.template.md',
  pm_backlog:           'backlog.template.md',
};

/**
 * Module-level shared context cache — all BmadAgent instances read from here.
 * Cleared by invalidateContextCache() so the next AI request reloads from disk.
 */
let _projectContextCache: string | null = null;

/**
 * Invalidate the shared in-memory project context cache.
 * Call after writing any context/*.md file so the next agent request
 * picks up the update without a server restart.
 */
export function invalidateContextCache(): void {
  _projectContextCache = null;
  logger.info('Global project context cache invalidated — will reload on next request');
}

// Mode-to-agent mapping
const MODE_AGENT_MAP: Record<AppMode, AgentType> = {
  prd: 'pm',
  backlog: 'pm',
  analyst: 'analyst',
  architecture: 'architect',
  'decision-log': 'decision-log',
  context: 'context-keeper',
};


export class BmadAgent {
  private agentType: AgentType;
  private model: string;
  private persona: BmadPersona | null = null;
  private userConfig: Record<string, string> | null = null;
  private projectContext: string | null = null;
  private isAutonomous = false;

  constructor(agentType: AgentType) {
    this.agentType = agentType;
    this.model = resolveModelId(undefined);
  }

  static getAgentTypeForMode(mode: AppMode): AgentType {
    return MODE_AGENT_MAP[mode];
  }

  /**
   * Load and parse the agent persona from the BMAD markdown file
   */
  async loadPersona(): Promise<BmadPersona> {
    if (this.persona) return this.persona;

    const agentFilePath = path.join(AGENTS_ROOT, 'personas', `${this.agentType}.md`);
    logger.info(`Loading persona from: ${agentFilePath}`);

    const content = await fs.readFile(agentFilePath, 'utf-8');

    // Extract XML agent block
    const xmlMatch = content.match(/<agent[^>]*>([\s\S]*?)<\/agent>/);
    if (!xmlMatch) {
      throw new Error(`Failed to parse agent XML from ${agentFilePath}`);
    }

    const agentTag = content.match(/<agent([^>]*)>/);
    const attrs = agentTag?.[1] || '';

    // Parse agent tag attributes
    const name = this.extractAttr(attrs, 'name') || 'Agent';
    const backlogName = this.extractAttr(attrs, 'backlog-name') || undefined;
    const title = this.extractAttr(attrs, 'title') || 'AI Agent';
    const icon = this.extractAttr(attrs, 'icon') || '🤖';

    // Parse persona XML tags
    const xmlContent = xmlMatch[1];
    const role = this.extractXmlTag(xmlContent, 'role') || '';
    const identity = this.extractXmlTag(xmlContent, 'identity') || '';
    const communicationStyle = this.extractXmlTag(xmlContent, 'communication_style') || '';
    const principles = this.extractXmlTag(xmlContent, 'principles') || '';

    this.persona = { name, backlogName, title, icon, role, identity, communicationStyle, principles };
    logger.info(`Loaded persona: ${name} (${title})`);

    return this.persona;
  }

  /**
   * Load all markdown files from the context/ directory
   */
  async loadProjectContext(): Promise<string> {
    if (_projectContextCache !== null) return _projectContextCache;

    try {
      const entries = await fs.readdir(CONTEXT_ROOT, { withFileTypes: true });
      const mdFiles = entries.filter(e =>
        e.isFile() &&
        e.name.endsWith('.md') &&
        !e.name.endsWith('.example.md') &&
        e.name.toLowerCase() !== 'readme.md'
      );

      if (mdFiles.length === 0) {
        _projectContextCache = '';
        return '';
      }

      const contents: string[] = [];
      for (const file of mdFiles) {
        const filePath = path.join(CONTEXT_ROOT, file.name);
        const content = await fs.readFile(filePath, 'utf-8');
        contents.push(content.trim());
      }

      _projectContextCache = contents.join('\n\n');
      this.projectContext = _projectContextCache; // keep instance field in sync
      logger.info(`Loaded project context from ${mdFiles.length} file(s) in context/`);
    } catch (error: any) {
      logger.warn(`Could not load project context: ${error.message}`);
      _projectContextCache = '';
    }

    return _projectContextCache;
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
  async buildSystemPrompt(persona: BmadPersona, workflowContext?: string, itemContext?: string, autonomous?: boolean, stage?: string): Promise<SystemPrompt> {
    this.isAutonomous = autonomous ?? false;
    const config = await this.loadUserConfig();
    const userName = config.user_name ?? 'User';
    const language = config.communication_language ?? 'English';
    const skillLevel = config.user_skill_level ?? 'intermediate';

    let stable = autonomous
      ? `You are a specialist ${persona.title} executing a document-production task.

## Expertise
- **Role:** ${persona.role}
- **Specialisation:** ${persona.identity}
- **Principles:** ${persona.principles}

## Operating Mode
You are running autonomously as part of a coordinator-driven workflow. There is no user interaction.
- Respond with ONLY the deliverable — no greetings, no preamble, no questions, no meta-commentary
- Do not present a menu or ask what the user wants — your task is defined in the message you receive
- Write real, substantive content for the specific topic given — never use placeholder text
- Produce the complete document in one response; do not truncate or defer any section
- Use rich markdown formatting: headings, bullet lists, tables, bold for key terms`
      : `You are ${persona.name}, a ${persona.title}.

## User Context
- **Name:** ${userName} (address them by name)
- **Communication language:** ${language}
- **Skill level:** ${skillLevel}

## Your Persona
- **Role:** ${persona.role}
- **Identity:** ${persona.identity}
- **Communication Style:** ${persona.communicationStyle}
- **Principles:** ${persona.principles}

## Instructions
Stay in character as ${persona.name} throughout the conversation. Be helpful, collaborative, and proactive. Use your communication style consistently.

## Response Length
Keep conversational responses short and focused to minimise output tokens:
- Open with one sentence acknowledging or summarising what has been decided so far
- Then ask only the single next question or request only the single next piece of information needed
- Do NOT generate full document sections, outlines, or summaries during the conversation — those are produced only at export time when the user explicitly requests them
- Bullet points and short prose only; no padding, no re-stating everything that was already agreed

The full document is assembled at export. Mid-conversation your job is to gather and confirm information efficiently.`;

    // Load shared project context (company info, etc.)
    const projectContext = await this.loadProjectContext();
    if (projectContext) {
      stable += `\n\n## Project & Company Context\nUse this as background for your output. It describes the company, product, and strategy context.\n\n${projectContext}`;
    }

    // Inject the output template for the current stage (coordinator flow only).
    // Only the relevant template is loaded — e.g. analyst gets research.template.md,
    // pm_prd gets prd.template.md. Stages without a template (critic, curator) skip this.
    if (autonomous && stage && STAGE_TEMPLATE_MAP[stage]) {
      try {
        const templatePath = path.join(TEMPLATES_DIR, STAGE_TEMPLATE_MAP[stage]);
        const templateContent = await fs.readFile(templatePath, 'utf-8');
        stable += `\n\n## Output Template\nFollow this structure for your output:\n\n${templateContent}`;
        logger.info(`Injected output template: ${STAGE_TEMPLATE_MAP[stage]}`);
      } catch {
        logger.warn(`Could not load output template: ${STAGE_TEMPLATE_MAP[stage]}`);
      }
    }

    if (workflowContext) {
      stable += `\n\n## Active Workflow Instructions\nFollow these workflow instructions to guide the conversation:\n\n${workflowContext}`;
    }

    if (this.agentType === 'analyst') {
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

**Citation format:**
- Assign each unique source a number starting at [1], incrementing for each new source
- Place the number inline immediately after the specific claim it supports: "Figma holds ~75% of the design tool market [1]"
- The same source reused later keeps its original number

**References section — mandatory at the end of every research response:**
  [1] Exact page title or article headline — https://exact-url-returned-by-search
  [2] Exact page title or article headline — https://exact-url-returned-by-search
Every [N] used inline must appear here. Every entry here must be used inline.

**Never fabricate a reference.** If no source exists, state the claim as an assumption. An honest report with clearly labelled assumptions is always better than one with invented citations.

## Output Formatting & Completeness
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
3. ⚠️ Write the COMPLETE ## References section — every source, no omissions
4. Write the closing summary

**If you are approaching your token limit:** tighten prose in remaining sections, but never skip the References section. An incomplete References section is a critical failure.`;
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
    onTokens?: (usage: TokenUsage) => void
  ): AsyncGenerator<string, void, unknown> {
    const model = modelOverride || this.model;
    const webSearch = this.agentType === 'analyst';
    // Autonomous mode always needs full document output — use the same ceiling as analyst.
    // ai-provider caps this to the actual model limit so no API error is thrown.
    const maxTokens = (this.agentType === 'analyst' || this.isAutonomous) ? 32_000 : 8_192;
    logger.info(`Streaming response (${messages.length} messages in history, model: ${model}, webSearch: ${webSearch}, maxTokens: ${maxTokens})`);

    try {
      yield* streamAI(model, system, messages, maxTokens, { webSearch, onTokens });
      logger.info('Completed streaming response');
    } catch (error: any) {
      logger.error('Failed to stream response', error);
      throw new Error(`Failed to stream response: ${error.message}`);
    }
  }

  /**
   * Invalidate the in-memory project context cache.
   * Call after writing a context file so the next AI message picks up the change.
   */
  clearContextCache(): void {
    this.projectContext = null;
    _projectContextCache = null;
    logger.info('Project context cache cleared — will reload on next request');
  }

  // --- Private helpers ---

  /**
   * Load user-identity fields from _bmad/bmm/config.yaml.
   * Only reads non-path keys (user_name, communication_language, etc.).
   * Path variables like {planning_artifacts} are intentionally left unresolved
   * because this app manages artifact output via DB + data/sessions/ — not _bmad-output/.
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
      logger.warn('Could not load agents/config.yaml — using defaults');
    }

    this.userConfig = result;
    return result;
  }

  private extractAttr(attrString: string, name: string): string | null {
    const match = attrString.match(new RegExp(`${name}="([^"]*)"`));
    return match ? match[1] : null;
  }

  private extractXmlTag(content: string, tagName: string): string | null {
    const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
    return match ? match[1].trim() : null;
  }

}
