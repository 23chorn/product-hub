/**
 * demo-runner.ts
 *
 * Spawns the pipeline-demo.mjs script directly via node in DEMO_PROJECT_PATH,
 * captures stdout/stderr line-by-line, and stores the run log in memory
 * so the frontend can poll it.
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';

const logger = new Logger('DEMO-RUNNER');

export interface RunLine {
  type: 'stdout' | 'stderr' | 'exit';
  text: string;
  ts: number;
}

export interface RunState {
  status: 'idle' | 'running' | 'passed' | 'failed';
  lines: RunLine[];
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
}

// Keyed by workflowId
const runs = new Map<string, RunState>();

export function getRunState(workflowId: string): RunState {
  return runs.get(workflowId) ?? { status: 'idle', lines: [] };
}

export function getDemoProjectPath(): string | null {
  return process.env.DEMO_PROJECT_PATH?.trim() ?? null;
}

const isWin = process.platform === 'win32';

/** Locate an executable from PATH using where (Win) / which (Unix). */
function findBin(name: string): string | null {
  try {
    const result = spawnSync(isWin ? 'where' : 'which', [name], { encoding: 'utf-8' });
    const found = result.stdout?.trim().split('\n')[0].trim();
    if (found && fs.existsSync(found)) return found;
  } catch { /* ignore */ }
  return null;
}

/** Locate node.exe / node from PATH or the current process */
function findNodeBin(): string {
  return findBin('node') ?? process.execPath;
}

export async function runDemoScript(workflowId: string): Promise<void> {
  const rawPath = getDemoProjectPath();
  if (!rawPath) {
    throw new Error('DEMO_PROJECT_PATH is not set in .env');
  }

  // Normalise: trim whitespace and remove any stray quotes or > characters
  const demoPath = rawPath.replace(/['"<>]/g, '').trim();

  if (!fs.existsSync(demoPath)) {
    throw new Error(`DEMO_PROJECT_PATH does not exist: "${demoPath}"`);
  }

  if (runs.get(workflowId)?.status === 'running') {
    logger.info(`Demo run already in progress for ${workflowId}`);
    return;
  }

  const state: RunState = { status: 'running', lines: [], startedAt: Date.now() };
  runs.set(workflowId, state);

  const push = (type: RunLine['type'], text: string) => {
    state.lines.push({ type, text: text.replace(/\x1b\[[0-9;]*m/g, ''), ts: Date.now() });
  };

  const demoScript = path.join(demoPath, 'scripts', 'pipeline-demo.mjs');
  if (!fs.existsSync(demoScript)) {
    const msg = `Demo script not found: ${demoScript}`;
    logger.error(msg);
    state.status = 'failed';
    state.exitCode = -1;
    state.finishedAt = Date.now();
    push('stderr', msg);
    push('exit', '✗ Demo script missing');
    return;
  }

  const nodeBin = findNodeBin();
  const PRODUCT_HUB_URL = process.env.PRODUCT_HUB_URL ?? 'http://localhost:3001';

  // Build a clean env — filter undefined values which can cause EINVAL on Windows
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) childEnv[k] = v;
  }
  delete childEnv.FORCE_COLOR;
  childEnv.NO_COLOR = '1';
  childEnv.WORKFLOW_ID = workflowId;
  childEnv.PRODUCT_HUB_URL = PRODUCT_HUB_URL;

  const claudeBin = findBin('claude');
  if (claudeBin) childEnv.CLAUDE_BIN = claudeBin;
  logger.info(`Claude binary: ${claudeBin ?? 'not found — child will try PATH'}`);

  logger.info(`Demo run for ${workflowId}: node=${nodeBin} script=${demoScript} cwd=${demoPath}`);

  const child = spawn(nodeBin, [demoScript], {
    cwd: demoPath,
    shell: false,
    env: childEnv,
  });

  child.stdout.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => push('stdout', line));
  });

  child.stderr.on('data', (chunk: Buffer) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => push('stderr', line));
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      state.exitCode   = code ?? -1;
      state.status     = code === 0 ? 'passed' : 'failed';
      state.finishedAt = Date.now();
      push('exit', code === 0 ? '✓ All tests passed' : `✗ Exited with code ${code}`);
      logger.info(`Demo run ${state.status} (code=${code}) for ${workflowId}`);
      resolve();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      const msg = `spawn error: ${err.message} (code=${err.code ?? 'n/a'}, path=${nodeBin})`;
      push('stderr', msg);
      logger.error(`Demo runner spawn error for ${workflowId}: ${msg}`);
      state.status     = 'failed';
      state.exitCode   = -1;
      state.finishedAt = Date.now();
      resolve();
    });
  });
}
