import { Router, Request, Response } from 'express';
import { AppMode, BacklogStructure, BmadAgentInfoResponse, BmadStartResponse, PublishBacklogResponse } from '@pap/shared';
import { sessionManager } from '../session/session-manager';
import { BmadAgent } from '../agents/bmad-agent';
import { getOrCreateAgent } from '../agents/agent-cache';
import { AirtableClient } from '../integrations/airtable';
import { AzureDevOpsClient } from '../integrations/azure-devops';
import { isValidModelId } from '../utils/ai-provider';
import fs from 'fs';
import path from 'path';
import {
  writeConversationLog,
  appendMessage,
  deleteSessionFiles,
  saveArtifact,
  SESSIONS_DIR,
} from '../data/conversation-writer';
import Logger from '../utils/logger';

const logger = new Logger('BMAD-ROUTES');
const router = Router();

let airtableClient: AirtableClient;

function getAirtableClient() {
  if (!airtableClient) {
    airtableClient = new AirtableClient();
  }
  return airtableClient;
}

/**
 * Returns true for quick_add items.
 * Used to skip Airtable context loading for ad-hoc sessions.
 */
function isAdHocItem(itemId: string): boolean {
  if (!itemId) return false;
  return sessionManager.getItemSource(itemId) === 'quick_add';
}

/**
 * Get item title for conversation logs.
 * Quick-add items return their stored title; Airtable items fetch from the API.
 */
async function getItemTitle(itemId: string): Promise<string> {
  if (!itemId) return 'Quick Session';
  const source = sessionManager.getItemSource(itemId);
  if (source === 'quick_add') {
    // Title is stored in the items table (e.g. "Quick 1")
    const items = sessionManager.getQuickItems();
    return items.find(i => i.id === itemId)?.title ?? 'Quick Session';
  }
  if (source === 'local') {
    // Title is stored directly in items table
    const row = sessionManager.getItemTitle(itemId);
    return row ?? 'Local Initiative';
  }
  try {
    const client = getAirtableClient();
    const item = await client.getItem(itemId);
    return item.initiative;
  } catch {
    return 'Unknown Initiative';
  }
}

/**
 * If the item has an exported PRD artifact, return its content for injection
 * into the backlog agent's system prompt. Returns null if none exists or on error.
 */
function loadPrdArtifactForItem(itemId: string): string | null {
  const filePath = sessionManager.getLatestPrdArtifactPath(itemId);
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    logger.warn(`Could not read PRD artifact at ${filePath}`);
    return null;
  }
}

/**
 * If the item has an exported analyst research report, return its content for
 * injection into the PRD agent's system prompt. Returns null if none exists or on error.
 */
function loadAnalystArtifactForItem(itemId: string): string | null {
  const filePath = sessionManager.getLatestAnalystArtifactPath(itemId);
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    logger.warn(`Could not read analyst artifact at ${filePath}`);
    return null;
  }
}

/**
 * GET /api/bmad/agent-info
 * Get agent persona, menu, and greeting for a mode WITHOUT creating a session.
 * Also checks for an existing active session to resume.
 */
