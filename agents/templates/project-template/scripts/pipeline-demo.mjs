/**
 * pipeline-demo.mjs
 *
 * Demo pipeline script for generated Vite+React+Playwright projects.
 * Runs Playwright tests, then POSTs results to Product Hub so
 * PipelineStatusSection can show real test data instead of the animation.
 *
 * Required environment variables:
 *   WORKFLOW_ID        — Product Hub workflow ID
 *   PRODUCT_HUB_URL    — Base URL (e.g. http://localhost:3001)
 *
 * Optional:
 *   SKIP_CLAUDE        — set to '1' to skip Claude Code step (tests only)
 *
 * Usage from the generated project root:
 *   WORKFLOW_ID=<id> PRODUCT_HUB_URL=http://localhost:3001 node scripts/pipeline-demo.mjs
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const WORKFLOW_ID     = process.env.WORKFLOW_ID;
const PRODUCT_HUB_URL = (process.env.PRODUCT_HUB_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const SKIP_CLAUDE     = process.env.SKIP_CLAUDE === '1';

if (!WORKFLOW_ID) {
  console.error('ERROR: WORKFLOW_ID env var is required');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function post(path, body) {
  try {
    const res = await fetch(`${PRODUCT_HUB_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (e) {
    console.warn(`POST ${path} failed: ${e.message}`);
    return false;
  }
}

async function get(path) {
  try {
    const res = await fetch(`${PRODUCT_HUB_URL}${path}`);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
  } catch (e) {
    if (!opts.allowFail) throw e;
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n🚀 Product Hub Demo Pipeline — workflow ${WORKFLOW_ID}\n`);

await post(`/api/workflow/${WORKFLOW_ID}/pipeline-result`, {
  stage: 'triggered', status: 'running', pipelineId: `demo-${Date.now()}`,
  branch: 'feat/demo-implementation',
});

// ── Optional: run Claude Code to implement the feature ────────────────────
if (!SKIP_CLAUDE) {
  await post(`/api/workflow/${WORKFLOW_ID}/pipeline-result`, { stage: 'analyzing', status: 'running' });

  const ctx = await get(`/api/workflow/${WORKFLOW_ID}/ticket-context`);
  if (ctx?.prompt) {
    console.log(`\n📋 Ticket context loaded: ${ctx.title}\n`);

    await post(`/api/workflow/${WORKFLOW_ID}/pipeline-result`, { stage: 'generating', status: 'running' });

    // Write prompt to temp file for claude stdin
    const promptFile = join(ROOT, '.claude-prompt.txt');
    writeFileSync(promptFile, ctx.prompt, 'utf-8');

    try {
      run(
        `cat .claude-prompt.txt | claude --print --allowedTools Read,Glob,Grep,Edit,Write,Bash --max-turns 15 --no-color`,
        { allowFail: true }
      );
    } catch {
      console.warn('Claude Code not available or failed — continuing to tests');
    }
    try { require('fs').unlinkSync(promptFile); } catch {}
  }
}

// ── Report PR created ─────────────────────────────────────────────────────
await post(`/api/workflow/${WORKFLOW_ID}/pipeline-result`, {
  stage: 'pr_created', status: 'running', branch: 'feat/demo-implementation',
});

// ── Run Playwright tests ──────────────────────────────────────────────────
console.log('\n🧪 Running Playwright tests…\n');

const resultsFile = join(ROOT, 'playwright-results.json');
let playwrightExitCode = 0;

try {
  run(`npx playwright test --reporter=json --output-file=${resultsFile}`, { allowFail: true });
} catch (e) {
  playwrightExitCode = e.status ?? 1;
}

// ── Parse results ─────────────────────────────────────────────────────────
let testResults = { passed: 0, failed: 0, total: 0, cases: [] };

try {
  if (existsSync(resultsFile)) {
    const raw = JSON.parse(readFileSync(resultsFile, 'utf-8'));
    for (const suite of raw.suites ?? []) {
      for (const spec of suite.specs ?? []) {
        const passed = spec.ok;
        testResults.total++;
        passed ? testResults.passed++ : testResults.failed++;
        testResults.cases.push({
          id: spec.title.match(/TC-\d+/)?.[0] ?? `TC-${String(testResults.total).padStart(3, '0')}`,
          title: spec.title.replace(/^TC-\d+\s*[—-]\s*/, ''),
          passed,
          type: 'happy_path',
          priority: 'medium',
        });
      }
    }
  }
} catch (e) {
  console.warn('Could not parse Playwright results:', e.message);
}

// ── Report final results ──────────────────────────────────────────────────
await post(`/api/workflow/${WORKFLOW_ID}/pipeline-result`, {
  stage: 'pr_created',
  status: 'complete',
  branch: 'feat/demo-implementation',
  testResults,
});

const pct = testResults.total > 0 ? Math.round((testResults.passed / testResults.total) * 100) : 0;
console.log(`\n✅ Pipeline complete — ${testResults.passed}/${testResults.total} tests passed (${pct}%)\n`);
