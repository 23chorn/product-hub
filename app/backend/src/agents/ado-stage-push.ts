/**
 * ADO auto-push helpers for stage completion.
 *
 * Called directly after story_decomposition, tech_refinement, and qa_engineer stages
 * save their artifacts. Pushes content to the appropriate ADO destination:
 *   story_decomposition / tech_refinement → Azure Boards (Epic + Features + Stories)
 *   qa_engineer                  → Azure Test Plans
 *
 * Returns the top-level ADO URL on success, null if ADO is not configured or
 * the push fails (errors are logged but not thrown — a failed ADO push should
 * not abort the workflow).
 */

import db from '../data/database';
import { loadArtifactContentById } from './artifact-helpers';
import { stripJsonFence } from '../utils/json-repair';
import { loadPrdForItem, buildEpicEnrichment, buildFeatureEnrichment } from '../utils/prd-enrichment';
import { insertEvent } from './workflow-db';
import { featureLocalKey, storyLocalKey } from '@pap/shared';
import { groupTestCasesByEpic } from '../integrations/azure-devops-format';
import Logger from '../utils/logger';

const logger = new Logger('ADO-PUSH');

// ── Shared ADO config check ───────────────────────────────────────────────────

function isAdoConfigured(): boolean {
  const { appConfig } = require('../config/app-config');
  return appConfig.integrations.workItems === 'ado';
}

// ── Push backlog to ADO Boards ────────────────────────────────────────────────

/**
 * Push the latest backlog artifact for itemId to Azure Boards.
 * Used for both story_decomposition (first push) and tech_refinement (sync/update).
 * Returns the epic URL or null.
 */
