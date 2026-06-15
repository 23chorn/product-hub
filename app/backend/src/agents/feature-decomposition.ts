/**
 * Feature-by-Feature Story Decomposition
 *
 * Handles dynamic sub-stage injection for story_decomposition, breaking the work
 * into feature-specific stages with checkpoints after each feature.
 */

import db from '../data/database';
import { stmts, insertEvent, logger } from './workflow-db';
import { loadLatestArtifactContent } from './artifact-helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Flatten features from the epic_features artifact into a single ordered array.
 *
 * Handles both formats:
 *   - New: { phases: [{ label, features: [] }] }  — features nested under phases
 *   - Legacy: { features: [] }                     — flat features array on root
 *
 * Features extracted from the new format are annotated with `phase` from their
 * parent phase label, so downstream agents can see the phase for each feature.
 */
export function flattenFeatures(epicJson: any): any[] {
  if (Array.isArray(epicJson.phases)) {
    return epicJson.phases.flatMap((phase: any) =>
      Array.isArray(phase.features)
        ? phase.features.map((f: any) => ({
            ...f,
            phase: f.phase ?? phase.label,
          }))
        : []
    );
  }
  return Array.isArray(epicJson.features) ? epicJson.features : [];
}

/**
 * After epic_feature_planner completes and is approved, store feature metadata
 * for the story_decomposition stage to process iteratively.
 *
 * Instead of injecting separate stages, we store feature count in workflow metadata
 * so story_decomposition can loop through features internally with checkpoints.
 *
 * @param workflowId - The workflow to modify
 * @returns Number of features detected (for logging)
 */
