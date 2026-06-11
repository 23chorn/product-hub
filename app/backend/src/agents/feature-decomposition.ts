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

  if (!parsed.features || !Array.isArray(parsed.features) || parsed.features.length === 0) {
    logger.warn(`No features found in epic_features artifact for workflow ${workflowId}`);
    return 0;
  }

  const featureCount = parsed.features.length;

  // Replace 'story_decomposition' in stage_sequence with feature-specific stages
  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  const storyDecompIndex = sequence.indexOf('story_decomposition');

  if (storyDecompIndex === -1) {
    logger.warn(`No 'story_decomposition' stage found in workflow ${workflowId} — skipping feature injection`);
    return 0;
  }

  // Replace story_decomposition with feature-specific collaborative refinement stages
  // Each story_decomposition_F* stage runs a 7-agent workflow (Product + QA + 4 Engineers)
  // Also remove standalone qa_engineer and tech_refinement stages (now embedded in the multi-agent workflow)
  const featureStages: string[] = [];
  for (let i = 0; i < featureCount; i++) {
    featureStages.push(`story_decomposition_F${i + 1}`);
  }

  // Build new sequence: replace story_decomposition, remove standalone qa_engineer and tech_refinement
  const newSequence = [
    ...sequence.slice(0, storyDecompIndex),
    ...featureStages,
    ...sequence.slice(storyDecompIndex + 1).filter(s => s !== 'qa_engineer' && s !== 'tech_refinement')
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

    if (!parsed.features || !Array.isArray(parsed.features)) {
      return null;
    }

    const totalFeatures = parsed.features.length;
    const featureTitle = parsed.features[featureIndex]?.title ?? `Feature ${featureIndex + 1}`;

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

  if (!epicFeatures.epic || !epicFeatures.features || epicFeatures.features.length === 0) {
    throw new Error('Invalid epic_features structure');
  }

  const { AzureDevOpsClient } = await import('../integrations/azure-devops');
  const client = new AzureDevOpsClient();

  // Create epic
  const epic = await client.createWorkItem({
    type: client['workItemTypes'].epic as any,
    title: epicFeatures.epic.title,
    description: epicFeatures.epic.description,
  });
  const epicId = epic.id!;

  logger.info(`[EPIC PUSH] Created epic #${epicId}: ${epicFeatures.epic.title}`);

  // Save epic mapping
  const epicUrl = client.getEpicUrl(epicId);
  const now = Date.now();
  db.prepare(`
    INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
    VALUES (?, NULL, ?, 'epic', ?, 'epic', ?, ?)
  `).run(workflowId, epicId, epicUrl, epicFeatures.epic.title, now);

  // Create all features under the epic (no stories yet)
  const featureIds: number[] = [];
  for (let i = 0; i < epicFeatures.features.length; i++) {
    const featureData = epicFeatures.features[i];
    const feature = await client.createWorkItem({
      type: client['workItemTypes'].feature as any,
      title: featureData.title,
      description: featureData.description,
      parentId: epicId,
    });
    featureIds.push(feature.id!);

    // Save feature mapping
    const featureUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${feature.id}`;
    db.prepare(`
      INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
      VALUES (?, NULL, ?, 'feature', ?, ?, ?, ?)
    `).run(workflowId, feature.id, featureUrl, `F${i + 1}`, featureData.title, now);

    logger.info(`[EPIC PUSH] Created feature #${feature.id}: ${featureData.title}`);
  }

  insertEvent(workflowId, 'ado_push', 'epic_feature_planner',
    `Pushed epic + ${featureIds.length} features to Azure DevOps. Stories will be added as each feature is decomposed.`);

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
): Promise<{ epicId: number; featureId: number; storyIds: number[] }> {
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

  if (!backlog.epic || !backlog.features || featureIndex >= backlog.features.length) {
    throw new Error(`Feature index ${featureIndex} out of range`);
  }

  const targetFeature = backlog.features[featureIndex];

  // Fetch epic mapping (should exist from pushEpicAndFeaturesToADO)
  const epicMapping = db.prepare<[string], { ado_id: number }>(
    `SELECT ado_id FROM ado_work_item_map
     WHERE workflow_id = ? AND ado_type = 'epic' AND local_key = 'epic'
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

  // Create stories under the existing feature
  const { AzureDevOpsClient } = await import('../integrations/azure-devops');
  const client = new AzureDevOpsClient();
  const storyIds: number[] = [];

  for (const storyData of targetFeature.stories) {
    const story = await client.createWorkItem({
      type: client['workItemTypes'].story as any,
      title: storyData.title,
      description: `<strong>As a</strong> ${storyData.persona}<br><strong>I want</strong> ${storyData.goal}<br><strong>So that</strong> ${storyData.benefit}`,
      acceptanceCriteria: storyData.acceptanceCriteria
        ?.map((ac: string) => {
          const parts = ac.split(/\b(Given|When|Then|And)\b/);
          return parts.map((p, i) => (i % 2 === 1 ? `<strong>${p}</strong>` : p)).join('');
        })
        .join('<br>'),
      effort: storyData.storyPoints ?? undefined,
      parentId: featureId,
    });
    storyIds.push(story.id!);
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
    `).run(workflowId, storyId, 'story', storyUrl, `F${featureIndex + 1}.S${i + 1}`, story.title, now);
  }

  logger.info(`[STORY PUSH] Added ${storyIds.length} stories to feature #${featureId}`);
  insertEvent(workflowId, 'ado_push', `story_decomposition_F${featureIndex + 1}`,
    `Added ${storyIds.length} stories to feature "${targetFeature.title}" in Azure DevOps`);

  return { epicId, featureId, storyIds };
}
