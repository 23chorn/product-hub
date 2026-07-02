import { spawn } from 'child_process';
import * as path from 'path';

export function launchInteractive(workspace: string, initTitle: string, ticketCount: number): void {
  const claudeCmd = 'claude';
  // Injected via --append-system-prompt so it lands before any user message and
  // doesn't get confused with a memory-recall request.
  const systemContext = [
    `You are implementing ${ticketCount} tickets for initiative "${initTitle}".`,
    `PIPELINE_CONTEXT.md contains the full ticket details (acceptance criteria, technical notes, functional requirements).`,
    `PIPELINE_PLAN.md is the implementation checklist — it is already ordered by dependency, so it IS the plan.`,
    `Rules you must follow:`,
    `(1) Go straight into coding. Do NOT make a new plan, survey the project, describe your approach, or ask clarifying questions before writing code.`,
    `(2) Work through tickets in the exact order listed in PIPELINE_PLAN.md.`,
    `(3) After each ticket is complete: edit PIPELINE_PLAN.md — change the checkbox from [ ] to [x] and increment the "Status: N / ${ticketCount} complete" count at the top before moving to the next ticket.`,
    `(4) Build the project and run any relevant tests after each ticket before marking it done. Use whatever build/test tooling is appropriate for this codebase (dotnet build, gradle, xcodebuild, npm, etc.).`,
  ].join(' ');
  const firstMessage = `Read the first unchecked ticket from PIPELINE_PLAN.md, look up its full details in PIPELINE_CONTEXT.md, then implement it now.`;

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
  const total = implementationOrder.length;
  return [
    `You are implementing ${total} tickets for Initiative #${initSeqNum}: "${initTitle}".`,
    '',
    `Full ticket details are in ${relContext}. Your checklist is in ${relPlan} — it is already ordered by dependency, so it IS the plan.`,
    '',
    'Rules:',
    '(1) Go straight into coding. Do NOT make a new plan or describe your approach before writing code.',
    '(2) Work through tickets in the order listed in PIPELINE_PLAN.md.',
    `(3) After each ticket: change its checkbox from [ ] to [x] and update the "Status: N / ${total} complete" line in PIPELINE_PLAN.md before moving on.`,
    '(4) Build the project and run any relevant tests after each ticket before marking it done. Use whatever build/test tooling is appropriate for this codebase (dotnet build, gradle, xcodebuild, npm, etc.).',
    '',
    `First ticket: ${implementationOrder[0]}. Read its details from ${relContext} and implement it now.`,
  ].join('\n');
}