export async function injectFeatureDecompositionStages(workflowId: string): Promise<number> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  // Load the epic_features artifact
  const epicFeaturesContent = await loadLatestArtifactContent(workflow.item_id, 'epic_features');
  if (!epicFeaturesContent) {
    logger.warn(`No epic_features artifact found for workflow ${workflowId} — skipping feature injection`);
    return 0;
  }

  let parsed;
  try {
    // Strip code fences if present
    const cleaned = epicFeaturesContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonContent = jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
    parsed = JSON.parse(jsonContent);
  } catch (err: any) {
    logger.error(`Failed to parse epic_features artifact for workflow ${workflowId}: ${err.message}`);
    return 0;
  }

  const allFeatures = flattenFeatures(parsed);
  if (allFeatures.length === 0) {
    logger.warn(`No features found in epic_features artifact for workflow ${workflowId}`);
    return 0;
  }

  const featureCount = allFeatures.length;

  // Replace 'story_decomposition' in stage_sequence with feature-specific stages
  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  const storyDecompIndex = sequence.indexOf('story_decomposition');

  if (storyDecompIndex === -1) {
    logger.warn(`No 'story_decomposition' stage found in workflow ${workflowId} — skipping feature injection`);
    return 0;
  }

  // Replace story_decomposition with feature-specific collaborative refinement stages
  // Each story_decomposition_F* stage runs a multi-agent workflow (platform-filtered participants)
  // Also remove standalone qa_engineer and tech_refinement stages (now embedded in the multi-agent workflow)
  const featureStages: string[] = [];
  for (let i = 0; i < featureCount; i++) {
    featureStages.push(`story_decomposition_F${i + 1}`);
  }

  // Build new sequence: replace story_decomposition with per-feature F* stages
  const newSequence = [
    ...sequence.slice(0, storyDecompIndex),
    ...featureStages,
    ...sequence.slice(storyDecompIndex + 1)
  ];

  // Update the workflow's stage_sequence
  db.prepare(`
    UPDATE workflows
    SET stage_sequence = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(newSequence), Date.now(), workflowId);

  logger.info(`[FEATURE DECOMP] Injected ${featureCount} feature stages into workflow ${workflowId}: ${featureStages.join(', ')}`);
  insertEvent(workflowId, 'stage_progress', 'epic_feature_planner',
    `Injected ${featureCount} feature stages: ${featureStages.join(', ')} — each will be reviewed separately`);

  return featureCount;
}

/**
 * Load the accumulated partial backlog (if exists) from disk.
 * Returns null if no backlog artifact exists yet.
 */
export async function loadPartialBacklog(itemId: string): Promise<string | null> {
  try {
    const artifact = db.prepare<[string], { file_path: string }>(`
      SELECT a.file_path FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = 'backlog'
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId);

    if (!artifact || !artifact.file_path) return null;

    const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
    const resolvedPath = path.isAbsolute(artifact.file_path)
      ? artifact.file_path
      : path.join(PROJECT_ROOT, artifact.file_path);

    if (!fs.existsSync(resolvedPath)) return null;

    return fs.readFileSync(resolvedPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Parse a feature-specific stage name like "story_decomposition_F3" or "qa_engineer_F3" and return
 * the feature index (0-based).
 * Returns null if the stage doesn't match the pattern.
 */
export function parseFeatureStage(stage: string): number | null {
  const match = stage.match(/^(?:story_decomposition|qa_engineer)_F(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) - 1; // Convert to 0-based index
}

/**
 * Check if a stage is a feature-specific decomposition stage.
 */
export function isFeatureStage(stage: string): boolean {
  return /^story_decomposition_F\d+$/.test(stage);
}

/**
 * Check if a stage is a feature-specific QA stage.
 */
export function isQaFeatureStage(stage: string): boolean {
  return /^qa_engineer_F\d+$/.test(stage);
}

/**
 * Build checkpoint metadata for a feature-specific stage.
 * Returns { featureIndex, totalFeatures, featureTitle } or null if not a feature stage.
 */
export async function buildFeatureCheckpointMetadata(
  stage: string,
  itemId: string
): Promise<{ featureIndex: number; totalFeatures: number; featureTitle: string } | null> {
  const featureIndex = parseFeatureStage(stage);
  if (featureIndex === null) return null;

  try {
    // Load epic/features artifact (try enriched first, then fallback)
    const { loadLatestArtifactContent } = await import('./artifact-helpers');
    let epicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features_enriched');
    if (!epicFeaturesContent) {
      epicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features');
    }

    if (!epicFeaturesContent) {
      logger.warn(`No epic_features artifact found for ${stage} metadata`);
      return null;
    }

    // Parse
    const cleaned = epicFeaturesContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonContent = jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
    const parsed = JSON.parse(jsonContent);

    const allFeatures = flattenFeatures(parsed);
    if (allFeatures.length === 0) return null;

    const totalFeatures = allFeatures.length;
    const featureTitle = allFeatures[featureIndex]?.title ?? `Feature ${featureIndex + 1}`;

    return { featureIndex, totalFeatures, featureTitle };
  } catch (err: any) {
    logger.warn(`Failed to build feature checkpoint metadata: ${err.message}`);
    return null;
  }
}

/**
 * Push epic + all features (without stories) to ADO after epic_feature_planner approval.
 * Creates the epic and feature work items as placeholders. Stories are added later
 * by pushFeatureToADO() as each feature is decomposed.
 *
 * @param workflowId - The workflow ID
 * @returns ADO epic ID and feature IDs
 */
export async function pushEpicAndFeaturesToADO(
  workflowId: string
): Promise<{ epicId: number; featureIds: number[] }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  logger.info(`[EPIC PUSH] Looking for epic_features artifact for item_id=${workflow.item_id}`);

  // Load epic_features artifact (try enriched first, then fallback)
  const { loadLatestArtifactContent } = await import('./artifact-helpers');
  let epicFeaturesContent = await loadLatestArtifactContent(workflow.item_id, 'epic_features_enriched');
  if (!epicFeaturesContent) {
    logger.info(`[EPIC PUSH] No epic_features_enriched found, trying epic_features`);
    epicFeaturesContent = await loadLatestArtifactContent(workflow.item_id, 'epic_features');
  }

  if (!epicFeaturesContent) {
    // Debug: check what artifacts exist
    const allArtifacts = db.prepare(`
      SELECT a.id, a.type, a.created_at, a.file_path
      FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ?
      ORDER BY a.created_at DESC
    `).all(workflow.item_id);
    logger.error(`[EPIC PUSH] No epic_features artifact found for item ${workflow.item_id}. Available artifacts: ${JSON.stringify(allArtifacts)}`);
    throw new Error('No epic_features artifact found');
  }

  logger.info(`[EPIC PUSH] Loaded epic_features artifact (${epicFeaturesContent.length} chars)`);

  // Parse
  const cleaned = epicFeaturesContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonContent = jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
  const epicFeatures = JSON.parse(jsonContent);

  const allFeatures = flattenFeatures(epicFeatures);
  if (!epicFeatures.epic || allFeatures.length === 0) {
    throw new Error('Invalid epic_features structure — missing epic header or no features found');
  }

  const { AzureDevOpsClient } = await import('../integrations/azure-devops');
  const client = new AzureDevOpsClient();
  const now = Date.now();

  // New phases[] format: create one ADO epic per phase, features nested under it.
  // Legacy format: create a single ADO epic for the whole initiative.
  const featureIds: number[] = [];
  let firstEpicId: number | null = null;

  if (Array.isArray(epicFeatures.phases) && epicFeatures.phases.length > 0) {
    let globalFeatureIdx = 0;
    for (const phase of epicFeatures.phases) {
      const phaseEpicTitle = phase.epicTitle ?? `${phase.label} — ${epicFeatures.epic.title}`;
      const phaseEpic = await client.createWorkItem({
        type: client['workItemTypes'].epic as any,
        title: phaseEpicTitle,
        description: `${phase.deliverable ?? ''} (${phase.label})`.trim(),
      });
      const phaseEpicId = phaseEpic.id!;
      if (firstEpicId === null) firstEpicId = phaseEpicId;

      const phaseKey = `epic_${phase.label.toLowerCase().replace(/\s+/g, '_')}`;
      const phaseEpicUrl = client.getEpicUrl(phaseEpicId);
      db.prepare(`
        INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, NULL, ?, 'epic', ?, ?, ?, ?)
      `).run(workflowId, phaseEpicId, phaseEpicUrl, phaseKey, phaseEpicTitle, now);
      logger.info(`[EPIC PUSH] Created phase epic #${phaseEpicId}: ${phaseEpicTitle}`);

      for (const featureData of (phase.features ?? [])) {
        const feature = await client.createWorkItem({
          type: client['workItemTypes'].feature as any,
          title: featureData.title,
          description: featureData.description,
          parentId: phaseEpicId,
        });
        featureIds.push(feature.id!);
        const featureUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${feature.id}`;
        db.prepare(`
          INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
          VALUES (?, NULL, ?, 'feature', ?, ?, ?, ?)
        `).run(workflowId, feature.id, featureUrl, `F${globalFeatureIdx + 1}`, featureData.title, now);
        logger.info(`[EPIC PUSH] Created feature #${feature.id} (F${globalFeatureIdx + 1}): ${featureData.title}`);
        globalFeatureIdx++;
      }
    }
  } else {
    // Legacy single-epic format
    const epic = await client.createWorkItem({
      type: client['workItemTypes'].epic as any,
      title: epicFeatures.epic.title,
      description: epicFeatures.epic.description,
    });
    firstEpicId = epic.id!;
    const epicUrl = client.getEpicUrl(firstEpicId);
    db.prepare(`
      INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
      VALUES (?, NULL, ?, 'epic', ?, 'epic', ?, ?)
    `).run(workflowId, firstEpicId, epicUrl, epicFeatures.epic.title, now);
    logger.info(`[EPIC PUSH] Created epic #${firstEpicId}: ${epicFeatures.epic.title}`);

    for (let i = 0; i < allFeatures.length; i++) {
      const featureData = allFeatures[i];
      const feature = await client.createWorkItem({
        type: client['workItemTypes'].feature as any,
        title: featureData.title,
        description: featureData.description,
        parentId: firstEpicId,
      });
      featureIds.push(feature.id!);
      const featureUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${feature.id}`;
      db.prepare(`
        INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, NULL, ?, 'feature', ?, ?, ?, ?)
      `).run(workflowId, feature.id, featureUrl, `F${i + 1}`, featureData.title, now);
      logger.info(`[EPIC PUSH] Created feature #${feature.id}: ${featureData.title}`);
    }
  }

  const epicId = firstEpicId!;
  insertEvent(workflowId, 'ado_push', 'epic_feature_planner',
    `Pushed ${Array.isArray(epicFeatures.phases) ? epicFeatures.phases.length + ' phase epic(s)' : 'epic'} + ${featureIds.length} features to Azure DevOps. Stories will be added as each feature is decomposed.`);

  return { epicId, featureIds };
}

