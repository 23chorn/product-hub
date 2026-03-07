import { AgentType, AppMode, BmadPersona, BmadMenuItem } from '@pap/shared';
import { streamAI, resolveModelId, type SystemPrompt } from '../utils/ai-provider';
import Logger from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('BMAD-AGENT');

// Project root is three levels up from app/backend/src/agents/
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');
const CONTEXT_ROOT = path.join(PROJECT_ROOT, 'context');

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
  'decision-log': 'decision-log',
  context: 'context-keeper',
};

// Menu items filtered by mode
const MODE_MENU_CODES: Record<AppMode, string[]> = {
  prd: ['CP', 'VP', 'EP', 'CH'],
  backlog: ['CE', 'IR', 'CH'],
  analyst: ['BP', 'MR', 'DR', 'TR', 'CB', 'CH'],
  'decision-log': ['CH', 'SD'],
  context: ['RV', 'CH'],
};

// Ad-hoc backlog mode shows Quick Tickets instead of full CE/IR workflows
const ADHOC_BACKLOG_MENU_CODES = ['QT', 'CH'];

export class BmadAgent {
  private agentType: AgentType;
  private model: string;
  private persona: BmadPersona | null = null;
  private allMenuItems: BmadMenuItem[] = [];
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

    // Parse menu items
    this.allMenuItems = this.parseMenuItems(xmlContent);

    this.persona = { name, backlogName, title, icon, role, identity, communicationStyle, principles };
    logger.info(`Loaded persona: ${name} (${title}) with ${this.allMenuItems.length} menu items`);

