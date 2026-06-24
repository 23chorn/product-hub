#!/usr/bin/env node
/**
 * Standalone ADO cleanup tool — bulk-deletes Epic/Feature/User Story/Test Case work
 * items (and whole Test Plans) via the Azure DevOps REST API instead of clicking
 * through the UI one at a time.
 *
 * Not wired into the app — run manually whenever you need it:
 *
 *   node scripts/cleanup-ado-work-items.js --ids 1234,1235,1236
 *   node scripts/cleanup-ado-work-items.js --epic 1234              # epic + all its features/stories
 *   node scripts/cleanup-ado-work-items.js --tag "some-tag"
 *   node scripts/cleanup-ado-work-items.js --tag "some-tag" --with-children
 *   node scripts/cleanup-ado-work-items.js --test-plan 12387        # plan + all its suites/test cases
 *
 * --ids also accepts pasted ADO URLs (e.g. https://dev.azure.com/org/proj/_workitems/edit/1234).
 * --test-plan also accepts pasted Test Plan URLs (e.g. .../_testPlans/define?planId=1234).
 *
 * Flags:
 *   --dry-run       Preview matches only, never deletes (overrides --yes)
 *   --yes           Skip the interactive confirmation prompt
 *   --permanent     Bypass the recycle bin (destroy=true) for regular work items.
 *                   Default is a soft delete — recoverable from the ADO recycle
 *                   bin for ~30 days. Doesn't apply to Test Plans/Test Cases (see
 *                   --test-plan) — ADO routes those through a separate Test API
 *                   that --permanent has no effect on.
 *   --with-children With --tag, also pulls in features/stories under any
 *                   matched Epic/Feature.
 *   --test-plan     Delete one or more Test Plans by ID (comma-separated). Walks
 *                   every suite in the plan, collects every Test Case work item in
 *                   them (deleting a plan does NOT delete its test cases — they're
 *                   independent work items that can be shared across suites), deletes
 *                   those via the dedicated Test API (the generic work-item delete
 *                   API rejects Test Cases), then deletes the plan container.
 *
 * Reads AZURE_DEVOPS_ORG / AZURE_DEVOPS_PROJECT / AZURE_DEVOPS_PAT from the
 * repo-root .env — same credentials the app itself uses.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const readline = require('readline');

function parseArgs(argv) {
  const args = { ids: [], testPlans: [], dryRun: false, yes: false, permanent: false, withChildren: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids') args.ids.push(...argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--epic') args.epic = Number(argv[++i]);
    else if (a === '--tag') args.tag = argv[++i];
    else if (a === '--test-plan') args.testPlans.push(...argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--permanent') args.permanent = true;
    else if (a === '--with-children') args.withChildren = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/cleanup-ado-work-items.js --ids 1234,1235,1236
  node scripts/cleanup-ado-work-items.js --epic 1234
  node scripts/cleanup-ado-work-items.js --tag "some-tag" [--with-children]
  node scripts/cleanup-ado-work-items.js --test-plan 12387,12388

Flags:
  --dry-run        Preview matches only, never deletes
  --yes            Skip the interactive confirmation prompt
  --permanent      Bypass the recycle bin (default: soft delete)
  --with-children  With --tag, also delete descendants of matched Epics/Features
  --test-plan      Delete one or more Test Plans (+ every test case in them)
`);
}

function extractId(token) {
  const urlMatch = token.match(/edit\/(\d+)/);
  if (urlMatch) return Number(urlMatch[1]);
  const n = Number(token);
  return Number.isInteger(n) ? n : null;
}

function extractPlanId(token) {
  const urlMatch = token.match(/planId=(\d+)/);
  if (urlMatch) return Number(urlMatch[1]);
  const n = Number(token);
  return Number.isInteger(n) ? n : null;
}

function buildClient() {
  let org = process.env.AZURE_DEVOPS_ORG || '';
  const orgMatch = org.match(/dev\.azure\.com\/([^/]+)/);
  if (orgMatch) org = orgMatch[1];
  const project = process.env.AZURE_DEVOPS_PROJECT || '';
  const pat = process.env.AZURE_DEVOPS_PAT || '';

  if (!org || !project || !pat) {
    console.error('Missing AZURE_DEVOPS_ORG / AZURE_DEVOPS_PROJECT / AZURE_DEVOPS_PAT in .env');
    process.exit(1);
  }

  const client = axios.create({
    baseURL: `https://dev.azure.com/${org}/${project}/_apis`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    },
    params: { 'api-version': '7.1' },
  });

  return { client, org, project };
}

async function runWiql(client, query) {
  const res = await client.post('/wit/wiql', { query });
  return res.data;
}

/** Direct children (one level) of a parent work item, via Hierarchy-Forward links. */
async function getChildIds(client, parentId) {
  const wiql = `
    SELECT [System.Id] FROM WorkItemLinks
    WHERE ([Source].[System.Id] = ${parentId})
    AND ([System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward')
  `;
  const data = await runWiql(client, wiql);
  const rels = data.workItemRelations || [];
  return rels.filter(r => r.rel && r.target).map(r => r.target.id);
}

