import { spawn } from 'child_process';
import * as path from 'path';

export function launchInteractive(workspace: string, initTitle: string, ticketCount: number): void {
  const claudeCmd = 'claude';
  // Injected via --append-system-prompt so it lands before any user message and
  // doesn't get confused with a memory-recall request.
  const systemContext = [
    `You are implementing a pipeline task: ${ticketCount} tickets for "${initTitle}".`,
    `PIPELINE_CONTEXT.md in this directory contains the full ticket details.`,
    `PIPELINE_PLAN.md is your progress tracker — as you finish each ticket, change its checkbox from [ ] to [x] and update the "Status:" line at the top.`,
    `Do not check memory or do any project survey first. Your only job is to implement the tickets in the order listed in PIPELINE_PLAN.md.`,
  ].join(' ');
  const firstMessage = `Open PIPELINE_CONTEXT.md and PIPELINE_PLAN.md, then start implementing the tickets in the listed order.`;

  console.log('');
  console.log(`Launching Claude Code in ${workspace}`);
  console.log('');

  const child = spawn(claudeCmd, ['--append-system-prompt', systemContext, firstMessage], {
    stdio: 'inherit',
    cwd: workspace,
    shell: false,
  });

  child.on('error', err => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('');
      console.error('Error: `claude` command not found.');
      console.error('Install Claude Code: https://claude.ai/code');
    } else {
      console.error(`Failed to launch claude: ${err.message}`);
    }
    process.exit(1);
  });

  child.on('close', code => {
    if (code !== 0 && code !== null) process.exit(code);
  });
}

export function launchHeadless(workspace: string, prompt: string): void {
  const claudeCmd = 'claude';

  console.log('');
  console.log('Launching Claude Code in headless mode...');

  const child = spawn(claudeCmd, ['-p', prompt], {
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: workspace,
    shell: false,
  });

  child.on('error', err => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('Error: `claude` command not found. Install Claude Code: https://claude.ai/code');
    } else {
      console.error(`Failed to launch claude: ${err.message}`);
    }
    process.exit(1);
  });

  child.on('close', code => {
    if (code !== 0 && code !== null) process.exit(code);
  });
}

export function buildHeadlessPrompt(
  initTitle: string,
  initSeqNum: number,
  contextPath: string,
  planPath: string,
  implementationOrder: string[]
): string {
  const relContext = path.basename(contextPath);
  const relPlan = path.basename(planPath);
  return [
    `You are implementing Initiative #${initSeqNum}: "${initTitle}".`,
    '',
    `Full context is in ${relContext}. Your implementation checklist is in ${relPlan}.`,
    '',
    'Work through the tickets in the implementation order listed in PIPELINE_PLAN.md.',
    'For each ticket:',
    '1. Read the acceptance criteria from PIPELINE_CONTEXT.md',
    '2. Implement the changes',
    '3. Run typecheck and tests',
    '4. Mark the ticket done in PIPELINE_PLAN.md',
    '',
    `Implementation order: ${implementationOrder.slice(0, 5).join(', ')}${implementationOrder.length > 5 ? ` ... (${implementationOrder.length} total)` : ''}`,
    '',
    'Start with the first ticket now.',
  ].join('\n');
}
