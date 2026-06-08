/**
 * WebSocket handler for the Claude Code Studio.
 *
 * Path: /ws/ai-coding?workflowId=<id>
 *
 * On connection: sends the workflow context (goal + backlog summary) so the
 * frontend can display the ticket brief.
 *
 * On { action: 'start_coding' }: spawns the Claude Code CLI locally with the
 * ticket content as the prompt, streams stdout line-by-line back as
 * { type: 'output', line: '...' } events. Falls back to a canned mock stream
 * if the CLI is not installed.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import Logger from '../utils/logger';

const logger = new Logger('WS-AI-CODING');

export interface AiCodingEvent {
  type: string;
  label?: string;
  line?: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

function send(ws: WebSocket, event: AiCodingEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Load workflow context from DB ─────────────────────────────────────────────

interface WorkflowContext {
  goal: string;
  title: string;
  backlogSummary: string;   // bullet list of features/stories
  adoTickets: string;       // ADO ticket IDs + titles from ado_work_item_map
}

function loadWorkflowContext(workflowId: string): WorkflowContext {
  try {
    const wf = db.prepare<[string], { goal: string; summary: string | null }>(
      'SELECT goal, summary FROM workflows WHERE id = ?'
    ).get(workflowId);

    const title = wf?.summary ?? wf?.goal?.split('\n')[0] ?? 'Feature implementation';
    const goal = wf?.goal ?? '';

    // ── ADO ticket map ──────────────────────────────────────────────────────
    let adoTickets = '';
    try {
      const mappings = db.prepare<[string], { local_key: string; ado_id: number; title: string; ado_type: string }>(
        'SELECT local_key, ado_id, title, ado_type FROM ado_work_item_map WHERE workflow_id = ? ORDER BY ado_id'
      ).all(workflowId);

      if (mappings.length > 0) {
        const lines: string[] = [];
        for (const m of mappings) {
          const indent = m.ado_type === 'epic' ? '' : m.ado_type === 'feature' ? '  ' : '    ';
          lines.push(`${indent}#${m.ado_id} [${m.ado_type}] ${m.title}`);
        }
        adoTickets = lines.join('\n');
      }
    } catch { /* ado_work_item_map may not have entries in demo mode */ }

    // If no ADO map, fall back to board_synced event details
    if (!adoTickets) {
      try {
        const ev = db.prepare<[string], { details: string | null }>(
          `SELECT details FROM workflow_events WHERE workflow_id = ? AND event_type = 'board_synced' ORDER BY created_at DESC LIMIT 1`
        ).get(workflowId);
        if (ev?.details) {
          const d = JSON.parse(ev.details);
          if (d.epic_id && d.epic_title) {
            adoTickets = `#${d.epic_id} [epic] ${d.epic_title}`;
            if (d.feature_count) adoTickets += `\n  (${d.feature_count} features, ${d.story_count ?? '?'} stories)`;
          }
        }
      } catch { /* ignore */ }
    }

    // ── Backlog artifact ────────────────────────────────────────────────────
    let backlogSummary = '';
    try {
      const artifact = db.prepare<[string], { file_path: string | null }>(
        `SELECT a.file_path FROM artifacts a
         JOIN sessions s ON a.session_id = s.id
         WHERE s.workflow_id = ? AND a.type = 'backlog'
         ORDER BY a.created_at DESC LIMIT 1`
      ).get(workflowId);

      if (artifact?.file_path && fs.existsSync(artifact.file_path)) {
        const raw = fs.readFileSync(artifact.file_path, 'utf-8');
        try {
          const parsed = JSON.parse(raw);
          const lines: string[] = [];
          if (parsed.features) {
            for (const f of parsed.features.slice(0, 5)) {
              lines.push(`• ${f.title}`);
              if (f.stories) {
                for (const s of f.stories.slice(0, 3)) {
                  lines.push(`  - ${s.title}${s.storyPoints ? ` (${s.storyPoints}pt)` : ''}`);
                  if (s.acceptanceCriteria?.length) {
                    lines.push(`    AC: ${s.acceptanceCriteria[0]}`);
                  }
                }
              }
            }
          } else if (parsed.stories) {
            for (const s of parsed.stories.slice(0, 8)) {
              lines.push(`• ${s.title}${s.storyPoints ? ` (${s.storyPoints}pt)` : ''}`);
            }
          }
          backlogSummary = lines.join('\n');
        } catch { /* not JSON */ }
      }
    } catch { /* artifact not found */ }

    return { goal, title, backlogSummary, adoTickets };
  } catch {
    return { goal: '', title: 'Feature implementation', backlogSummary: '', adoTickets: '' };
  }
}

// ── Project root (for Claude Code CWD) ───────────────────────────────────────