async function searchByTag(client, project, tag) {
  const escaped = tag.replace(/'/g, "''");
  const wiql = `
    SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}'
    AND [System.Tags] CONTAINS '${escaped}'
    ORDER BY [System.WorkItemType], [System.Id]
  `;
  const data = await runWiql(client, wiql);
  return (data.workItems || []).map(w => w.id);
}

/** Every suite ID in a Test Plan (root suite + its direct children — plans here are flat, one level deep). */
async function getTestPlanSuiteIds(client, planId) {
  const res = await client.get(`/testplan/plans/${planId}/suites`);
  return (res.data.value || []).map(s => s.id);
}

/** Every Test Case work item ID assigned to a suite. */
async function getTestCaseIdsInSuite(client, planId, suiteId) {
  const res = await client.get(`/test/plans/${planId}/suites/${suiteId}/testcases`);
  return (res.data.value || [])
    .map(v => v.testCase?.id)
    .filter(Boolean)
    .map(Number);
}

/** Resolve a Test Plan to the full set of Test Case work item IDs across all its suites. */
async function expandTestPlan(client, planId) {
  const suiteIds = await getTestPlanSuiteIds(client, planId);
  const testCaseIds = new Set();
  for (const suiteId of suiteIds) {
    const ids = await getTestCaseIdsInSuite(client, planId, suiteId);
    ids.forEach(id => testCaseIds.add(id));
  }
  return { suiteCount: suiteIds.length, testCaseIds: [...testCaseIds] };
}

/**
 * Delete the Test Plan container itself (the plan + its suite structure).
 * Does not touch the underlying Test Case work items — those are deleted
 * separately via the normal work-item path since they're independent of the plan.
 */
async function deleteTestPlanContainer(client, planId) {
  try {
    await client.delete(`/testplan/plans/${planId}`);
    return { planId, ok: true };
  } catch (err) {
    if (err.response?.status === 404) return { planId, ok: true, note: 'already gone' };
    return { planId, ok: false, error: err.response?.data?.message || err.message };
  }
}

async function getWorkItemsBatch(client, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await client.post('/wit/workitemsbatch', {
      ids: chunk,
      fields: ['System.Id', 'System.WorkItemType', 'System.Title', 'System.State'],
    });
    out.push(...res.data.value);
  }
  return out;
}

const TYPE_ORDER = { 'User Story': 1, 'Product Backlog Item': 1, Task: 1, Feature: 2, Epic: 3 };

function sortChildrenFirst(items) {
  return [...items].sort((a, b) => {
    const oa = TYPE_ORDER[a.fields['System.WorkItemType']] ?? 1;
    const ob = TYPE_ORDER[b.fields['System.WorkItemType']] ?? 1;
    return oa - ob;
  });
}

