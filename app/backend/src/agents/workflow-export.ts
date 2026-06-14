/**
 * workflow-export — service layer for pushing workflow artifacts to external
 * systems (Azure DevOps boards, Test Plans, and Wiki).
 *
 * The HTTP handlers in routes/workflow-export-routes.ts are thin wrappers around
 * these functions. Business logic, DB access, and ADO client calls live here so
 * they can be unit-tested and reused without an Express request/response.
 *
 * Functions throw {@link WorkflowExportError} for expected, client-facing failures
 * (bad input, missing artifacts, unconfigured integrations); the route layer maps
 * `status` onto the HTTP response. Any other thrown error is an unexpected 500.
 */
import { appConfig } from '../config/app-config';
import db from '../data/database';
import { insertEvent } from './workflow-db';
import { loadArtifactContentById } from './artifact-helpers';
import { loadPrdForItem, buildEpicEnrichment, buildFeatureEnrichment } from '../utils/prd-enrichment';
import { AzureDevOpsClient } from '../integrations/azure-devops';
import Logger from '../utils/logger';

const logger = new Logger('WORKFLOW-EXPORT');

/** Expected, client-facing failure. `status` becomes the HTTP status code. */
export class WorkflowExportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'WorkflowExportError';
  }
}

/** Strip a leading/trailing markdown code fence (```json / ```markdown / ```) from artifact content. */
function stripCodeFence(raw: string): string {
  return raw.replace(/^```(?:json|markdown|md)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
}

// ── push-to-board ────────────────────────────────────────────────────────────

export interface PushToBoardResult {
  epicId: number;
  epicUrl: string;
  extraEpics?: Array<{ id: number; url: string }>;
  featureCount?: number;
  storyCount?: number;
  created?: number;
  updated?: number;
  synced?: boolean;
}

/**
 * Push the latest approved backlog artifact to the configured work-items provider.
 * First push creates the Epic→Feature→Story hierarchy; subsequent pushes diff-sync.
 */
export async function pushBacklogToBoard(workflowId: string): Promise<PushToBoardResult> {
  if (appConfig.integrations.workItems === 'none') {
    throw new WorkflowExportError(400, 'No work-items integration is configured. Set WORK_ITEMS_INTEGRATION in .env.');
  }

  // Find the workflow's item_id
  const workflow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
  if (!workflow) throw new WorkflowExportError(404, 'Workflow not found');

  // Get the latest backlog artifact for this item
  const artifact = db.prepare<[string], { id: number }>(`
    SELECT a.id
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'backlog'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(workflow.item_id);

  if (!artifact) throw new WorkflowExportError(404, 'No backlog artifact found for this workflow');

  // Load and parse the backlog JSON
  const rawBacklog = await loadArtifactContentById(artifact.id);
  if (!rawBacklog) throw new WorkflowExportError(404, 'Backlog artifact content not found');
  const cleaned = stripCodeFence(rawBacklog);
  let backlog: any;
  try {
    backlog = JSON.parse(cleaned);
  } catch {
    throw new WorkflowExportError(400, 'Backlog artifact is not valid JSON');
  }

  // Normalise all tiers into epic + features[] for downstream ADO push
  if (backlog?.story) {
    // Tier 1: single story → wrap in feature → wrap in epic
    backlog.epic = { title: backlog.story.title, description: backlog.story.goal || '' };
    backlog.features = [{ title: backlog.story.title, description: backlog.story.goal || '', phase: 'MVP', stories: [backlog.story] }];
    delete backlog.story;
  } else if (backlog?.feature) {
    // Tier 2: single feature → wrap in epic
    backlog.epic = { title: backlog.feature.title, description: backlog.feature.description || '' };
    backlog.features = [backlog.feature];
    delete backlog.feature;
  } else if (backlog?.epic && !backlog?.features && Array.isArray(backlog?.epic?.stories)) {
    // Legacy flat stories on epic → wrap in feature
    backlog.features = [{ title: backlog.epic.title, description: backlog.epic.description, phase: 'MVP', stories: backlog.epic.stories }];
  }

  if (!backlog?.epic || !Array.isArray(backlog?.features)) {
    throw new WorkflowExportError(400, 'Backlog JSON does not have a recognised structure (story, feature, or epic/features)');
  }

  // Enrich epic and feature descriptions with PRD context
  const prdContent = loadPrdForItem(workflow.item_id);
  if (prdContent) {
    // Epic: Problem Statement + Success Metrics + Out of Scope
    const epicHtml = buildEpicEnrichment(prdContent);
    if (epicHtml) {
      backlog.epic.description = `${backlog.epic.description || ''}<hr>${epicHtml}`;
    }

    // Features: referenced FRs + referenced Key User Journeys
    for (const feature of backlog.features as any[]) {
      const frIds = new Set<string>();
      const journeyRefs = new Set<string>();
      for (const story of (feature.stories ?? []) as any[]) {
        for (const fr of (story.prdRef?.functionalRequirements ?? []) as string[]) frIds.add(fr);
        if (story.prdRef?.userJourney) journeyRefs.add(story.prdRef.userJourney as string);
      }
      const featureHtml = buildFeatureEnrichment(prdContent, frIds, journeyRefs);
      if (featureHtml) {
        feature.description = `${feature.description || ''}<hr>${featureHtml}`;
      }
    }
  }

  // Push to the configured provider
  if (appConfig.integrations.workItems === 'ado') {
    const client = new AzureDevOpsClient();

    // Check for existing ADO mappings
    const existingMappings = db.prepare<[string], { local_key: string; ado_id: number; title: string }>(
      'SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ?'
    ).all(workflowId);

    // Find the latest backlog artifact ID for the mapping
    const artifactRow = db.prepare<[string], { id: number }>(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'backlog'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(workflow.item_id);
    const artifactId = artifactRow?.id ?? 0;

    if (existingMappings.length > 0) {
      // UPDATE path — diff-based sync
      const mapByKey = new Map(existingMappings.map(m => [m.local_key, m]));
      const updateResult = await client.updateBacklog(backlog, mapByKey);

      // Persist new mappings
      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const m of updateResult.newMappings) {
        insertMapping.run(workflowId, artifactId, m.ado_id, m.ado_type, m.ado_url, m.local_key, m.title, now);
      }

      logger.info(`Synced backlog to ADO: ${updateResult.updated} updated, ${updateResult.created} created`);
      return {
        epicId: updateResult.epicId,
        epicUrl: client.getEpicUrl(updateResult.epicId),
        created: updateResult.created,
        updated: updateResult.updated,
        synced: true,
      };
    }

    // CREATE path — first push
    const result = await client.createBacklog(backlog);
    const epicUrl = client.getEpicUrl(result.epicId);
    const extraEpicUrls = (result.extraEpicIds ?? []).map((id: number) => ({
      id,
      url: client.getEpicUrl(id),
    }));

    // Persist ADO mappings for future sync
    const insertMapping = db.prepare(`
      INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();

    // Map epic
    insertMapping.run(workflowId, artifactId, result.epicId, 'epic', epicUrl, 'epic', backlog.epic.title, now);

    // Map features and stories
    let featureIdx = 0;
    let storyIdx = 0;
    for (let fi = 0; fi < backlog.features.length; fi++) {
      const featureKey = `F${fi + 1}`;
      const featureAdoId = result.featureIds[featureIdx++];
      insertMapping.run(workflowId, artifactId, featureAdoId, 'feature', client.getEpicUrl(featureAdoId), featureKey, backlog.features[fi].title, now);

      for (let si = 0; si < backlog.features[fi].stories.length; si++) {
        const storyKey = `${featureKey}.S${si + 1}`;
        const storyAdoId = result.storyIds[storyIdx++];
        insertMapping.run(workflowId, artifactId, storyAdoId, 'story', client.getEpicUrl(storyAdoId), storyKey, backlog.features[fi].stories[si].title, now);
      }
    }

    logger.info(`Pushed backlog to ADO: Epic #${result.epicId}${result.extraEpicIds?.length ? ` + ${result.extraEpicIds.length} phase epic(s)` : ''}, ${result.featureIds.length} features, ${result.storyIds.length} stories`);
    return {
      epicId: result.epicId,
      epicUrl,
      extraEpics: extraEpicUrls,
      featureCount: result.featureIds.length,
      storyCount: result.storyIds.length,
    };
  }

  // For other providers (jira, etc.), use the generic WorkItemProvider interface
  // which creates items individually rather than as a batch
  throw new WorkflowExportError(400, `Push to board is not yet supported for provider: ${appConfig.integrations.workItems}`);
}

// ── push-to-test-plans ───────────────────────────────────────────────────────

export interface PushToTestPlansResult {
  planId: number;
  planUrl: string;
  created: number;
  updated: number;
  testCaseCount: number;
}

/**
 * Push or sync the approved QA test artifact to ADO Test Plans. Creates one suite
 * per test type; test cases link to their ADO story via TestedBy. Idempotent across
 * pushes — existing test cases are updated rather than duplicated.
 */
export async function pushTestPlan(workflowId: string): Promise<PushToTestPlansResult> {
  if (appConfig.integrations.workItems !== 'ado') {
    throw new WorkflowExportError(400, 'ADO work items integration is not configured.');
  }

  const workflow = db.prepare<[string], { item_id: string; summary: string | null; goal: string }>(
    'SELECT item_id, summary, goal FROM workflows WHERE id = ?'
  ).get(workflowId);
  if (!workflow) throw new WorkflowExportError(404, 'Workflow not found');

  // Load latest QA artifact
  const qaArtifact = db.prepare<[string], { id: number }>(`
    SELECT a.id FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'qa_tests'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(workflow.item_id);
  if (!qaArtifact) throw new WorkflowExportError(404, 'No QA test artifact found for this workflow');

  const qaRaw = await loadArtifactContentById(qaArtifact.id);
  if (!qaRaw) throw new WorkflowExportError(404, 'QA artifact content not found');
  const raw = stripCodeFence(qaRaw);
  let qa: any;
  try { qa = JSON.parse(raw); } catch {
    throw new WorkflowExportError(400, 'QA artifact is not valid JSON — retry the qa_engineer stage');
  }

  const testCases = (qa.test_cases ?? []) as any[];
  if (testCases.length === 0) {
    throw new WorkflowExportError(400, 'No test cases found in QA artifact');
  }

  // Build story map: local_key (F1.S1) → ado_id
  const storyMappings = db.prepare<[string], { local_key: string; ado_id: number }>(
    `SELECT local_key, ado_id FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story'`
  ).all(workflowId);
  const storyMap = new Map(storyMappings.map(m => [m.local_key, m.ado_id]));
  logger.info(`Story map for test plan linking: ${JSON.stringify(Array.from(storyMap.entries()))}`);

  // Log test case story references
  const testCaseRefs = testCases
    .filter(tc => tc.story_ref || tc.linkedStory)
    .map(tc => ({ id: tc.id, ref: tc.story_ref ?? tc.linkedStory }));
  logger.info(`Test cases with story references: ${JSON.stringify(testCaseRefs)}`);

  // Check for existing test plan mapping
  const existingMap = db.prepare<[string], { plan_id: number; plan_url: string; suite_ids: string; test_case_ids: string; root_suite_id?: number }>(
    'SELECT plan_id, plan_url, suite_ids, test_case_ids FROM qa_test_plan_map WHERE workflow_id = ?'
  ).get(workflowId);

  const existing = existingMap ? {
    planId: existingMap.plan_id,
    rootSuiteId: existingMap.root_suite_id,
    suiteIds: JSON.parse(existingMap.suite_ids ?? '{}'),
    testCaseIds: JSON.parse(existingMap.test_case_ids ?? '{}'),
  } : undefined;

  const planName = (workflow.summary ?? workflow.goal.split('\n')[0]).slice(0, 60);

  const client = new AzureDevOpsClient();

  const result = await client.pushQATestPlan({ planName, testCases, storyMap, existing });

  // Persist the mapping
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO qa_test_plan_map
      (workflow_id, artifact_id, plan_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflowId,
    qaArtifact.id,
    result.planId,
    result.planUrl,
    JSON.stringify(result.suiteIds),
    JSON.stringify(result.testCaseIds),
    testCases.length,
    now
  );

  insertEvent(workflowId, 'stage_progress', 'curator',
    `QA Test Plan synced to ADO — ${result.created} created, ${result.updated} updated\n→ ${result.planUrl}`,
    { plan_id: result.planId, plan_url: result.planUrl, created: result.created, updated: result.updated }
  );

  logger.info(`Test plan push complete for workflow ${workflowId}: ${result.created} created, ${result.updated} updated`);
  return {
    planId: result.planId,
    planUrl: result.planUrl,
    created: result.created,
    updated: result.updated,
    testCaseCount: testCases.length,
  };
}

// ── sync-to-wiki ─────────────────────────────────────────────────────────────

const WIKI_SYNCABLE_STAGES = ['analyst', 'pm_prd', 'solution_architect'];

const WIKI_STAGE_ARTIFACT_MAP: Record<string, { type: string; pageName: string }> = {
  analyst:             { type: 'analyst',      pageName: 'Research Brief' },
  pm_prd:              { type: 'prd',          pageName: 'PRD' },
  solution_architect:  { type: 'architecture', pageName: 'Architecture' },
  story_decomposition: { type: 'backlog',      pageName: 'Backlog' },
  qa_engineer:         { type: 'qa_tests',     pageName: 'QA Test Plan' },
};

export interface SyncToWikiResult {
  synced: number;
  results: Array<{ stage: string; pageName: string; url: string }>;
}

/**
 * Sync research, PRD, and architecture documents to Azure DevOps Wiki.
 * `stages` defaults to all three document stages when omitted.
 */
export async function syncToWiki(workflowId: string, stages?: string[]): Promise<SyncToWikiResult> {
  if (appConfig.integrations.workItems !== 'ado') {
    throw new WorkflowExportError(400, 'ADO integration not configured');
  }

  const workflow = db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId);
  if (!workflow) throw new WorkflowExportError(404, 'Workflow not found');

  const itemRow = db.prepare<[string], { title: string }>(
    'SELECT title FROM items WHERE id = ?'
  ).get(workflow.item_id);
  if (!itemRow) throw new WorkflowExportError(404, 'Item not found');

  // Default to all three document stages
  const stagesToSync = stages ?? WIKI_SYNCABLE_STAGES;
  for (const stage of stagesToSync) {
    if (!WIKI_SYNCABLE_STAGES.includes(stage)) {
      throw new WorkflowExportError(400, `Invalid stage: ${stage}. Must be one of: ${WIKI_SYNCABLE_STAGES.join(', ')}`);
    }
  }

  const client = new AzureDevOpsClient();
  const wikiId = client.wikiIdentifier;

  const results: Array<{ stage: string; pageName: string; url: string }> = [];

  const featureName = itemRow.title.replace(/[/\\:*?"<>|#]/g, '').trim();

  for (const stage of stagesToSync) {
    const config = WIKI_STAGE_ARTIFACT_MAP[stage];
    if (!config) continue;

    // Load artifact — fetches from wiki if already stored there, falls back to disk
    const artifactRow = db.prepare<[string, string], { id: number }>(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = ?
      ORDER BY a.created_at DESC LIMIT 1
    `).get(workflow.item_id, config.type);

    if (!artifactRow) {
      logger.warn(`Sync to wiki: no ${config.type} artifact for item ${workflow.item_id}`);
      continue;
    }

    const rawContent = await loadArtifactContentById(artifactRow.id);
    if (!rawContent) {
      logger.warn(`Sync to wiki: could not load ${config.type} artifact ${artifactRow.id}`);
      continue;
    }
    const content = stripCodeFence(rawContent);

    const wikiPath = `/Product Documentation/Features/${featureName}/${config.pageName}`;
    await client.ensureWikiPath(wikiId, wikiPath);
    const { url } = await client.upsertWikiPage(wikiId, wikiPath, content);
    results.push({ stage, pageName: config.pageName, url });
  }

  // Insert success event
  const summary = results.map(r => `${r.pageName}: ${r.url}`).join('\n');
  insertEvent(workflowId, 'stage_progress', null,
    `Wiki pages synced (${results.length})\n${summary}`,
    { synced_count: results.length, results }
  );

  logger.info(`Wiki sync complete for workflow ${workflowId}: ${results.length} pages`);
  return { synced: results.length, results };
}