    return this.persona;
  }

  /**
   * Get filtered menu items for a specific mode
   */
  getMenuForMode(mode: AppMode, adHoc = false): BmadMenuItem[] {
    const allowedCodes = (adHoc && mode === 'backlog')
      ? ADHOC_BACKLOG_MENU_CODES
      : MODE_MENU_CODES[mode];
    return this.allMenuItems.filter(item => allowedCodes.includes(item.code));
  }

  /**
   * Load workflow markdown file content, with all step files inlined.
   *
   * BMAD workflows use a "step-file architecture" where each step is a separate
   * markdown file. Originally the LLM loaded them one at a time from disk, but
   * this backend runs the LLM as a pure API call with no file tools. Instead,
   * we pre-load all relevant step files and inline them so the LLM has the full
   * workflow in context. The LLM still follows the steps sequentially — it just
   * doesn't need to load them itself.
   *
   * Template files (*.template.md) are intentionally excluded — those are output
   * structure references that live in templates/ at the project root.
   */
  async loadWorkflowPrompt(workflowPath: string): Promise<string> {
    // Resolve {project-root} placeholder
    const resolvedPath = workflowPath.replace('{project-root}', PROJECT_ROOT);
    // Also handle relative paths from agents/
    const fullPath = path.isAbsolute(resolvedPath)
      ? resolvedPath
      : path.join(AGENTS_ROOT, resolvedPath);

    logger.info(`Loading workflow from: ${fullPath}`);

    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const workflowDir = path.dirname(fullPath);

      // Find the step directory this workflow uses (from frontmatter or first step reference)
      const stepDir = this.resolveStepDir(workflowDir, raw);
      const stepContent = stepDir ? await this.loadStepFiles(stepDir) : '';

      const preamble = stepContent
        ? `\n\n> **Note:** All workflow step files have been pre-loaded below. ` +
          `Treat each step section as if you just loaded that file — ` +
          `follow them sequentially, one at a time, waiting for user input between steps as instructed.`
        : '';

      const config = await this.loadUserConfig();
      return this.substituteUserVars(raw + preamble + stepContent, config);
    } catch (error: any) {
      logger.error(`Failed to load workflow: ${fullPath}`, error);
      throw new Error(`Workflow file not found: ${fullPath}`);
    }
  }

  /**
   * Determine which step subdirectory a workflow uses.
   * Handles four reference patterns found across BMAD workflows:
   *   1. Frontmatter field:  nextStep/validateWorkflow/editWorkflow: './steps-c/step-01.md'
   *   2. {project-root} path in content: {project-root}/.../steps/step-01.md
   *   3. Backtick inline ref: `./market-steps/step-01-init.md`
   *   4. Same-dir ref (no subdir): `./step-01-document-discovery.md`
   * Returns the absolute path to the step directory, or null if none found.
   */
  private resolveStepDir(workflowDir: string, content: string): string | null {
    // 1. Any frontmatter field pointing to a step file in a subdirectory
    //    e.g. nextStep: './steps-c/step-01-init.md'
    //         validateWorkflow: './steps-v/step-v-01-discovery.md'
    const frontmatterMatch = content.match(/:\s*['"]?\.\/([^/\s'"]+)\/step-/m);
    if (frontmatterMatch) {
      return path.join(workflowDir, frontmatterMatch[1]);
    }

    // 2. Full {project-root} path in content body
    //    e.g. `{project-root}/_bmad/.../steps/step-01-validate-prerequisites.md`
    const projectRootMatch = content.match(/\{project-root\}[^`\s]+\/([\w-]*steps[\w-]*)\/step-0/);
    if (projectRootMatch) {
      return path.join(workflowDir, projectRootMatch[1]);
    }

    // 3. Backtick inline ref with a subdirectory
    //    e.g. `./market-steps/step-01-init.md`
    const inlineMatch = content.match(/`\.\/([^/`]+)\/step-0/);
    if (inlineMatch) {
      return path.join(workflowDir, inlineMatch[1]);
    }

    // 4. Step files live directly in the workflow directory (no subdir)
    //    e.g. `./step-01-document-discovery.md`
    const samedirMatch = content.match(/`\.\/step-0/);
    if (samedirMatch) {
      return workflowDir;
    }

    return null;
  }

  /**
   * Load all step markdown files from a directory in sorted order,
   * and also any output templates from an adjacent templates/ directory.
   * Templates are included so the LLM knows the required output structure.
   */
  private async loadStepFiles(stepDir: string): Promise<string> {
    const parts: string[] = [];

    // Step instruction files
    try {
      const files = (await fs.readdir(stepDir))
        .filter(f => f.endsWith('.md'))
        .sort();

      if (files.length > 0) {
        logger.info(`Inlining ${files.length} step files from: ${stepDir}`);
        for (const file of files) {
          const content = await fs.readFile(path.join(stepDir, file), 'utf-8');
          parts.push(`\n\n---\n\n### Step file: ${file}\n\n${content}`);
        }
      }
    } catch {
      logger.warn(`Could not load step files from: ${stepDir}`);
    }

    // Output templates from centralised agents/templates/ directory
    const templatesDir = path.join(AGENTS_ROOT, 'templates');
    try {
      const templateFiles = (await fs.readdir(templatesDir))
        .filter(f => f.endsWith('.md'))
        .sort();

      if (templateFiles.length > 0) {
        logger.info(`Inlining ${templateFiles.length} output template(s) from: ${templatesDir}`);
        for (const file of templateFiles) {
          const content = await fs.readFile(path.join(templatesDir, file), 'utf-8');
          parts.push(`\n\n---\n\n### Output template: ${file}\n\n${content}`);
        }
      }
    } catch {
      // No templates/ directory — that's fine
    }

    return parts.join('');
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
  async buildSystemPrompt(persona: BmadPersona, workflowContext?: string, itemContext?: string, autonomous?: boolean): Promise<SystemPrompt> {
    this.isAutonomous = autonomous ?? false;
    const config = await this.loadUserConfig();
    const userName = config.user_name ?? 'User';
    const language = config.communication_language ?? 'English';
    const skillLevel = config.user_skill_level ?? 'intermediate';

    let stable = `You are ${persona.name}, a ${persona.title}.

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

${ autonomous
  ? `## Output Mode: Autonomous Single-Shot
You are running autonomously — no user interaction occurs. Produce the complete, final deliverable immediately:
- Write the full document in one response — do not hold back, ask questions, or split into steps
- Follow the structure defined in your workflow instructions precisely
- Make reasonable assumptions for any ambiguous details; note assumptions briefly at the top if needed
- Use rich formatting: headings, bullet lists, tables, bold for key terms
- Your response IS the deliverable — do not add preamble or closing meta-commentary`
  : `## Response Length
Keep conversational responses short and focused to minimise output tokens:
- Open with one sentence acknowledging or summarising what has been decided so far
- Then ask only the single next question or request only the single next piece of information needed
- Do NOT generate full document sections, outlines, or summaries during the conversation — those are produced only at export time when the user explicitly requests them
- Bullet points and short prose only; no padding, no re-stating everything that was already agreed

The full document is assembled at export. Mid-conversation your job is to gather and confirm information efficiently.`
}`;

    // Load shared project context (company info, etc.)
    const projectContext = await this.loadProjectContext();
    if (projectContext) {
      stable += `\n\n## Project & Company Context\nUse this background knowledge in all conversations. Do not ask the user to repeat information covered here.\n\n${projectContext}`;
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
- If you cannot find a real search result that confirms a claim, do not make the claim

**Workflow — search first, then write:**
- Before writing each section, run a web search for the specific facts you intend to state
- Write only what your search results actually confirm
- If search results contradict your expectation, report what the sources say

**Citation format:**
- Assign each unique source a number starting at [1], incrementing for each new source
- Place the number inline immediately after the specific claim it supports: "Figma holds ~75% of the design tool market [1]"
- The same source reused later keeps its original number

**References section — mandatory at the end of every research response:**
  [1] Exact page title or article headline — https://exact-url-returned-by-search
  [2] Exact page title or article headline — https://exact-url-returned-by-search
Every [N] used inline must appear here. Every entry here must be used inline.

**If you cannot find a verifiable source for a claim, omit the claim.** An accurate report with fewer facts is always better than a comprehensive report with invented or mismatched citations.

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
    modelOverride?: string
  ): AsyncGenerator<string, void, unknown> {
    const model = modelOverride || this.model;
    const webSearch = this.agentType === 'analyst';
    // Autonomous mode always needs full document output — use the same ceiling as analyst.
    // ai-provider caps this to the actual model limit so no API error is thrown.
    const maxTokens = (this.agentType === 'analyst' || this.isAutonomous) ? 32_000 : 8_192;
    logger.info(`Streaming response (${messages.length} messages in history, model: ${model}, webSearch: ${webSearch}, maxTokens: ${maxTokens})`);

    try {
      yield* streamAI(model, system, messages, maxTokens, { webSearch });
      logger.info('Completed streaming response');
    } catch (error: any) {
      logger.error('Failed to stream response', error);
      throw new Error(`Failed to stream response: ${error.message}`);
    }
  }

  /**
   * Trim step files out of a workflow context string once the conversation is
   * deep enough that the model no longer needs them as a reference.
   *
   * The full workflow (overview + all step files) is needed at the start so the
   * model knows the complete process. After ~12 messages the history itself
   * carries that knowledge, and retaining 3-5 k tokens of step instructions
   * just burns input-token budget.
   *
   * The step block starts with the preamble note injected by loadWorkflowPrompt.
   * Everything from that marker onwards is dropped; the workflow overview header
   * (typically a few hundred tokens) is kept so the model still knows its role.
   */
  trimWorkflowContext(workflowContext: string, messageCount: number): string {
    const TRIM_AFTER_MESSAGES = 12;
    if (messageCount < TRIM_AFTER_MESSAGES) return workflowContext;

    const stepMarker = '> **Note:** All workflow step files have been pre-loaded below.';
    const markerIdx = workflowContext.indexOf(stepMarker);
    if (markerIdx === -1) return workflowContext; // no step block — nothing to trim

    const trimmed = workflowContext.slice(0, markerIdx).trimEnd();
    logger.info(`Trimmed step files from workflow context (${messageCount} messages in session)`);
    return trimmed;
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

  /**
   * Generate an agent greeting message
   */
  generateGreeting(persona: BmadPersona, mode: AppMode, adHoc = false): string {
    const displayName = (mode === 'backlog' && persona.backlogName) ? persona.backlogName : persona.name;

    if (adHoc && mode === 'backlog') {
      return `${persona.icon} Hi! I'm **${displayName}**, your ${persona.title}. I'm ready to help you create **quick tickets** — describe a feature and I'll help break it into epics and stories. No PRD or docs needed.\n\nSelect **Quick Tickets** below to get started, or choose **Chat** to discuss anything freely.`;
    }

    const modeDescriptions: Record<AppMode, string> = {
      prd: 'PRD creation and refinement',
      backlog: 'backlog creation with epics and stories',
      analyst: 'research and analysis',
      'decision-log': 'decision logging',
      context: 'context document maintenance',
    };

    return `${persona.icon} Hi! I'm **${displayName}**, your ${persona.title}. I'm here to help you with **${modeDescriptions[mode]}**.\n\nSelect a workflow from the menu below to get started, or choose **Chat** to discuss anything freely.`;
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

  /**
   * Substitute user config variables in content.
   * Only replaces keys present in the config map — unknown placeholders
   * like {planning_artifacts} are left as-is.
   */
  private substituteUserVars(content: string, config: Record<string, string>): string {
    return content.replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(config, key) ? config[key] : match
    );
  }

  private extractAttr(attrString: string, name: string): string | null {
    const match = attrString.match(new RegExp(`${name}="([^"]*)"`));
    return match ? match[1] : null;
  }

  private extractXmlTag(content: string, tagName: string): string | null {
    const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
    return match ? match[1].trim() : null;
  }

  private parseMenuItems(xmlContent: string): BmadMenuItem[] {
    const items: BmadMenuItem[] = [];
    const menuMatch = xmlContent.match(/<menu>([\s\S]*?)<\/menu>/);
    if (!menuMatch) return items;

    const menuContent = menuMatch[1];
    // Match each <item> tag
    const itemRegex = /<item\s+cmd="([^"]*)"([^>]*)>\s*\[([A-Z]+)\]\s*(.*?)\s*<\/item>/g;
    let match;

    while ((match = itemRegex.exec(menuContent)) !== null) {
      const otherAttrs = match[2];
      const code = match[3];
      const fullText = match[4].trim();

      // Extract label (before colon) and description (after colon)
      const colonIndex = fullText.indexOf(':');
      const label = colonIndex > -1 ? fullText.substring(0, colonIndex).trim() : fullText;
      const description = colonIndex > -1 ? fullText.substring(colonIndex + 1).trim() : '';

      // Extract exec or workflow path
      let workflowPath: string | undefined;
      const execMatch = otherAttrs.match(/exec="([^"]*)"/);
      const workflowMatch = otherAttrs.match(/workflow="([^"]*)"/);
      if (execMatch) {
        workflowPath = execMatch[1];
      } else if (workflowMatch) {
        workflowPath = workflowMatch[1];
      }

      // Skip MH (menu help), DA (dismiss agent), PM (party mode)
      if (['MH', 'DA', 'PM'].includes(code)) continue;

      items.push({ code, label, description, workflowPath });
    }

    return items;
  }
}
