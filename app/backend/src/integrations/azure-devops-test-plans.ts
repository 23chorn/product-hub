import type { AxiosInstance } from 'axios';
import Logger from '../utils/logger';
import {
  adoErrorMessage,
  SUITE_TYPE_LABELS,
  TC_PRIORITY_MAP,
  buildTestCaseDescription,
  buildTestStepsXml,
  parseStoryRefs,
  type TestCaseInput,
} from './azure-devops-format';

const logger = new Logger('AZURE-DEVOPS-TESTPLANS');

/**
 * Shared primitives the Test Plans API helpers need from the AzureDevOpsClient.
 * Lets this module own the ADO Test Plans surface without coupling to the client class.
 */
export interface TestPlanContext {
  client: AxiosInstance;
  organization: string;
  project: string;
}

async function createTestPlan(
  ctx: TestPlanContext,
  name: string,
): Promise<{ planId: number; rootSuiteId: number; planUrl: string }> {
  try {
    const response = await ctx.client.post('/testplan/plans', { name }, {
      headers: { 'Content-Type': 'application/json' },
    });
    const planId = response.data.id as number;
    const rootSuiteId = response.data.rootSuite?.id as number;
    return {
      planId,
      rootSuiteId,
      planUrl: `https://dev.azure.com/${ctx.organization}/${ctx.project}/_testPlans/define?planId=${planId}`,
    };
  } catch (error: any) {
    throw new Error(`Failed to create test plan: ${adoErrorMessage(error)}`);
  }
}

/** Create a static test suite as a child of parentSuiteId inside a plan. */
async function createTestSuite(
  ctx: TestPlanContext,
  planId: number,
  name: string,
  parentSuiteId: number,
): Promise<{ suiteId: number }> {
  try {
    const response = await ctx.client.post(`/testplan/plans/${planId}/suites`, {
      suiteType: 'StaticTestSuite',
      name,
      parentSuite: { id: parentSuiteId },
    }, {
      headers: { 'Content-Type': 'application/json' },
    });
    return { suiteId: response.data.id as number };
  } catch (error: any) {
    throw new Error(`Failed to create test suite "${name}": ${adoErrorMessage(error)}`);
  }
}

/** Create a Test Case work item with steps XML and optional TestedBy link(s). */
async function createTestCaseWorkItem(ctx: TestPlanContext, params: {
  title: string;
  description?: string;
  stepsXml: string;
  priority: number;
  tags?: string;
  storyAdoIds?: number[];
}): Promise<{ testCaseId: number }> {
  const operations: any[] = [
    { op: 'add', path: '/fields/System.Title', value: params.title },
    { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: params.stepsXml },
    { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: params.priority },
  ];

  if (params.description) {
    operations.push({ op: 'add', path: '/fields/System.Description', value: params.description });
  }

  if (params.tags) {
    operations.push({ op: 'add', path: '/fields/System.Tags', value: params.tags });
  }

  for (const storyAdoId of params.storyAdoIds ?? []) {
    operations.push({
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
        url: `https://dev.azure.com/${ctx.organization}/${ctx.project}/_apis/wit/workItems/${storyAdoId}`,
      },
    });
  }

  try {
    const response = await ctx.client.post('/wit/workitems/$Test%20Case', operations);
    return { testCaseId: response.data.id as number };
  } catch (error: any) {
    throw new Error(`Failed to create test case "${params.title}": ${adoErrorMessage(error)}`);
  }
}

/**
 * Add a TestedBy-Reverse relation from a test case to a user story.
 * Silently swallows duplicate-link errors so re-syncs are idempotent.
 */
async function addTestedByLink(ctx: TestPlanContext, testCaseId: number, storyAdoId: number): Promise<void> {
  try {
    await ctx.client.patch(`/wit/workitems/${testCaseId}`, [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
          url: `https://dev.azure.com/${ctx.organization}/${ctx.project}/_apis/wit/workItems/${storyAdoId}`,
        },
      },
    ]);
  } catch (error: any) {
    const msg: string = error.response?.data?.message ?? error.message ?? '';
    // ADO returns a 400 with "duplicate" in the message when the link already exists
    if (/duplicate|already exists/i.test(msg)) return;
    logger.warn(`addTestedByLink: tc #${testCaseId} → story #${storyAdoId}: ${msg}`);
  }
}

