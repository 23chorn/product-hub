/**
 * Trigger a fresh demo webhook run via the real HTTP API (not direct DB writes).
 * Logs in, then POSTs /api/demo/webhook/trigger — cleanupPreviousDemoRuns() inside
 * that route tears down any stale demo workflow (DB rows, disk files, wiki/ADO
 * resources) before creating the new one, so this is safe to re-run any time.
 *
 * Usage:
 *   npx tsx src/scripts/trigger-demo-run.ts --username admin --password password123
 *   DEMO_SCRIPT_USERNAME=admin DEMO_SCRIPT_PASSWORD=password123 npx tsx src/scripts/trigger-demo-run.ts
 *
 * Optional: --force-index N picks a specific sample initiative instead of cycling.
 * Optional: API_BASE_URL env var overrides the default http://localhost:3001.
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const username = opts.username || process.env.DEMO_SCRIPT_USERNAME;
  const password = opts.password || process.env.DEMO_SCRIPT_PASSWORD;

  if (!username || !password) {
    console.error('Missing credentials. Pass --username/--password or set DEMO_SCRIPT_USERNAME/DEMO_SCRIPT_PASSWORD.');
    process.exit(1);
  }

  console.log(`Logging in as ${username}...`);
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!loginRes.ok) {
    console.error(`Login failed (${loginRes.status}): ${await loginRes.text()}`);
    process.exit(1);
  }

  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) {
    console.error('Login succeeded but no session cookie was returned.');
    process.exit(1);
  }
  const cookie = setCookie.split(';')[0];

  console.log('Triggering fresh demo run (cleans up any stale demo workflow first)...');
  const forceIndex = opts['force-index'] !== undefined ? Number(opts['force-index']) : undefined;
  const triggerRes = await fetch(`${BASE_URL}/api/demo/webhook/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(forceIndex !== undefined ? { forceIndex } : {}),
  });

  const result = await triggerRes.json() as {
    workflowId: string; itemId: string; initiative: string; stages: string[];
  };
  if (!triggerRes.ok) {
    console.error(`Trigger failed (${triggerRes.status}):`, result);
    process.exit(1);
  }

  console.log('\nDemo run triggered:');
  console.log(`  workflowId: ${result.workflowId}`);
  console.log(`  itemId:     ${result.itemId}`);
  console.log(`  initiative: ${result.initiative}`);
  console.log(`  stages:     ${result.stages.join(' -> ')}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