export async function pushBacklogToAdo(workflowId: string, itemId: string): Promise<string | null> {
  if (!isAdoConfigured()) {
    logger.info(`Board push skipped — work items integration not set to ado`);
    return null;
  }

  try {
    const artifactRow = db.prepare<[string], { id: number }>(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'backlog'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId);

    if (!artifactRow) {
      logger.warn(`Board push: no backlog artifact for item ${itemId}`);
      return null;
    }

    const rawContent = await loadArtifactContentById(artifactRow.id);
    if (!rawContent) {
      logger.warn(`Board push: could not load backlog artifact ${artifactRow.id}`);
      return null;
    }

    let backlog: any;
    try { backlog = JSON.parse(stripJsonFence(rawContent)); } catch {
      logger.warn('Board push: backlog artifact is not valid JSON');
      return null;
    }

    // Normalise single-story / single-feature structures
    if (backlog?.story) {
      backlog.epic = { title: backlog.story.title, description: backlog.story.goal || '' };
      backlog.features = [{ title: backlog.story.title, description: backlog.story.goal || '', phase: 'MVP', stories: [backlog.story] }];
      delete backlog.story;
    } else if (backlog?.feature) {
      backlog.epic = { title: backlog.feature.title, description: backlog.feature.description || '' };
      backlog.features = [backlog.feature];
      delete backlog.feature;
    } else if (backlog?.epic && !backlog?.features && Array.isArray(backlog?.epic?.stories)) {
      backlog.features = [{ title: backlog.epic.title, description: backlog.epic.description, phase: 'MVP', stories: backlog.epic.stories }];
    }

    if (!backlog?.epic || !Array.isArray(backlog?.features)) {
      logger.warn('Board push: unrecognised backlog structure');
      return null;
    }

    // Enrich epic/features with PRD context
    const prdContent = loadPrdForItem(itemId);
    if (prdContent) {
      const epicHtml = buildEpicEnrichment(prdContent);
      if (epicHtml) backlog.epic.description = `${backlog.epic.description || ''}<hr>${epicHtml}`;
      for (const feature of backlog.features as any[]) {
        const frIds = new Set<string>();
        const journeyRefs = new Set<string>();
        for (const story of (feature.stories ?? []) as any[]) {
          for (const fr of (story.prdRef?.functionalRequirements ?? []) as string[]) frIds.add(fr);
          if (story.prdRef?.userJourney) journeyRefs.add(story.prdRef.userJourney as string);
        }
        const featureHtml = buildFeatureEnrichment(prdContent, frIds, journeyRefs);
        if (featureHtml) feature.description = `${feature.description || ''}<hr>${featureHtml}`;
      }
    }

    // Stamp each feature/story title with its local F#/S# key so the ADO ticket itself
    // shows implementation order — same numbering used for ado_work_item_map.local_key below.
    for (let fi = 0; fi < backlog.features.length; fi++) {
      const featureKey = featureLocalKey(fi);
      backlog.features[fi].title = `[${featureKey}] ${backlog.features[fi].title}`;
      const stories = (backlog.features[fi].stories ?? []) as any[];
      for (let si = 0; si < stories.length; si++) {
        stories[si].title = `[${storyLocalKey(featureKey, si)}] ${stories[si].title}`;
      }
    }

    const { getAzureDevOpsClient } = require('../integrations/azure-devops');
    const client = getAzureDevOpsClient();
    const artifactId = artifactRow.id;

    const existingMappings = db.prepare<[string], { local_key: string; ado_id: number; title: string }>(
      'SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ?'
    ).all(workflowId);

    let topUrl: string;
    let topId: number;
    let featureCount: number | undefined;
    let storyCount: number | undefined;
    const now = Date.now();

    if (existingMappings.length > 0) {
      const mapByKey = new Map(existingMappings.map((m: any) => [m.local_key, m]));
      const updateResult = await client.updateBacklog(backlog, mapByKey);
      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, parent_local_key, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // parent_local_key now comes straight from updateBacklog (it knows each new mapping's
      // true phase-epic parent) instead of being re-derived here with a fragile guess.
      for (const m of updateResult.newMappings) {
        insertMapping.run(workflowId, artifactId, m.ado_id, m.ado_type, m.ado_url, m.local_key, m.parent_local_key, m.title, now);
      }
      topId = updateResult.epicId;
      topUrl = client.getEpicUrl(topId);
    } else {
      const createResult = await client.createBacklog(backlog);
      const mainEpic = createResult.epics.find((e: { localKey: string }) => e.localKey === 'epic');
      topId = mainEpic.adoId;
      topUrl = client.getEpicUrl(topId);
      featureCount = createResult.features.length;
      storyCount = createResult.features.reduce((n: number, f: { storyAdoIds: number[] }) => n + f.storyAdoIds.length, 0);

      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, parent_local_key, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Map every epic (main + any phase epics) before features/stories, so their local_keys
      // exist for the feature rows below to reference as parent_local_key.
      for (const e of createResult.epics) {
        insertMapping.run(workflowId, artifactId, e.adoId, 'epic', client.getEpicUrl(e.adoId), e.localKey, null, e.title, now);
      }
      for (const f of createResult.features) {
        const featureKey = featureLocalKey(f.index);
        insertMapping.run(workflowId, artifactId, f.adoId, 'feature', client.getEpicUrl(f.adoId), featureKey, f.epicLocalKey, backlog.features[f.index].title, now);
        f.storyAdoIds.forEach((storyAdoId: number, si: number) => {
          const storyKey = storyLocalKey(featureKey, si);
          insertMapping.run(workflowId, artifactId, storyAdoId, 'story', client.getEpicUrl(storyAdoId), storyKey, featureKey, backlog.features[f.index].stories[si].title, now);
        });
      }
    }

    // Push epic URL back to Airtable if item originated there
    const itemRow = db.prepare<[string], { airtable_id: string | null }>('SELECT airtable_id FROM items WHERE id = ?').get(itemId);
    if (itemRow?.airtable_id) {
      pushLinksToAirtable(itemRow.airtable_id, { epicLink: topUrl }).catch(() => {});
    }

    logger.info(`Board push complete for workflow ${workflowId} — Epic #${topId} at ${topUrl}`);
    return topUrl;
  } catch (err: any) {
    logger.error(`Board push failed for workflow ${workflowId}: ${err.message}`);
    insertEvent(workflowId, 'error', 'story_decomposition', `Board sync failed: ${err.message}`, { error: err.message });
    return null;
  }
}