/** Update an existing Test Case work item's title, steps, priority, tags, and description. */
async function updateTestCaseWorkItem(ctx: TestPlanContext, testCaseId: number, params: {
  title: string;
  description?: string;
  stepsXml: string;
  priority: number;
  tags?: string;
}): Promise<void> {
  const operations: any[] = [
    { op: 'replace', path: '/fields/System.Title', value: params.title },
    { op: 'replace', path: '/fields/Microsoft.VSTS.TCM.Steps', value: params.stepsXml },
    { op: 'replace', path: '/fields/Microsoft.VSTS.Common.Priority', value: params.priority },
  ];

  if (params.description !== undefined) {
    operations.push({ op: 'replace', path: '/fields/System.Description', value: params.description });
  }

  if (params.tags !== undefined) {
    operations.push({ op: 'replace', path: '/fields/System.Tags', value: params.tags });
  }

  try {
    await ctx.client.patch(`/wit/workitems/${testCaseId}`, operations);
  } catch (error: any) {
    throw new Error(`Failed to update test case #${testCaseId}: ${adoErrorMessage(error)}`);
  }
}

/** Add existing test case work items to a test suite. */
async function addTestCasesToSuite(
  ctx: TestPlanContext,
  planId: number,
  suiteId: number,
  testCaseIds: number[],
): Promise<void> {
  if (testCaseIds.length === 0) return;
  // Use the older /test API — it accepts comma-separated IDs in the URL and is reliably supported.
  // The newer /testplan POST endpoint is preview-only and returns 404 with api-version 7.1.
  const ids = testCaseIds.join(',');
  try {
    await ctx.client.post(
      `/test/plans/${planId}/suites/${suiteId}/testcases/${ids}`,
      null,
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    throw new Error(`Failed to add test cases to suite: ${adoErrorMessage(error)}`);
  }
}

/**
 * Remove a test case work item from a test suite (deletes its test point, not the work item).
 * A Test Case work item that's still a member of a suite cannot be hard-deleted — ADO rejects
 * the work item destroy with a 400 until every test point referencing it is gone — so this
 * must run before deleteWorkItem. Silently swallows 404 (already removed from the suite).
 */
export async function removeTestCaseFromSuite(
  ctx: TestPlanContext,
  planId: number,
  suiteId: number,
  testCaseId: number,
): Promise<void> {
  try {
    await ctx.client.delete(`/test/plans/${planId}/suites/${suiteId}/testcases/${testCaseId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    if (error.response?.status === 404) return;
    throw new Error(`Failed to remove test case #${testCaseId} from suite #${suiteId}: ${adoErrorMessage(error)}`);
  }
}

/**
 * Push or sync a QA test suite to ADO Test Plans.
 * Creates a plan + per-type suites on first push; updates existing test cases and
 * adds new ones on subsequent pushes. Returns accumulated IDs and counts.
 */
export async function pushQATestPlan(ctx: TestPlanContext, params: {
  planName: string;
  testCases: TestCaseInput[];
  storyMap: Map<string, number>;
  existing?: {
    planId: number;
    rootSuiteId?: number;
    suiteIds: Record<string, number>;
    testCaseIds: Record<string, number>;
  };
}): Promise<{
  planId: number;
  rootSuiteId: number;
  planUrl: string;
  suiteIds: Record<string, number>;
  testCaseIds: Record<string, number>;
  created: number;
  updated: number;
}> {
  const { planName, testCases, storyMap, existing } = params;

  let planId: number;
  let rootSuiteId: number;
  let planUrl: string;

  if (existing) {
    planId = existing.planId;
    planUrl = `https://dev.azure.com/${ctx.organization}/${ctx.project}/_testPlans/define?planId=${planId}`;
    // Fetch root suite from ADO if not cached
    if (existing.rootSuiteId) {
      rootSuiteId = existing.rootSuiteId;
    } else {
      const planRes = await ctx.client.get(`/testplan/plans/${planId}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      rootSuiteId = planRes.data.rootSuite?.id as number;
    }
  } else {
    const plan = await createTestPlan(ctx, planName);
    planId = plan.planId;
    rootSuiteId = plan.rootSuiteId;
    planUrl = plan.planUrl;
  }

  const suiteIds: Record<string, number> = existing?.suiteIds ? { ...existing.suiteIds } : {};
  const testCaseIds: Record<string, number> = existing?.testCaseIds ? { ...existing.testCaseIds } : {};
  let created = 0;
  let updated = 0;

  // Group test cases by type
  const byType = new Map<string, TestCaseInput[]>();
  for (const tc of testCases) {
    const type = tc.type ?? 'functional';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(tc);
  }

  for (const [type, cases] of byType) {
    if (!suiteIds[type]) {
      const label = SUITE_TYPE_LABELS[type] ?? type;
      const suite = await createTestSuite(ctx, planId, label, rootSuiteId);
      suiteIds[type] = suite.suiteId;
    }
    const suiteId = suiteIds[type];
    const newTestCaseAdoIds: number[] = [];

    for (const tc of cases) {
      const stepsXml = buildTestStepsXml(tc);
      const description = buildTestCaseDescription(tc);
      const priority = TC_PRIORITY_MAP[(tc.priority ?? 'medium').toLowerCase()] ?? 3;
      const tags = Array.isArray(tc.tags) && tc.tags.length ? tc.tags.join('; ') : undefined;
      // A ref can name more than one story (e.g. "F1.S9 (iOS) / F1.S10 (Android)" for a
      // test case that covers both platforms' stories) — resolve every key it contains.
      const storyRef = tc.story_ref ?? tc.linkedStory ?? null;
      const storyAdoIds = storyRef
        ? [...new Set(parseStoryRefs(storyRef).map(key => storyMap.get(key)).filter((id): id is number => id !== undefined))]
        : [];

      if (storyRef && storyAdoIds.length === 0) {
        logger.warn(`Test case ${tc.id} references story "${storyRef}" but no ADO ID found in storyMap`);
      }

      if (tc.id && testCaseIds[tc.id]) {
        await updateTestCaseWorkItem(ctx, testCaseIds[tc.id], { title: tc.title, description, stepsXml, priority, tags });
        for (const storyAdoId of storyAdoIds) {
          logger.info(`Adding TestedBy link: tc #${testCaseIds[tc.id]} → story #${storyAdoId} (${storyRef})`);
          await addTestedByLink(ctx, testCaseIds[tc.id], storyAdoId);
        }
        updated++;
      } else {
        if (storyAdoIds.length) {
          logger.info(`Creating test case with TestedBy link(s): "${tc.title}" → stor${storyAdoIds.length > 1 ? 'ies' : 'y'} #${storyAdoIds.join(', #')} (${storyRef})`);
        }
        const { testCaseId } = await createTestCaseWorkItem(ctx, { title: tc.title, description, stepsXml, priority, tags, storyAdoIds });
        if (tc.id) testCaseIds[tc.id] = testCaseId;
        newTestCaseAdoIds.push(testCaseId);
        created++;
      }
    }

    if (newTestCaseAdoIds.length > 0) {
      await addTestCasesToSuite(ctx, planId, suiteId, newTestCaseAdoIds);
    }
  }

  logger.info(`Test plan push: planId=${planId}, ${created} created, ${updated} updated`);
  return { planId, rootSuiteId, planUrl, suiteIds, testCaseIds, created, updated };
}

/**
 * Delete an ADO Test Plan (and all its suites + test cases).
 * Silently swallows 404.
 */
export async function deleteTestPlan(ctx: TestPlanContext, planId: number): Promise<void> {
  try {
    await ctx.client.delete(`/testplan/plans/${planId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    logger.info(`Deleted test plan #${planId}`);
  } catch (err: any) {
    if (err.response?.status !== 404) {
      logger.warn(`Failed to delete test plan #${planId}: ${err.response?.status} ${err.message}`);
    }
  }
}