/**
 * Push stories for a specific feature to ADO after story_decomposition_F{N} approval.
 * Assumes epic and features were already created by pushEpicAndFeaturesToADO().
 * Adds stories to the existing feature work item.
 *
 * @param workflowId - The workflow ID
 * @param featureIndex - 0-based feature index
 * @returns ADO epic ID, feature ID, and story IDs
 */
export async function pushFeatureToADO(
  workflowId: string,
  featureIndex: number
): Promise<{ epicId: number; featureId: number; storyIds: number[]; testPlanId: number | null; testPlanUrl: string | null; testCaseCount: number }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  // Load accumulated backlog
  const { loadLatestArtifactContent } = await import('./artifact-helpers');
  const backlogContent = await loadLatestArtifactContent(workflow.item_id, 'backlog');
  if (!backlogContent) throw new Error('No backlog artifact found');

  // Parse backlog
  const cleaned = backlogContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonContent = jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
  const backlog = JSON.parse(jsonContent);

  const allBacklogFeatures = flattenFeatures(backlog);
  if (!backlog.epic || allBacklogFeatures.length === 0 || featureIndex >= allBacklogFeatures.length) {
    throw new Error(`Feature index ${featureIndex} out of range`);
  }

  const targetFeature = allBacklogFeatures[featureIndex];

  // Fetch epic mapping — phase epics use 'epic_mvp', 'epic_phase_1', etc.; legacy uses 'epic'
  const epicMapping = db.prepare<[string], { ado_id: number }>(
    `SELECT ado_id FROM ado_work_item_map
     WHERE workflow_id = ? AND ado_type = 'epic'
     ORDER BY created_at ASC
     LIMIT 1`
  ).get(workflowId);

  if (!epicMapping) {
    throw new Error(`Epic mapping not found for workflow ${workflowId} — pushEpicAndFeaturesToADO should have created it`);
  }

  const epicId = epicMapping.ado_id;

  // Fetch feature mapping (should exist from pushEpicAndFeaturesToADO)
  const featureMapping = db.prepare<[string, string], { ado_id: number }>(
    `SELECT ado_id FROM ado_work_item_map
     WHERE workflow_id = ? AND ado_type = 'feature' AND local_key = ?
     LIMIT 1`
  ).get(workflowId, `F${featureIndex + 1}`);

  if (!featureMapping) {
    throw new Error(`Feature mapping for F${featureIndex + 1} not found — pushEpicAndFeaturesToADO should have created it`);
  }

  const featureId = featureMapping.ado_id;

  // Check if stories already exist for this feature (avoid duplicates)
  const existingStories = db.prepare<[string, string], { local_key: string; ado_id: number }>(
    `SELECT local_key, ado_id FROM ado_work_item_map
     WHERE workflow_id = ? AND ado_type = 'story' AND local_key LIKE ?
     ORDER BY local_key`
  ).all(workflowId, `F${featureIndex + 1}.S%`);

  if (existingStories.length > 0) {
    logger.info(`[STORY PUSH] Feature F${featureIndex + 1} already has ${existingStories.length} stories in ADO — skipping duplicate creation`);
    const featureUrl = `https://dev.azure.com/${process.env.AZURE_DEVOPS_ORG}/${process.env.AZURE_DEVOPS_PROJECT}/_workitems/edit/${featureId}`;
    return { epicId, featureId, storyIds: existingStories.map(s => s.ado_id), testPlanId: null, testPlanUrl: null, testCaseCount: 0 };
  }

  // Create stories under the existing feature
  const { AzureDevOpsClient } = await import('../integrations/azure-devops');
  const client = new AzureDevOpsClient();
  const storyIds: number[] = [];
  const allTestCases: any[] = [];

  for (const storyData of targetFeature.stories) {
    // Support both old format (persona/goal/benefit) and new format (as_a/i_want/so_that)
    const persona = storyData.persona ?? storyData.as_a ?? '';
    const goal = storyData.goal ?? storyData.i_want ?? '';
    const benefit = storyData.benefit ?? storyData.so_that ?? '';
    const acceptanceCriteria = storyData.acceptanceCriteria ?? storyData.acceptance_criteria ?? [];
    const technicalAcceptanceCriteria = storyData.technical_acceptance_criteria ?? [];
    const effort = storyData.storyPoints ?? storyData.estimated_points ?? undefined;
    const platform = storyData.platform ?? [];
    const technicalNotes = storyData.technical_notes ?? storyData.agentContext ?? '';
    const testCases = storyData.test_cases ?? [];

    // PRD traceability refs
    const prdRef = storyData.prd_ref ?? storyData.prdRef;
    const frRefs: string[] = prdRef?.functional_requirements ?? prdRef?.functionalRequirements ?? [];
    const nfrRefs: string[] = prdRef?.non_functional_requirements ?? prdRef?.nonFunctionalRequirements ?? [];

    // Build description with user story + PRD traceability + technical notes
    let description = `<strong>As a</strong> ${persona}<br><strong>I want</strong> ${goal}<br><strong>So that</strong> ${benefit}`;

    // Add PRD traceability block
    if (frRefs.length > 0 || nfrRefs.length > 0) {
      description += `<br><br><strong>PRD Traceability:</strong><br>`;
      if (frRefs.length > 0) description += `Functional: ${frRefs.join(', ')}<br>`;
      if (nfrRefs.length > 0) description += `Non-Functional: ${nfrRefs.join(', ')}`;
    }

    // Add technical notes if present
    if (technicalNotes) {
      description += `<br><br><strong>Technical Notes:</strong><br>${typeof technicalNotes === 'string' ? technicalNotes : JSON.stringify(technicalNotes)}`;
    }

    // Build acceptance criteria (product + technical combined)
    const allAcceptanceCriteria = [
      ...acceptanceCriteria.map((ac: string) => {
        const parts = ac.split(/\b(Given|When|Then|And)\b/);
        return parts.map((p, i) => (i % 2 === 1 ? `<strong>${p}</strong>` : p)).join('');
      }),
      ...(technicalAcceptanceCriteria.length > 0 ? ['<hr><strong>Technical Acceptance Criteria:</strong>'] : []),
      ...technicalAcceptanceCriteria.map((tac: string) => `⚙ ${tac}`)
    ].join('<br>');

    // Convert platform array to semicolon-separated tags for ADO
    const tags = platform.length > 0 ? platform.join('; ') : undefined;

    const story = await client.createWorkItem({
      type: client['workItemTypes'].story as any,
      title: storyData.title,
      description,
      acceptanceCriteria: allAcceptanceCriteria,
      effort,
      tags,
      parentId: featureId,
    });
    storyIds.push(story.id!);

    // Collect test cases for this story (will push to Test Plans after all stories created)
    if (testCases.length > 0) {
      for (const tc of testCases) {
        // Generate title from scenario if missing (fixture format may not include title)
        let title = tc.title;
        if (!title && tc.scenario) {
          // Use the first "Then" statement as the title
          const firstThen = tc.scenario.then?.[0] ?? tc.scenario.given?.[0] ?? tc.id;
          title = firstThen.length > 80 ? `${firstThen.slice(0, 77)}...` : firstThen;
        }
        if (!title) {
          title = tc.id ?? 'Test Case';
        }

        allTestCases.push({
          ...tc,
          title,
          story_ref: storyData.story_id ?? storyData.title,
          story_ado_id: story.id,
        });
      }
    }
  }

  // Save story mappings
  const now = Date.now();
  for (let i = 0; i < storyIds.length; i++) {
    const storyId = storyIds[i];
    const storyUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${storyId}`;
    const story = targetFeature.stories[i];
    db.prepare(`
      INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
      VALUES (?, NULL, ?, 'story', ?, ?, ?, ?)
    `).run(workflowId, storyId, storyUrl, `F${featureIndex + 1}.S${i + 1}`, story.title, now);
  }

  logger.info(`[STORY PUSH] Added ${storyIds.length} stories to feature #${featureId}`);

  // Push test cases to ADO Test Plans if any were collected
  // Use a single epic-level test plan across all features (cumulative)
  let testPlanId: number | null = null;
  let testPlanUrl: string | null = null;
  if (allTestCases.length > 0) {
    try {
      // Build story map for linking test cases to stories
      const storyMap = new Map<string, number>();
      for (let i = 0; i < targetFeature.stories.length; i++) {
        const story = targetFeature.stories[i];
        const storyId = storyIds[i];
        if (story.story_id) {
          storyMap.set(story.story_id, storyId);
        }
        if (story.title) {
          storyMap.set(story.title, storyId);
        }
      }

      // Check if test plan already exists for this workflow (epic-level plan shared across features)
      const existingPlan = db.prepare<[string], { plan_id: number; root_suite_id: number; plan_url: string; suite_ids: string; test_case_ids: string }>(
        'SELECT plan_id, root_suite_id, plan_url, suite_ids, test_case_ids FROM qa_test_plan_map WHERE workflow_id = ? LIMIT 1'
      ).get(workflowId);

      const existing = existingPlan ? {
        planId: existingPlan.plan_id,
        rootSuiteId: existingPlan.root_suite_id,
        suiteIds: JSON.parse(existingPlan.suite_ids ?? '{}'),
        testCaseIds: JSON.parse(existingPlan.test_case_ids ?? '{}'),
      } : undefined;

      // Use epic title for plan name (shared across all features)
      const workflow = db.prepare<[string], { summary: string | null; goal: string }>(
        'SELECT summary, goal FROM workflows WHERE id = ?'
      ).get(workflowId);
      const planName = (workflow?.summary ?? backlog.epic?.title ?? 'Test Plan').slice(0, 60);

      const result = await client.pushQATestPlan({ planName, testCases: allTestCases, storyMap, existing });
      testPlanId = result.planId;
      testPlanUrl = result.planUrl;

      // Save test plan mapping (INSERT OR REPLACE so we update the same row for all features)
      db.prepare(`
        INSERT OR REPLACE INTO qa_test_plan_map
          (workflow_id, artifact_id, plan_id, root_suite_id, plan_url, suite_ids, test_case_ids, test_case_count, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflowId,
        result.planId,
        result.rootSuiteId,
        result.planUrl,
        JSON.stringify(result.suiteIds),
        JSON.stringify(result.testCaseIds),
        allTestCases.length,  // This is just the count for this feature; actual total is in ADO
        now
      );

      logger.info(`[TEST PLAN PUSH] ${existing ? 'Updated' : 'Created'} test plan #${testPlanId} — added ${allTestCases.length} test cases for feature "${targetFeature.title}"`);
    } catch (err: any) {
      logger.error(`[TEST PLAN PUSH] Failed to push test cases for feature F${featureIndex + 1}: ${err.message}`);
      logger.error(`[TEST PLAN PUSH ERROR] ${err.stack}`);
    }
  }

  insertEvent(workflowId, 'ado_push', `story_decomposition_F${featureIndex + 1}`,
    `Added ${storyIds.length} stories to feature "${targetFeature.title}" in Azure DevOps`);

  return { epicId, featureId, storyIds, testPlanId, testPlanUrl, testCaseCount: allTestCases.length };
}