router.get('/agent-info', async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as AppMode;
    const itemId = req.query.itemId as string;

    if (!mode || !['prd', 'backlog', 'analyst'].includes(mode)) {
      return res.status(400).json({ error: 'Valid mode query param is required (prd, backlog, analyst)' });
    }
    if (!itemId) {
      return res.status(400).json({ error: 'itemId query param is required' });
    }

    const agentType = BmadAgent.getAgentTypeForMode(mode);
    const agent = await getOrCreateAgent(agentType);
    const persona = await agent.loadPersona();
    const adHoc = isAdHocItem(itemId);
    const menu = agent.getMenuForMode(mode, adHoc);
    const greeting = agent.generateGreeting(persona, mode, adHoc);

    // Check for existing active session
    const existingSession = sessionManager.findActiveSession(itemId, mode);

    const response: BmadAgentInfoResponse = {
      agentName: (mode === 'backlog' && persona.backlogName) ? persona.backlogName : persona.name,
      agentIcon: persona.icon,
      agentTitle: persona.title,
      menu,
      greeting,
    };

    if (existingSession) {
      logger.info(`Found existing session for agent-info: ${existingSession.id} (${existingSession.messages.length} messages)`);

      // Load the latest artifact content if one exists
      const artifacts = sessionManager.getArtifacts(existingSession.id);
      let latestArtifactContent: string | undefined;
      if (artifacts.length > 0) {
        const latest = artifacts[0]; // Already sorted by created_at DESC
        try {
          latestArtifactContent = fs.readFileSync(latest.filePath, 'utf-8');
        } catch (err: any) {
          logger.warn(`Could not read artifact file: ${latest.filePath} - ${err.message}`);
        }
      }

      response.existingSession = {
        sessionId: existingSession.id,
        messages: existingSession.messages,
        activeWorkflow: existingSession.activeWorkflow || null,
        latestArtifact: latestArtifactContent || undefined,
      };
    }

    res.json(response);
  } catch (error: any) {
    logger.error('Failed to get agent info', error);
    res.status(500).json({ error: error.message || 'Failed to get agent info' });
  }
});

/**
 * POST /api/bmad/start
 * Start or resume a session with a BMAD agent
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { mode, itemId }: { mode: AppMode; itemId?: string } = req.body;

    if (!mode || !['prd', 'backlog', 'analyst'].includes(mode)) {
      return res.status(400).json({ error: 'Valid mode is required (prd, backlog, analyst)' });
    }

    const effectiveItemId = itemId || '';

    if (!effectiveItemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    logger.info(`Starting/resuming BMAD session: mode=${mode}, itemId=${effectiveItemId}`);

    const agentType = BmadAgent.getAgentTypeForMode(mode);
    const agent = await getOrCreateAgent(agentType);
    const persona = await agent.loadPersona();
    const adHoc = isAdHocItem(effectiveItemId);

    // Check for existing active session to resume
    const existingSession = sessionManager.findActiveSession(effectiveItemId, mode);

    if (existingSession) {
      logger.info(`Resuming existing session: ${existingSession.id} (${existingSession.messages.length} messages)`);

      // Rebuild conversation.md if it was deleted (e.g. data/ dir wiped while DB survived)
      const convPath = existingSession.conversationPath;
      if (convPath && !fs.existsSync(convPath)) {
        logger.warn(`Conversation file missing, rebuilding: ${convPath}`);
        const itemTitle = await getItemTitle(effectiveItemId);
        writeConversationLog(
          effectiveItemId, mode, existingSession.id,
          persona.name, persona.icon, itemTitle,
          existingSession.messages
        );
      }

      const menu = agent.getMenuForMode(mode, adHoc);

      const response: BmadStartResponse & { resumed: boolean; messages: any[]; activeWorkflow: string | null } = {
        sessionId: existingSession.id,
        agentName: (mode === 'backlog' && persona.backlogName) ? persona.backlogName : persona.name,
        agentIcon: persona.icon,
        agentTitle: persona.title,
        menu,
        greeting: '', // No new greeting on resume
        resumed: true,
        messages: existingSession.messages,
        activeWorkflow: existingSession.activeWorkflow || null,
      };

      return res.json(response);
    }

    // Create new session
    const session = sessionManager.createBmadSession(effectiveItemId, mode, agentType);

    // Get filtered menu for this mode
    const menu = agent.getMenuForMode(mode, adHoc);

    // Generate greeting
    const greeting = agent.generateGreeting(persona, mode, adHoc);

    // Store greeting as first assistant message
    sessionManager.addMessage(session.id, 'assistant', greeting);

    // Write initial conversation markdown
    const itemTitle = await getItemTitle(effectiveItemId);
    const convPath = writeConversationLog(
      effectiveItemId, mode, session.id,
      persona.name, persona.icon, itemTitle,
      [{ role: 'assistant', content: greeting, timestamp: Date.now() }]
    );
    sessionManager.updateConversationPath(session.id, convPath);

    const response: BmadStartResponse & { resumed: boolean } = {
      sessionId: session.id,
      agentName: (mode === 'backlog' && persona.backlogName) ? persona.backlogName : persona.name,
      agentIcon: persona.icon,
      agentTitle: persona.title,
      menu,
      greeting,
      resumed: false,
    };

    logger.info(`Created new BMAD session: ${session.id} (${persona.name} - ${mode} mode)`);
    res.json(response);
  } catch (error: any) {
    logger.error('Failed to start BMAD session', error);
    res.status(500).json({ error: error.message || 'Failed to start BMAD session' });
  }
});

/**
 * POST /api/bmad/menu-select
 * User selected a menu item
 */
