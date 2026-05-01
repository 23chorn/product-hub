import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { SpecialistAgent } from '../agents/specialist-agent';
import { sessionStore } from '../data/session-store';
import { isValidModelId } from '../utils/ai-provider';
import { DATA_DIR } from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('DL-ROUTES');
const router = Router();

// Decision log data lives in data/decision-log/
const DL_DIR = path.join(DATA_DIR, 'decision-log');

// Singleton Dex agent (cached after first persona load)
let dexAgent: SpecialistAgent | null = null;

async function getDexAgent(): Promise<SpecialistAgent> {
  if (!dexAgent) {
    dexAgent = new SpecialistAgent('decision-log');
    await dexAgent.loadPersona();
  }
  return dexAgent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current month ID: 'dl-YYYY-MM'
 */
function getCurrentMonthId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `dl-${year}-${month}`;
}

/**
 * Returns a human-readable label for a month ID: 'dl-2026-02' → 'February 2026'
 */
function monthIdToLabel(monthId: string): string {
  // Format: dl-YYYY-MM
  const parts = monthId.split('-');
  if (parts.length !== 3) return monthId;
  const year = parseInt(parts[1]);
  const month = parseInt(parts[2]) - 1;
  const date = new Date(year, month);
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Returns the current month string: 'YYYY-MM'
 */
function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Ensure the decision-log directory exists.
 */
function ensureDlDir(): void {
  fs.mkdirSync(DL_DIR, { recursive: true });
}

/**
 * Read the contents of data/decision-log/index.md (or null if not found).
 */
function readIndexFile(): string | null {
  const indexPath = path.join(DL_DIR, 'index.md');
  if (!fs.existsSync(indexPath)) return null;
  return fs.readFileSync(indexPath, 'utf-8');
}

/**
 * Read the contents of data/decision-log/{yearMonth}.md (or null if not found).
 */
function readMonthFile(yearMonth: string): string | null {
  const filePath = path.join(DL_DIR, `${yearMonth}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Get or create the monthly item + session for the current month.
 * Returns { sessionId, monthId }.
 */
function getOrCreateMonthlySession(): { sessionId: string; monthId: string } {
  const monthId = getCurrentMonthId();
  const label = monthIdToLabel(monthId);

  // Ensure item row exists (uses upsertItem which is idempotent)
  sessionStore.upsertItem(monthId, `Decision Log — ${label}`, 'quick_add');

  // Find existing session for this month
  const existing = sessionStore.findActiveSession(monthId, 'decision-log');
  if (existing) {
    return { sessionId: existing.id, monthId };
  }

  // Create new session
  const session = sessionStore.createSession(monthId, 'decision-log', 'decision-log');
  logger.info(`Created new decision log session for ${monthId}: ${session.id}`);
  return { sessionId: session.id, monthId };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/decision-log/session
 * Get or create the current month's session. Returns session ID, messages, and log state.
 */
router.get('/session', (req: Request, res: Response) => {
  try {
    const { sessionId, monthId } = getOrCreateMonthlySession();
    const messages = sessionStore.getMessages(sessionId);
    const yearMonth = getCurrentYearMonth();
    const logExists = fs.existsSync(path.join(DL_DIR, `${yearMonth}.md`));

    res.json({ sessionId, monthId, messages, logExists });
  } catch (err: any) {
    logger.error('Failed to get/create DL session', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/decision-log/message
 * Stream a chat message to Dex. SSE response.
 */
router.post('/message', async (req: Request, res: Response) => {
  const { sessionId, message, model } = req.body;

  if (!sessionId || !message) {
    res.status(400).json({ error: 'sessionId and message are required' });
    return;
  }

  // Validate model override
  if (model && !isValidModelId(model)) {
    res.status(400).json({ error: `Unknown model: ${model}` });
    return;
  }

  try {
    const agent = await getDexAgent();
    const persona = await agent.loadPersona();

    // Load context to inject into system prompt
    const yearMonth = getCurrentYearMonth();
    const indexContent = readIndexFile();
    const currentMonthContent = readMonthFile(yearMonth);

    const monthLabel = monthIdToLabel(getCurrentMonthId());

    let decisionsContext = `## Previous Decisions (Reference)\n`;
    decisionsContext += indexContent
      ? `${indexContent}\n\n`
      : `No decisions have been logged yet.\n\n`;
    decisionsContext += `## This Month's Decisions So Far (${monthLabel})\n`;
    decisionsContext += currentMonthContent
      ? currentMonthContent
      : `No decisions logged this month yet.`;

    // Build system prompt
    const systemPrompt = await agent.buildSystemPrompt(persona, undefined, decisionsContext);

    // Get message history (user/assistant only)
    const allMessages = sessionStore.getMessages(sessionId);
    const history = allMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Save user message
    sessionStore.addMessage(sessionId, 'user', message);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Stream response
    let fullResponse = '';
    try {
      for await (const chunk of agent.streamResponse(
        systemPrompt,
        [...history, { role: 'user', content: message }],
        model
      )) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }

      // Save assistant response
      sessionStore.addMessage(sessionId, 'assistant', fullResponse);

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (streamErr: any) {
      logger.error('DL streaming error', streamErr);
      res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
    }

    res.end();
  } catch (err: any) {
    logger.error('DL message route error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * POST /api/decision-log/log-decision
 * Append an approved ADR to the monthly log file and update the index.
 */
router.post('/log-decision', (req: Request, res: Response) => {
  const { content, title } = req.body;

  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  try {
    ensureDlDir();

    const yearMonth = getCurrentYearMonth();
    const logPath = path.join(DL_DIR, `${yearMonth}.md`);
    const indexPath = path.join(DL_DIR, 'index.md');
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}-${month}-${year}`; // DD-MM-YYYY

    // Ensure the first ## heading has a [date] bracket — inject one if missing
    const normalizedContent = content.trim().replace(
      /^(##\s+)(?!\[[\d-]+\])(.+)$/m,
      `$1[${dateStr}] $2`
    );

    // Append ADR to monthly log
    const separator = '\n---\n\n';
    const entry = normalizedContent + '\n';
    if (fs.existsSync(logPath)) {
      fs.appendFileSync(logPath, separator + entry, 'utf-8');
    } else {
      // First entry for this month — write with header
      const monthLabel = monthIdToLabel(getCurrentMonthId());
      fs.writeFileSync(logPath, `# Decision Log — ${monthLabel}\n\n${entry}`, 'utf-8');
    }

    // Append one-liner to index.md
    const decisionTitle = title || `Decision ${dateStr}`;
    const indexLine = `- [${dateStr}] **${decisionTitle}**\n`;
    if (fs.existsSync(indexPath)) {
      fs.appendFileSync(indexPath, indexLine, 'utf-8');
    } else {
      fs.writeFileSync(indexPath, `# Decision Log Index\n\n${indexLine}`, 'utf-8');
    }

    logger.info(`Logged decision to ${logPath}: ${decisionTitle}`);
    res.json({ success: true, logPath, yearMonth });
  } catch (err: any) {
    logger.error('Failed to log decision', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/decision-log/log/:yearMonth
 * Read a monthly log file (e.g. GET /api/decision-log/log/2026-02)
 */
router.get('/log/:yearMonth', (req: Request, res: Response) => {
  const { yearMonth } = req.params;

  // Basic validation: must match YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
    return;
  }

  const content = readMonthFile(yearMonth);
  res.json({ content });
});

/**
 * GET /api/decision-log/index
 * Read the master index file.
 */
router.get('/index', (_req: Request, res: Response) => {
  const content = readIndexFile();
  res.json({ content });
});

/**
 * GET /api/decision-log/months
 * List all available monthly log files, newest first.
 */
router.get('/months', (_req: Request, res: Response) => {
  try {
    ensureDlDir();
    const files = fs.existsSync(DL_DIR)
      ? fs.readdirSync(DL_DIR).filter(f => f.endsWith('.md') && f !== 'index.md')
      : [];

    const months = files
      .map(f => f.replace('.md', '')) // '2026-02'
      .sort()
      .reverse()
      .map(yearMonth => ({
        month: yearMonth,
        label: monthIdToLabel(`dl-${yearMonth}`),
      }));

    res.json({ months });
  } catch (err: any) {
    logger.error('Failed to list DL months', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
