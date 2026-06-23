#!/usr/bin/env node
/**
 * Standalone ADO cleanup tool — bulk-deletes Epic/Feature/User Story work items
 * via the Azure DevOps REST API instead of clicking through the UI one at a time.
 *
 * Not wired into the app — run manually whenever you need it:
 *
 *   node scripts/cleanup-ado-work-items.js --ids 1234,1235,1236
 *   node scripts/cleanup-ado-work-items.js --epic 1234              # epic + all its features/stories
 *   node scripts/cleanup-ado-work-items.js --tag "some-tag"
 *   node scripts/cleanup-ado-work-items.js --tag "some-tag" --with-children
 *
 * --ids also accepts pasted ADO URLs (e.g. https://dev.azure.com/org/proj/_workitems/edit/1234).
 *
 * Flags:
 *   --dry-run       Preview matches only, never deletes (overrides --yes)
 *   --yes           Skip the interactive confirmation prompt
 *   --permanent     Bypass the recycle bin (destroy=true). Default is a soft
 *                   delete — recoverable from the ADO recycle bin for ~30 days.
 *   --with-children With --tag, also pulls in features/stories under any
 *                   matched Epic/Feature.
 *
 * Reads AZURE_DEVOPS_ORG / AZURE_DEVOPS_PROJECT / AZURE_DEVOPS_PAT from the
 * repo-root .env — same credentials the app itself uses.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const readline = require('readline');

function parseArgs(argv) {
  const args = { ids: [], dryRun: false, yes: false, permanent: false, withChildren: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids') args.ids.push(...argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--epic') args.epic = Number(argv[++i]);
    else if (a === '--tag') args.tag = argv[++i];
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

Flags:
  --dry-run        Preview matches only, never deletes
  --yes            Skip the interactive confirmation prompt
  --permanent      Bypass the recycle bin (default: soft delete)
  --with-children  With --tag, also delete descendants of matched Epics/Features
`);
}

function extractId(token) {
  const urlMatch = token.match(/edit\/(\d+)/);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.ids.length && !args.epic && !args.tag)) {
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

  ids = [...new Set(ids)];
  if (ids.length === 0) {
    console.log('No matching work items found.');
    return;
  }

  const items = sortChildrenFirst(await getWorkItemsBatch(client, ids));

  console.log(`\nFound ${items.length} work item(s):\n`);
  for (const item of items) {
    const f = item.fields;
    console.log(
      `  #${item.id}\t[${f['System.WorkItemType']}]\t${f['System.State']}\t${f['System.Title']}`
    );
  }
  console.log(`\nMode: ${args.permanent ? 'PERMANENT delete (bypasses recycle bin)' : 'soft delete (recoverable for ~30 days)'}`);

  if (args.dryRun) {
    console.log('\nDry run — nothing deleted.');
    return;
  }

  if (!args.yes) {
    const answer = await confirm(`\nType "yes" to delete these ${items.length} work item(s): `);
    if (answer !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  console.log('\nDeleting...');
  let okCount = 0;
  const failures = [];
  for (const item of items) {
    const result = await deleteOne(client, org, project, item.id, args.permanent);
    if (result.ok) {
      okCount++;
      console.log(`  #${item.id} deleted${result.note ? ` (${result.note})` : ''}`);
    } else {
      failures.push(result);
      console.log(`  #${item.id} FAILED: ${result.error}`);
    }
  }

  console.log(`\nDone — ${okCount}/${items.length} deleted${failures.length ? `, ${failures.length} failed` : ''}.`);
}

main().catch(err => {
  console.error('Fatal error:', err.response?.data || err.message);
  process.exit(1);
});