router.post('/menu-select', async (req: Request, res: Response) => {
  try {
    const { sessionId, menuCode }: { sessionId: string; menuCode: string } = req.body;
    let { model }: { model?: string } = req.body;

    if (!sessionId || !menuCode) {
      return res.status(400).json({ error: 'sessionId and menuCode are required' });
    }

    if (model && !isValidModelId(model)) {
      logger.warn(`Unknown model "${model}" for active provider — using provider default`);
      model = undefined;
    }

    logger.info(`Menu selection: session=${sessionId}, code=${menuCode}`);

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Handle "Chat" selection
    if (menuCode === 'CH') {
      sessionManager.updateWorkflow(sessionId, undefined, undefined);
      return res.json({ type: 'chat' });
    }

    // Get the agent and find the menu item
    const agentType = session.agentType || 'pm';
    const agent = await getOrCreateAgent(agentType);
    const mode = session.mode || 'prd';
    const adHoc = isAdHocItem(session.itemId || '');
    const menu = agent.getMenuForMode(mode, adHoc);
    const menuItem = menu.find(item => item.code === menuCode);

    if (!menuItem) {
      return res.status(400).json({ error: `Invalid menu code: ${menuCode}` });
    }

    if (!menuItem.workflowPath) {
      sessionManager.updateWorkflow(sessionId, menuCode, undefined);
      return res.json({ type: 'chat' });
    }

    // Load workflow file
    const workflowContent = await agent.loadWorkflowPrompt(menuItem.workflowPath);
    sessionManager.updateWorkflow(sessionId, menuCode, workflowContent);

    // Build item context if we have an Airtable item (not ad-hoc)
    let itemContext: string | undefined;
    if (session.itemId && !isAdHocItem(session.itemId)) {
      try {
        const client = getAirtableClient();
        const item = await client.getItem(session.itemId);
        itemContext = `**Initiative:** ${item.initiative}\n**Description:** ${item.description || 'N/A'}\n**Business Value:** ${item.businessValue}/10\n**Estimate:** ${item.estimate}\n**Product Area:** ${item.productArea || 'N/A'}\n**Strategic Theme:** ${item.strategicTheme || 'N/A'}`;
      } catch (err: any) {
        logger.warn(`Could not load item context: ${err.message}`);
      }

      // For PRD mode, inject the analyst research report if one has been exported
      if (mode === 'prd') {
        const analystContent = loadAnalystArtifactForItem(session.itemId);
        if (analystContent) {
          itemContext = (itemContext ? itemContext + '\n\n' : '') +
            `**Research Report (use this as background context for the PRD):**\n\n${analystContent}`;
          logger.info(`Injected analyst artifact into PRD context for item ${session.itemId}`);
        }
      }

      // For backlog mode, inject the existing PRD if one has been exported
      if (mode === 'backlog') {
        const prdContent = loadPrdArtifactForItem(session.itemId);
        if (prdContent) {
          itemContext = (itemContext ? itemContext + '\n\n' : '') +
            `**PRD Document (use this as the source of requirements):**\n\n${prdContent}`;
          logger.info(`Injected PRD artifact into backlog context for item ${session.itemId}`);
        }
      }
    }

    // Build system prompt and generate initial response via streaming
    const persona = await agent.loadPersona();
    const systemPrompt = await agent.buildSystemPrompt(persona, workflowContent, itemContext);

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Add a user message to trigger the workflow
    const triggerMessage = `I'd like to start the "${menuItem.label}" workflow.${itemContext ? `\n\nHere is the initiative context:\n${itemContext}` : ''} Please begin.`;
    sessionManager.addMessage(sessionId, 'user', triggerMessage);
    appendMessage(session.itemId, mode, 'user', triggerMessage, persona.name, persona.icon);

    let fullResponse = '';

    try {
      // Reload messages from DB — filter to user/assistant only (system role stays in system prompt)
      const messages = sessionManager.getMessages(sessionId)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const stream = agent.streamResponse(systemPrompt, messages, model);

      for await (const chunk of stream) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }

      // Store assistant response
      sessionManager.addMessage(sessionId, 'assistant', fullResponse);
      appendMessage(session.itemId, mode, 'assistant', fullResponse, persona.name, persona.icon);

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();

      logger.info(`Completed workflow start for session: ${sessionId}`);
    } catch (streamError: any) {
      logger.error('Failed to stream workflow response', streamError);
      res.write(`data: ${JSON.stringify({ type: 'error', error: streamError.message })}\n\n`);
      res.end();
    }
  } catch (error: any) {
    logger.error('Failed to process menu selection', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to process menu selection' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  }
});

/**
 * POST /api/bmad/message
 * Send a chat message (SSE streaming)
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { sessionId, message, skipHistory }: { sessionId: string; message: string; skipHistory?: boolean } = req.body;
    let { model }: { model?: string } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    if (model && !isValidModelId(model)) {
      logger.warn(`Unknown model "${model}" for active provider — using provider default`);
      model = undefined;
    }

    logger.info(`Processing BMAD message for session: ${sessionId}`);

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const agentType = session.agentType || 'pm';
    const agent = await getOrCreateAgent(agentType);
    const persona = await agent.loadPersona();
    const mode = session.mode || 'prd';

    // Message count before storing the current message — used for trimming decisions below.
    const priorMessageCount = sessionManager.getMessages(sessionId).length;

    // How many messages before large injected content is dropped from the system prompt.
    // Matches the step-file trim threshold in bmad-agent.ts so both happen together.
    const ARTIFACT_INJECT_WINDOW = 12;

    // Build item context (Airtable items only, not ad-hoc)
    let itemContext: string | undefined;
    if (session.itemId && !isAdHocItem(session.itemId)) {
      try {
        const client = getAirtableClient();
        const item = await client.getItem(session.itemId);
        itemContext = `**Initiative:** ${item.initiative}\n**Description:** ${item.description || 'N/A'}\n**Business Value:** ${item.businessValue}/10\n**Estimate:** ${item.estimate}`;
      } catch (err: any) {
        logger.warn(`Could not load item context: ${err.message}`);
      }

      // Inject large artifacts only for the first ARTIFACT_INJECT_WINDOW messages.
      // After that the model has absorbed them from conversation history and
      // re-injecting them on every request wastes significant input tokens.
      if (priorMessageCount < ARTIFACT_INJECT_WINDOW) {
        // For PRD mode, inject the analyst research report if one has been exported
        if (mode === 'prd') {
          const analystContent = loadAnalystArtifactForItem(session.itemId);
          if (analystContent) {
            itemContext = (itemContext ? itemContext + '\n\n' : '') +
              `**Research Report (use this as background context for the PRD):**\n\n${analystContent}`;
          }
        }

        // For backlog mode, inject the existing PRD if one has been exported
        if (mode === 'backlog') {
          const prdContent = loadPrdArtifactForItem(session.itemId);
          if (prdContent) {
            itemContext = (itemContext ? itemContext + '\n\n' : '') +
              `**PRD Document (use this as the source of requirements):**\n\n${prdContent}`;
          }
        }
      }
    }

    // Trim step files from the workflow context once the conversation is established —
    // applies to all agents (not just analyst). Step files are large and become redundant
    // once the model knows its role and process.
    const effectiveWorkflowContext = agent.trimWorkflowContext(
      session.workflowContext ?? '',
      priorMessageCount
    );

    const systemPrompt = await agent.buildSystemPrompt(persona, effectiveWorkflowContext, itemContext);

    // Store user message (skip for ephemeral calls like export)
    if (!skipHistory) {
      sessionManager.addMessage(sessionId, 'user', message);
      appendMessage(session.itemId, mode, 'user', message, persona.name, persona.icon);
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullResponse = '';

    // Rolling message window for all agents: cap history to the last 20 messages so
    // long sessions don't exhaust the input-token budget.
    // Exception: export calls (skipHistory=true) need the full history so the
    // consolidated document covers every section, not just recent ones.
    const MESSAGE_WINDOW = 20;

    try {
      const allDbMessages = sessionManager.getMessages(sessionId)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const windowedMessages = (!skipHistory && allDbMessages.length > MESSAGE_WINDOW)
        ? allDbMessages.slice(-MESSAGE_WINDOW)
        : allDbMessages;

      // For ephemeral calls (skipHistory), the current message was not saved to DB, so append it directly
      const messages = skipHistory
        ? [...windowedMessages, { role: 'user' as const, content: message }]
        : windowedMessages;
      const stream = agent.streamResponse(systemPrompt, messages, model);

      for await (const chunk of stream) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }

      // Store assistant response (skip for ephemeral calls like export)
      if (!skipHistory) {
        sessionManager.addMessage(sessionId, 'assistant', fullResponse);
        appendMessage(session.itemId, mode, 'assistant', fullResponse, persona.name, persona.icon);
      }

      // Send done event — content omitted intentionally: the frontend accumulates
      // text via onChunk and does not read the done payload. Including fullResponse
      // here produced a large JSON object that could be split across network chunks,
      // causing the JSON parse to fail silently and leaving the UI in streaming state.
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();

      logger.info(`Completed BMAD message for session: ${sessionId}`);
    } catch (streamError: any) {
      logger.error('Failed to stream BMAD response', streamError);
      res.write(`data: ${JSON.stringify({ type: 'error', error: streamError.message })}\n\n`);
      res.end();
    }
  } catch (error: any) {
    logger.error('Failed to process BMAD message', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to process message' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  }
});

/**
 * GET /api/bmad/session/:sessionId
 * Get session state
 */
router.get('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error: any) {
    logger.error('Failed to get BMAD session', error);
    res.status(500).json({ error: error.message || 'Failed to get session' });
  }
});