// When running via `npm run dev` the CWD is the repo root or app/backend.
// Walk up until we find the package.json that has "workspaces" to identify the root.
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const p = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
        if (p.workspaces) return dir;
      } catch { /* continue */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ── Build the Claude Code prompt ──────────────────────────────────────────────

function buildPrompt(ctx: WorkflowContext): string {
  const lines = [
    `You are a software engineer implementing a new feature.`,
    `Read the ticket details below, explore the codebase structure, then write`,
    `a concise implementation plan and produce the key code for the first story.`,
    ``,
    `## Feature: ${ctx.title}`,
    ``,
    ctx.goal.slice(0, 2000),
  ];

  if (ctx.adoTickets) {
    lines.push('', '## Azure DevOps Tickets', ctx.adoTickets);
  }

  if (ctx.backlogSummary) {
    lines.push('', '## Stories & Acceptance Criteria', ctx.backlogSummary);
  }

  lines.push(
    ``,
    `Steps:`,
    `1. Use the Glob tool to understand the project layout`,
    `2. Read the most relevant existing files`,
    `3. Write the implementation for the first story, following existing patterns`,
    `4. List any additional files that would need to change`,
  );

  return lines.join('\n');
}

// ── Fallback mock stream ──────────────────────────────────────────────────────

async function streamMock(ws: WebSocket, ctx: WorkflowContext) {
  const lines = [
    `> claude --print "Implement: ${ctx.title.slice(0, 50)}"`,
    ``,
    `Claude Code v1.x`,
    ``,
    `Let me start by exploring the codebase structure…`,
    ``,
    `$ find src -type f -name "*.ts" | head -20`,
    `src/services/`,
    `src/repositories/`,
    `src/routes/`,
    `src/models/`,
    ``,
    `I can see the project uses a layered architecture. Let me read the`,
    `existing service patterns before writing new code.`,
    ``,
    `$ cat src/services/index.ts`,
    `// Service registry`,
    `export * from './UserService';`,
    `export * from './NotificationService';`,
    ``,
    `Based on the existing patterns I'll implement the feature as follows:`,
    ``,
    `1. Create \`src/services/${ctx.title.split(' ')[0]}Service.ts\``,
    `   - Core business logic`,
    `   - Event emission for real-time updates`,
    ``,
    `2. Create \`src/repositories/${ctx.title.split(' ')[0]}Repository.ts\``,
    `   - DB persistence layer`,
    `   - Matching existing repository pattern`,
    ``,
    `3. Add route handlers in \`src/routes/\``,
    `   - REST endpoints following existing conventions`,
    ``,
    `Writing src/services/${ctx.title.split(/\s+/)[0]}Service.ts…`,
  ];

  if (ctx.adoTickets) {
    lines.splice(4, 0, '', `ADO tickets loaded:`, ctx.adoTickets, '');
  } else if (ctx.backlogSummary) {
    lines.splice(4, 0, '', `Ticket context loaded:`, ctx.backlogSummary, '');
  }

  for (const line of lines) {
    if (ws.readyState !== WebSocket.OPEN) return;
    send(ws, { type: 'output', line, timestamp: Date.now() });
    await sleep(line.trim().length > 0 ? 60 + Math.random() * 80 : 30);
  }
}

// ── Spawn real claude CLI ─────────────────────────────────────────────────────

async function spawnClaude(ws: WebSocket, prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cwd = findProjectRoot();
    logger.info(`Spawning claude in ${cwd}`);

    const proc = spawn(
      'claude',
      [
        '--print',
        '--allowedTools', 'Read,Bash,Glob,Grep',
        '--max-turns', '8',
        '--no-color',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      }
    );

    // Send prompt via stdin
    proc.stdin!.write(prompt, 'utf-8');
    proc.stdin!.end();

    let started = false;
    let lineBuffer = '';

    const flushLine = (text: string) => {
      // Strip ANSI escape codes that slip through despite --no-color
      const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
      send(ws, { type: 'output', line: clean, timestamp: Date.now() });
    };

    const handleChunk = (chunk: Buffer) => {
      started = true;
      lineBuffer += chunk.toString('utf-8');
      const parts = lineBuffer.split('\n');
      // All but the last part are complete lines
      for (let i = 0; i < parts.length - 1; i++) {
        flushLine(parts[i]);
      }
      // Keep the incomplete last segment in the buffer
      lineBuffer = parts[parts.length - 1];
    };

    proc.stdout.on('data', handleChunk);

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) flushLine(`\x1b[2m${text}\x1b[0m`); // dim — it'll be stripped on next flush
    });

    proc.on('error', (err) => {
      logger.warn(`claude spawn error: ${err.message} — falling back to mock`);
      resolve(false);
    });

    proc.on('close', (code) => {
      // Flush any remaining partial line
      if (lineBuffer.trim()) flushLine(lineBuffer);
      logger.info(`claude exited with code ${code}`);
      resolve(started);
    });
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handleStartCoding(ws: WebSocket, workflowId: string) {
  const ctx = loadWorkflowContext(workflowId);
  const cwd = findProjectRoot();

  send(ws, {
    type: 'session_started',
    label: `Starting Claude Code — ${ctx.title.slice(0, 60)}`,
    timestamp: Date.now(),
    payload: { title: ctx.title, cwd },
  });

  const prompt = buildPrompt(ctx);

  // Try real claude CLI first; fall back to mock if not installed
  const didRun = await spawnClaude(ws, prompt);
  if (!didRun) {
    logger.info('claude CLI not found or failed — using mock stream');
    await streamMock(ws, ctx);
  }

  send(ws, { type: 'session_complete', label: 'Session ended', timestamp: Date.now() });
}

// ── WebSocket attachment ──────────────────────────────────────────────────────

export function attachAiCodingWebSocket(_server: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('error', (err) => logger.error('WebSocketServer error', err));

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let workflowId = '';
    try {
      const url = new URL(req.url ?? '', `http://${req.headers.host}`);
      workflowId = url.searchParams.get('workflowId') ?? '';
    } catch { /* ignore */ }

    // Send context immediately on connect so the left pane can show the brief
    const ctx = loadWorkflowContext(workflowId);
    send(ws, {
      type: 'connected',
      label: 'Claude Code Studio ready',
      timestamp: Date.now(),
      payload: {
        workflowId,
        title: ctx.title,
        goal: ctx.goal.slice(0, 800),
        backlogSummary: ctx.backlogSummary,
        adoTickets: ctx.adoTickets,
      },
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'start_coding') {
          const wfId = msg.workflowId ?? workflowId;
          handleStartCoding(ws, wfId).catch((err) =>
            logger.error('handleStartCoding error', err)
          );
        }
      } catch { /* ignore */ }
    });
  });

  return wss;
}