function confirm(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function deleteOne(client, org, project, id, permanent) {
  try {
    await client.delete(`/wit/workitems/${id}`, { params: { destroy: permanent } });
    return { id, ok: true };
  } catch (err) {
    if (err.response?.status === 404) return { id, ok: true, note: 'already gone' };
    return { id, ok: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Test Case work items reject the generic /wit/workitems delete ("You cannot delete
 * or restore test work items using this API") — they require the dedicated Test API,
 * which has stayed pinned to api-version 5.0 since it predates the testplan API.
 */
async function deleteTestCase(client, id) {
  try {
    await client.delete(`/test/testcases/${id}`, { params: { 'api-version': '5.0' } });
    return { id, ok: true };
  } catch (err) {
    if (err.response?.status === 404) return { id, ok: true, note: 'already gone' };
    return { id, ok: false, error: err.response?.data?.message || err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.ids.length && !args.epic && !args.tag && !args.testPlans.length)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const { client, org, project } = buildClient();

  let ids = [];

  if (args.ids.length) {
    ids.push(...args.ids.map(extractId).filter(id => id !== null));
  }

  if (args.epic) {
    console.log(`Expanding epic #${args.epic} -> features -> stories...`);
    ids.push(args.epic);
    const featureIds = await getChildIds(client, args.epic);
    ids.push(...featureIds);
    for (const fid of featureIds) {
      const storyIds = await getChildIds(client, fid);
      ids.push(...storyIds);
    }
  }

  if (args.tag) {
    console.log(`Searching for work items tagged "${args.tag}"...`);
    const tagIds = await searchByTag(client, project, args.tag);
    ids.push(...tagIds);
    if (args.withChildren) {
      for (const tid of tagIds) {
        const childIds = await getChildIds(client, tid);
        ids.push(...childIds);
      }
    }
  }

  const testPlanIds = [...new Set(args.testPlans.map(extractPlanId).filter(id => id !== null))];
  for (const planId of testPlanIds) {
    console.log(`Expanding test plan #${planId} -> suites -> test cases...`);
    const { suiteCount, testCaseIds } = await expandTestPlan(client, planId);
    console.log(`  plan #${planId}: ${suiteCount} suite(s), ${testCaseIds.length} test case(s)`);
    ids.push(...testCaseIds);
  }

  ids = [...new Set(ids)];
  if (ids.length === 0 && testPlanIds.length === 0) {
    console.log('No matching work items found.');
    return;
  }

  const items = ids.length ? sortChildrenFirst(await getWorkItemsBatch(client, ids)) : [];

  console.log(`\nFound ${items.length} work item(s)${testPlanIds.length ? ` + ${testPlanIds.length} test plan container(s) (#${testPlanIds.join(', #')})` : ''}:\n`);
  for (const item of items) {
    const f = item.fields;
    console.log(
      `  #${item.id}\t[${f['System.WorkItemType']}]\t${f['System.State']}\t${f['System.Title']}`
    );
  }
  console.log(`\nMode: ${args.permanent ? 'PERMANENT delete (bypasses recycle bin)' : 'soft delete (recoverable for ~30 days)'} for regular work items${testPlanIds.length ? '; test plan containers and test cases go through the dedicated Test API and are not affected by --permanent' : ''}`);

  if (args.dryRun) {
    console.log('\nDry run — nothing deleted.');
    return;
  }

  if (!args.yes) {
    const answer = await confirm(`\nType "yes" to delete ${items.length} work item(s)${testPlanIds.length ? ` and ${testPlanIds.length} test plan(s)` : ''}: `);
    if (answer !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  console.log('\nDeleting...');
  let okCount = 0;
  const failures = [];
  for (const item of items) {
    const result = item.fields['System.WorkItemType'] === 'Test Case'
      ? await deleteTestCase(client, item.id)
      : await deleteOne(client, org, project, item.id, args.permanent);
    if (result.ok) {
      okCount++;
      console.log(`  #${item.id} deleted${result.note ? ` (${result.note})` : ''}`);
    } else {
      failures.push(result);
      console.log(`  #${item.id} FAILED: ${result.error}`);
    }
  }

  console.log(`\nDone — ${okCount}/${items.length} deleted${failures.length ? `, ${failures.length} failed` : ''}.`);

  if (testPlanIds.length) {
    console.log('\nDeleting test plan container(s)...');
    for (const planId of testPlanIds) {
      const result = await deleteTestPlanContainer(client, planId);
      console.log(result.ok
        ? `  plan #${planId} deleted${result.note ? ` (${result.note})` : ''}`
        : `  plan #${planId} FAILED: ${result.error}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err.response?.data || err.message);
  process.exit(1);
});