/**
 * POST /api/bmad/export
 * Export generated content as a .md file in the session artifacts folder
 */
router.post('/export', async (req: Request, res: Response) => {
  try {
    const { sessionId, content }: { sessionId: string; content: string } = req.body;

    if (!sessionId || !content) {
      return res.status(400).json({ error: 'sessionId and content are required' });
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const mode = session.mode || 'prd';

    // Build filename from item title or fallback
    let title = 'document';
    if (session.itemId && !isAdHocItem(session.itemId)) {
      try {
        const client = getAirtableClient();
        const item = await client.getItem(session.itemId);
        title = item.initiative;
      } catch {
        // use default
      }
    } else if (session.itemId && isAdHocItem(session.itemId)) {
      title = (await getItemTitle(session.itemId)).toLowerCase().replace(/\s+/g, '-');
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const timestamp = new Date().toISOString().slice(0, 10);
    const ext = mode === 'backlog' ? 'json' : 'md';
    const filename = `${mode}-${slug}-${timestamp}.${ext}`;

    // Save to session artifacts directory
    const filePath = saveArtifact(session.itemId, mode, filename, content);

    // Register artifact in DB
    sessionManager.addArtifact(sessionId, mode, filePath);

    logger.info(`Exported document: ${filePath}`);
    res.json({ success: true, filePath: `data/sessions/${session.itemId}/${mode}/artifacts/${filename}` });
  } catch (error: any) {
    logger.error('Failed to export document', error);
    res.status(500).json({ error: error.message || 'Failed to export' });
  }
});

/**
 * POST /api/bmad/publish-backlog
 * Save the generated backlog JSON as a local file.
 * Previously pushed to Azure DevOps — now outputs locally only.
 * The BacklogPreview component renders the content directly from session state;
 * this endpoint persists it to data/ for later retrieval.
 */
router.post('/publish-backlog', async (req: Request, res: Response) => {
  try {
    const { sessionId, backlogJson }: { sessionId: string; backlogJson: string | BacklogStructure } = req.body;

    if (!sessionId || !backlogJson) {
      return res.status(400).json({ error: 'sessionId and backlogJson are required' });
    }

    let structure: BacklogStructure;
    let rawJson: string;
    try {
      if (typeof backlogJson === 'string') {
        structure = JSON.parse(backlogJson);
        rawJson = backlogJson;
      } else {
        structure = backlogJson;
        rawJson = JSON.stringify(backlogJson, null, 2);
      }
    } catch {
      return res.status(400).json({ error: 'Invalid backlog JSON' });
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Save to data/sessions/{itemId}/backlog/backlog.json
    const outDir = path.join(SESSIONS_DIR, session.itemId, 'backlog');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'backlog.json');
    fs.writeFileSync(outPath, rawJson, 'utf-8');

    // Count stories across all features
    const storyCount = (structure.features ?? []).reduce(
      (sum: number, f: { stories?: unknown[] }) => sum + (f.stories?.length ?? 0),
      0
    );

    logger.info(`Backlog saved locally: ${outPath} (${structure.features?.length ?? 0} features, ${storyCount} stories)`);

    const response: PublishBacklogResponse = {
      success: true,
      epicId: 'local',
      featureIds: [],
      storyIds: [],
      airtableUpdated: false,
      epicUrl: undefined,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Failed to save backlog locally', error);
    res.status(500).json({ error: error.message || 'Failed to save backlog' });
  }
});

/**
 * DELETE /api/bmad/session/:sessionId
 * Hard reset: delete session, messages, and conversation files
 */
router.delete('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const mode = session.mode || 'prd';

    // Delete conversation markdown files
    deleteSessionFiles(session.itemId, mode);

    // Delete from database (cascades to messages and artifacts)
    sessionManager.deleteSession(sessionId);

    logger.info(`Hard reset session: ${sessionId} (item=${session.itemId}, mode=${mode})`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete BMAD session', error);
    res.status(500).json({ error: error.message || 'Failed to delete session' });
  }
});

/**
 * GET /api/bmad/quick-items
 * List all user-created quick sessions
 */
router.get('/quick-items', (_req: Request, res: Response) => {
  try {
    const items = sessionManager.getQuickItems();
    res.json({ items });
  } catch (error: any) {
    logger.error('Failed to get quick items', error);
    res.status(500).json({ error: error.message || 'Failed to get quick items' });
  }
});

/**
 * POST /api/bmad/quick-items
 * Create a new named quick session (max 5)
 */
router.post('/quick-items', (_req: Request, res: Response) => {
  try {
    const count = sessionManager.countQuickItems();
    if (count >= 5) {
      return res.status(409).json({ error: 'Maximum of 5 quick sessions reached' });
    }
    const item = sessionManager.createQuickItem();
    res.json(item);
  } catch (error: any) {
    logger.error('Failed to create quick item', error);
    res.status(500).json({ error: error.message || 'Failed to create quick item' });
  }
});

/**
 * DELETE /api/bmad/quick-items/:itemId
 * Delete a quick session and all its associated sessions, messages, and files
 */
router.delete('/quick-items/:itemId', async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;

    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    const source = sessionManager.getItemSource(itemId);
    if (!source || source !== 'quick_add') {
      return res.status(404).json({ error: 'Quick item not found' });
    }

    // Delete all sessions for this item (SQLite CASCADE handles messages/artifacts)
    const sessions = sessionManager.getSessionIdsByItem(itemId);
    for (const s of sessions) {
      deleteSessionFiles(itemId, s.mode as AppMode);
      sessionManager.deleteSession(s.id);
    }

    // Remove the parent data directory for this item
    const dataDir = path.join(SESSIONS_DIR, itemId);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (err: any) {
      logger.warn(`Could not remove data directory ${dataDir}: ${err.message}`);
    }

    // Delete the item row itself
    sessionManager.deleteQuickItem(itemId);

    logger.info(`Deleted quick item ${itemId} with ${sessions.length} session(s)`);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete quick item', error);
    res.status(500).json({ error: error.message || 'Failed to delete quick item' });
  }
});

export default router;
