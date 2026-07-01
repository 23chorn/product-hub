#!/usr/bin/env node
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { fetchManifest, fetchPayload, updateTicketState } from './api';
import { writeContextFiles } from './writer';
import { launchInteractive, launchHeadless, buildHeadlessPrompt } from './runner';
import type { PayloadTicket, RunOptions } from './types';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ENV_API_KEY = process.env.PIPELINE_API_KEY?.trim() || undefined;

const program = new Command();

program
  .name('pipeline')
  .description('@xcube/pipeline — pull initiative context and launch Claude Code for implementation')
  .version('1.0.0');

program
  .command('run')
  .description('Fetch initiative context, update ADO states, and launch Claude Code')
  .requiredOption('--init <n>', 'Initiative sequence number (the "#N" shown on the card)', parseInt)
  .requiredOption('--phase <name>', 'Phase to filter tickets by (e.g. mvp, v2)')
  .requiredOption('--stream <name>', 'Platform stream to filter by (backend, web, ios, android)')
  .option('--mode <mode>', 'Launch mode: interactive (default) or headless', 'interactive')
  .option('--api <url>', 'Product-hub API base URL', process.env.PIPELINE_API_URL ?? 'http://localhost:3001')
  .option('--key <key>', 'API key for product-hub auth (or set PIPELINE_API_KEY in .env)', ENV_API_KEY)
  .option('--workspace <path>', 'Directory to launch Claude Code in', process.env.PIPELINE_WORKSPACE ?? process.cwd())
  .action(async (opts: RunOptions & { mode: string }) => {
    const mode = opts.mode === 'headless' ? 'headless' : 'interactive';
    await run({ ...opts, mode });
  });

program.parse(process.argv);

async function run(opts: RunOptions): Promise<void> {
  const { init, phase, stream, mode, api, key, workspace } = opts;

  if (!key) {
    console.log('');
    console.log(chalk.yellow('Warning: no API key set. Set PIPELINE_API_KEY in packages/pipeline/.env'));
    console.log(chalk.yellow('Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'));
    console.log(chalk.yellow('Add it to product-hub .env as PIPELINE_API_KEY=<key> and restart the server.'));
    console.log('');
  }

  console.log('');
  console.log(chalk.bold(`@xcube/pipeline — Initiative #${init}  phase:${phase}  stream:${stream}`));
  console.log(chalk.dim(`API: ${api}  |  Workspace: ${workspace}`));
  console.log('');

  // Step 1: fetch manifest
  process.stdout.write(chalk.cyan('1/4  Fetching initiative context...'));
  let manifest;
  try {
    manifest = await fetchManifest(api, init, stream, phase, key);
    process.stdout.write(chalk.green(' done\n'));
  } catch (err: any) {
    process.stdout.write(chalk.red(' failed\n'));
    die(err.message);
  }

  const { initiative, implementationOrder, tickets, blockedTickets } = manifest;
  console.log(chalk.dim(`     ${initiative.title}`));
  console.log(chalk.dim(`     ${tickets.length} tickets in scope, ${implementationOrder.length} in implementation order${blockedTickets?.length ? `, ${blockedTickets.length} blocked` : ''}`));
  console.log('');

  if (implementationOrder.length === 0) {
    console.log(chalk.yellow('No tickets found for this phase/stream combination.'));
    process.exit(0);
  }

  // Step 2: fetch full ticket payloads
  process.stdout.write(chalk.cyan('2/4  Fetching ticket details...'));
  let payload;
  try {
    payload = await fetchPayload(api, init, implementationOrder, key);
    process.stdout.write(chalk.green(' done\n'));
  } catch (err: any) {
    process.stdout.write(chalk.red(' failed\n'));
    die(err.message);
  }

  if (payload.notFound?.length) {
    console.log(chalk.yellow(`     Warning: ${payload.notFound.length} local key(s) not found in payload: ${payload.notFound.join(', ')}`));
  }
  console.log('');

  const payloadByKey = new Map<string, PayloadTicket>(payload.tickets.map(t => [t.localKey, t]));

  // Step 3: write context files
  process.stdout.write(chalk.cyan('3/4  Writing context files...'));
  const { contextPath, planPath } = writeContextFiles(manifest, payloadByKey, workspace, stream, phase);
  process.stdout.write(chalk.green(' done\n'));
  console.log(chalk.dim(`     ${contextPath}`));
  console.log(chalk.dim(`     ${planPath}`));
  console.log('');

  // Step 4: update ADO states New → In Dev
  process.stdout.write(chalk.cyan('4/4  Updating Azure DevOps ticket states...'));
  const adoIds = tickets.map(t => t.adoId);
  let stateResult;
  try {
    stateResult = await updateTicketState(api, init, adoIds, 'In Dev', key);
    process.stdout.write(chalk.green(' done\n'));
  } catch (err: any) {
    process.stdout.write(chalk.red(' failed\n'));
    console.log(chalk.yellow(`     ADO state update failed: ${err.message}`));
    console.log(chalk.yellow('     Continuing — you may need to update ticket states manually.'));
    stateResult = { updated: [], failed: [] };
  }

  if (stateResult.updated.length > 0) {
    console.log(chalk.green(`     ✓ ${stateResult.updated.length} ticket(s) moved to "In Dev"`));
  }
  if (stateResult.failed.length > 0) {
    console.log(chalk.yellow(`     ⚠ ${stateResult.failed.length} ticket(s) failed to update:`));
    for (const f of stateResult.failed) {
      console.log(chalk.dim(`       ADO #${f.adoId}: ${f.error}`));
    }
  }
  console.log('');

  // Step 5: launch Claude Code
  console.log(chalk.bold.green('✓ Ready'));
  console.log('');

  if (mode === 'interactive') {
    launchInteractive(workspace, initiative.title, implementationOrder.length);
  } else {
    const prompt = buildHeadlessPrompt(
      initiative.title,
      initiative.seqNum,
      contextPath,
      planPath,
      implementationOrder
    );
    launchHeadless(workspace, prompt);
  }
}

function die(message: string): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}
