/**
 * demo-runner.ts
 *
 * Spawns `npm run demo` in the configured DEMO_PROJECT_PATH directory,
 * captures stdout/stderr line-by-line, and stores the run log in memory
 * so the frontend can poll it.
 */

import { spawn } from 'child_process';
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
  return process.env.DEMO_PROJECT_PATH ?? null;
}

export async function runDemoScript(workflowId: string): Promise<void> {
  const demoPath = getDemoProjectPath();
  if (!demoPath) {
    throw new Error('DEMO_PROJECT_PATH is not set in .env');
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

  logger.info(`Starting demo run for workflow ${workflowId} in ${demoPath}`);

  // Reset first (clean slate), then run the demo
  const cmd = 'npm run demo:reset 2>/dev/null; npm run demo';

  const child = spawn(cmd, {
    cwd: demoPath,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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
    child.on('error', (err) => {
      push('stderr', `spawn error: ${err.message}`);
      state.status     = 'failed';
      state.exitCode   = -1;
      state.finishedAt = Date.now();
      resolve();
    });
  });
}