// ── Push QA artifact to ADO Test Plans ───────────────────────────────────────

/**
 * Push the latest qa_tests artifact for itemId to Azure Test Plans.
 * Returns the test plan URL or null.
 */
export async function pushTestPlanToAdo(workflowId: string, itemId: string): Promise<string | null> {
  if (!isAdoConfigured()) {
    logger.info(`Test plan push skipped — work items integration not set to ado`);
    return null;
  }

  try {
    const qaArtifact = db.prepare<[string], { id: number }>(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'qa_tests'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId);

    if (!qaArtifact) {
      logger.warn(`Test plan push: no QA artifact for item ${itemId}`);
      return null;
    }

    const qaRaw = await loadArtifactContentById(qaArtifact.id);
    if (!qaRaw) {
      logger.warn(`Test plan push: could not load QA artifact ${qaArtifact.id}`);
      return null;
    }

    let qa: any;
    try { qa = JSON.parse(stripJsonFence(qaRaw)); } catch {
      logger.warn('Test plan push: QA artifact is not valid JSON');
      return null;
    }

    const testCases = (qa.test_cases ?? qa.testCases ?? []) as any[];
    if (testCases.length === 0) {
      logger.warn('Test plan push: no test cases found in QA artifact');
      return null;
    }

    const storyMappings = db.prepare<[string], { local_key: string; ado_id: number; title: string }>(
      `SELECT local_key, ado_id, title FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'story'`
    ).all(workflowId);
    // Build map by both local_key (F1.S1) and title for fixtures that use story titles as refs
    const storyMap = new Map<string, number>();
    for (const m of storyMappings) {
      storyMap.set(m.local_key, m.ado_id);
      if (m.title) storyMap.set(m.title, m.ado_id);
    }
    if (storyMap.size === 0) {
      logger.warn('Test plan push: no story mappings found — test cases will be created without TestedBy links');
    }

    // Which epic (phase) each feature belongs to, so every test case can be routed to that
    // phase's own Test Plan via its story_ref's owning feature.
    const featureMappings = db.prepare<[string], { local_key: string; parent_local_key: string | null }>(
      `SELECT local_key, parent_local_key FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'feature'`
    ).all(workflowId);
    const featureKeyToEpicLocalKey = new Map(featureMappings.map(f => [f.local_key, f.parent_local_key ?? 'epic']));

    const epicMappings = db.prepare<[string], { local_key: string; title: string }>(
      `SELECT local_key, title FROM ado_work_item_map WHERE workflow_id = ? AND ado_type = 'epic'`
    ).all(workflowId);
    const epicTitleByLocalKey = new Map(epicMappings.map(e => [e.local_key, e.title]));

    const { groups, warnings } = groupTestCasesByEpic(testCases, featureKeyToEpicLocalKey);
    for (const warning of warnings) {
      insertEvent(workflowId, 'validation_warning', 'qa_engineer', `Test plan push: ${warning}`);
    }

    const workflow = db.prepare<[string], { summary: string | null; goal: string }>(
      'SELECT summary, goal FROM workflows WHERE id = ?'
    ).get(workflowId);
    const fallbackPlanName = (workflow?.summary ?? workflow?.goal.split('\n')[0] ?? 'Test Plan').slice(0, 60);

    const { getAzureDevOpsClient } = require('../integrations/azure-devops');
    const client = getAzureDevOpsClient();

    let mainPlanUrl: string | null = null;
    const now = Date.now();

    for (const [epicLocalKey, groupTestCases] of groups) {
      // Look up by item, not just this workflow_id — a change request, retry, or any other
      // path that re-runs epic_qa under a different workflow row for the same item must still
      // find and reuse that phase's one Test Plan instead of creating a second one in ADO.
      const existingMap = db.prepare<[string, string], { plan_id: number; plan_url: string; suite_ids: string; test_case_ids: string; root_suite_id?: number }>(`
        SELECT q.plan_id, q.plan_url, q.suite_ids, q.test_case_ids, q.root_suite_id
        FROM qa_test_plan_map q
        JOIN workflows w ON w.id = q.workflow_id
        WHERE w.item_id = ? AND q.epic_local_key = ?
        ORDER BY q.created_at DESC LIMIT 1
      `).get(itemId, epicLocalKey);

      const existing = existingMap ? {
        planId: existingMap.plan_id,
        rootSuiteId: existingMap.root_suite_id,
        suiteIds: JSON.parse(existingMap.suite_ids ?? '{}'),
        testCaseIds: JSON.parse(existingMap.test_case_ids ?? '{}'),
      } : undefined;

      const planName = (epicTitleByLocalKey.get(epicLocalKey) ?? fallbackPlanName).slice(0, 60);
      const result = await client.pushQATestPlan({ planName, testCases: groupTestCases, storyMap, existing });

      db.prepare(`
        INSERT OR REPLACE INTO qa_test_plan_map
          (workflow_id, artifact_id, epic_local_key, plan_id, root_suite_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(workflowId, qaArtifact.id, epicLocalKey, result.planId, result.rootSuiteId, result.planUrl,
         JSON.stringify(result.suiteIds), JSON.stringify(result.testCaseIds), groupTestCases.length, now);

      const planLabel = epicLocalKey === 'epic' ? 'main' : (epicTitleByLocalKey.get(epicLocalKey) ?? epicLocalKey);
      insertEvent(workflowId, 'ado_pushed', 'qa_engineer',
        `${groupTestCases.length} test case(s) pushed to the ${planLabel} Test Plan at ${result.planUrl}`,
        { ado_url: result.planUrl });

      if (epicLocalKey === 'epic') mainPlanUrl = result.planUrl;
    }

    const itemRow = db.prepare<[string], { airtable_id: string | null }>('SELECT airtable_id FROM items WHERE id = ?').get(itemId);
    if (itemRow?.airtable_id && mainPlanUrl) {
      pushLinksToAirtable(itemRow.airtable_id, { testPlanLink: mainPlanUrl }).catch(() => {});
    }

    logger.info(`Test plan push complete for workflow ${workflowId} — ${groups.size} plan(s) updated`);
    return mainPlanUrl;
  } catch (err: any) {
    logger.error(`Test plan push failed for workflow ${workflowId}: ${err.message}`);
    insertEvent(workflowId, 'error', 'qa_engineer', `Test plan push failed: ${err.message}`, { error: err.message });
    return null;
  }
}

// ── Airtable link-back helper ─────────────────────────────────────────────────

export async function pushLinksToAirtable(airtableId: string, updates: Record<string, string>): Promise<void> {
  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.roadmap !== 'airtable') return;
    const { AirtableClient } = require('../integrations/airtable');
    await new AirtableClient().updateItem(airtableId, updates as any);
    logger.info(`Airtable record ${airtableId} updated: ${Object.keys(updates).join(', ')}`);
  } catch (err: any) {
    logger.warn(`Failed to push links to Airtable (${airtableId}): ${err.message}`);
  }
}

/**
 * Push a pipeline status (e.g. "Researching", "Scoping", "Ready") to the
 * Airtable record an item originated from. No-op if the item has no
 * airtable_id (locally created items) or roadmap integration isn't Airtable.
 */
export async function pushItemStatusToAirtable(itemId: string, status: string): Promise<void> {
  const itemRow = db.prepare<[string], { airtable_id: string | null }>(
    'SELECT airtable_id FROM items WHERE id = ?'
  ).get(itemId);
  if (!itemRow?.airtable_id) return;
  await pushLinksToAirtable(itemRow.airtable_id, { status });
}
