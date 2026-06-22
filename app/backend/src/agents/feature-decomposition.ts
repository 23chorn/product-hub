/**
 * Feature-by-Feature Story Decomposition
 *
 * Handles dynamic sub-stage injection for story_decomposition, breaking the work
 * into feature-specific stages with checkpoints after each feature.
 */

import db, { getPolicies } from '../data/database';
import { stmts, insertEvent, logger } from './workflow-db';
import { loadLatestArtifactContent } from './artifact-helpers';
import { featureLocalKey, storyLocalKey } from '../integrations/azure-devops-format';
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

/** Default max concurrent feature refinements per wave — overridable via the
 * `max_parallel_features` global policy. */
export const DEFAULT_MAX_PARALLEL_FEATURES = 3;

/**
 * Read the configured max parallel features from the global policies table
 * (rule_key: 'max_parallel_features'), falling back to DEFAULT_MAX_PARALLEL_FEATURES
 * when unset or malformed. Clamped to [1, 6] to bound worst-case concurrent LLM load
 * (each feature's refinement stage already fans out to ~6 agents internally).
 */
export function resolveMaxParallelFeatures(): number {
  const rows = getPolicies('global');
  const row = rows.find(r => r.rule_key === 'max_parallel_features');
  if (!row) return DEFAULT_MAX_PARALLEL_FEATURES;
  let n: number;
  try {
    const parsed = JSON.parse(row.rule_value);
    n = typeof parsed === 'number' ? parsed : parseInt(String(parsed), 10);
  } catch {
    n = parseInt(row.rule_value, 10);
  }
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PARALLEL_FEATURES;
  return Math.min(n, 6);
}

/**
 * Resolve each feature's `dependsOn` (array of exact title strings from the LLM) into
 * 0-based indices into the SAME flattened array `flattenFeatures()` produces — the
 * canonical order F1, F2, F3... is assigned from.
 *
 * Defensive: a title that doesn't match any feature (typo, paraphrase, hallucination)
 * is dropped with a warning — never throws, never drops the FEATURE itself, only the
 * unresolved edge (degrades that one reference to "independent"). A feature
 * referencing itself is also dropped with a warning (self-dependency is always invalid).
 */
export function resolveFeatureDependencies(
  flatFeatures: any[]
): { resolvedByIndex: Map<number, number[]>; warnings: string[] } {
  const titleToIndex = new Map<string, number>();
  flatFeatures.forEach((f, i) => {
    if (typeof f?.title === 'string' && f.title.trim()) {
      titleToIndex.set(f.title.trim().toLowerCase(), i);
    }
  });

  const resolvedByIndex = new Map<number, number[]>();
  const warnings: string[] = [];

  flatFeatures.forEach((f, i) => {
    const rawDeps: unknown[] = Array.isArray(f?.dependsOn) ? f.dependsOn : [];
    const resolved: number[] = [];
    for (const depTitle of rawDeps) {
      if (typeof depTitle !== 'string' || !depTitle.trim()) continue;
      const depIdx = titleToIndex.get(depTitle.trim().toLowerCase());
      if (depIdx === undefined) {
        warnings.push(`Feature "${f?.title}" depends on unresolved title "${depTitle}" — treated as independent`);
        continue;
      }
      if (depIdx === i) {
        warnings.push(`Feature "${f?.title}" lists itself as a dependency — ignored`);
        continue;
      }
      resolved.push(depIdx);
    }
    resolvedByIndex.set(i, [...new Set(resolved)]);
  });

  return { resolvedByIndex, warnings };
}

/**
 * Topologically layer features into "waves" using Kahn's algorithm by layers, then
 * split any layer wider than `maxConcurrency` into sequential sub-batches — each
 * batch becomes its own wave (simplest model: every wave is an independently
 * advanceable unit, no "part of a bigger family" special-casing elsewhere).
 *
 * Each returned wave is a list of 0-based feature indices that can run concurrently:
 * no member depends on another member of the same wave, and every prerequisite for
 * every member was satisfied by an earlier wave.
 *
 * Cycle handling: if a cycle is detected among any remaining features, this function
 * does NOT drop those features. It degrades the entire remaining (cyclic) group to
 * fully sequential single-member waves, in original index order, appended after all
 * acyclic features have been layered. Every feature index 0..N-1 appears in exactly
 * one wave, exactly once — never silently dropped.
 */
export function computeFeatureWaves(
  dependsOnIndices: number[][],
  maxConcurrency: number
): { waves: number[][]; hadCycle: boolean; cycleMembers: number[] } {
  const n = dependsOnIndices.length;
  const inDegree = new Array(n).fill(0);
  const dependents: number[][] = Array.from({ length: n }, () => []); // reverse edges

  for (let i = 0; i < n; i++) {
    const deps = (dependsOnIndices[i] ?? []).filter(d => d >= 0 && d < n && d !== i);
    inDegree[i] = deps.length;
    for (const d of deps) dependents[d].push(i);
  }

  const waves: number[][] = [];
  const resolved = new Array(n).fill(false);
  let remaining = n;

  while (remaining > 0) {
    // Layer = every unresolved node with in-degree 0 right now
    const layer: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!resolved[i] && inDegree[i] === 0) layer.push(i);
    }

    if (layer.length === 0) {
      // Cycle detected among all remaining nodes — break it by falling back to fully
      // sequential single-member waves over the remaining indices, in original order.
      const cycleMembers: number[] = [];
      for (let i = 0; i < n; i++) if (!resolved[i]) cycleMembers.push(i);
      for (const i of cycleMembers) {
        waves.push([i]);
        resolved[i] = true;
      }
      return { waves, hadCycle: true, cycleMembers };
    }

    // Cap this layer's concurrency: split into sequential batches of <= maxConcurrency,
    // each batch becomes its OWN wave.
    layer.sort((a, b) => a - b); // deterministic order matching F-key order
    for (let start = 0; start < layer.length; start += maxConcurrency) {
      waves.push(layer.slice(start, start + maxConcurrency));
    }

    for (const i of layer) {
      resolved[i] = true;
      remaining--;
      for (const dependent of dependents[i]) inDegree[dependent]--;
    }
  }

  return { waves, hadCycle: false, cycleMembers: [] };
}

/** Shape persisted into workflows.decomposition_metadata after feature injection. */
export interface DecompositionMetadata {
  feature_count?: number;
  max_parallel_features?: number;
  waves?: string[][];
  had_dependency_cycle?: boolean;
}

/** Parse decomposition_metadata, returning {} if absent/malformed (e.g. pre-existing workflows). */
export function parseDecompositionMetadata(raw: string | null | undefined): DecompositionMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as DecompositionMetadata;
  } catch {
    return {};
  }
}

/**
 * Find the wave (array of stage names) that contains `stageName`, or null if not
 * found — including for workflows with no wave metadata at all (pre-dating this
 * feature), in which case the caller should treat the stage as its own wave-of-one
 * (today's pre-existing sequential behavior).
 */
export function findWaveForStage(metadata: DecompositionMetadata, stageName: string | null): string[] | null {
  if (!stageName || !metadata.waves) return null;
  return metadata.waves.find(w => w.includes(stageName)) ?? null;
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

  // Replace story_decomposition with feature-specific collaborative refinement stages.
  // Each story_decomposition_F* stage runs a multi-agent workflow (platform-filtered participants).
  // Independent features are grouped into concurrent "waves" (bounded by maxConcurrency) using
  // each feature's resolved dependsOnIndices (stamped by the epic_feature_planner post-processing
  // step in workflow-stage-runner.ts); features with no dependency data default to fully independent.
  const dependsOnIndices: number[][] = allFeatures.map(f =>
    Array.isArray(f?.dependsOnIndices) ? f.dependsOnIndices : []
  );
  const maxConcurrency = resolveMaxParallelFeatures();
  const { waves, hadCycle, cycleMembers } = computeFeatureWaves(dependsOnIndices, maxConcurrency);

  if (hadCycle) {
    const cycleLabels = cycleMembers.map(i => `F${i + 1}`).join(', ');
    logger.warn(`[FEATURE DECOMP] Dependency cycle detected among features [${cycleLabels}] for workflow ${workflowId} — running them sequentially instead of in parallel`);
    insertEvent(workflowId, 'validation_warning', 'epic_feature_planner',
      `Dependency cycle detected among ${cycleMembers.length} feature(s) — running them sequentially instead of in parallel`,
      { cycle_members: cycleMembers.map(i => `F${i + 1}`) });
  }

  // Translate index-waves into stage-name waves, contiguous in stage_sequence order.
  const waveStageGroups: string[][] = waves.map(wave => wave.map(i => `story_decomposition_F${i + 1}`));
  const featureStages: string[] = waveStageGroups.flat();

  // Build new sequence: replace story_decomposition with wave-ordered F* stages + final merge
  const newSequence = [
    ...sequence.slice(0, storyDecompIndex),
    ...featureStages,
    'backlog_merge',  // Merge all isolated features into final backlog artifact
    ...sequence.slice(storyDecompIndex + 1)
  ];

  // Update the workflow's stage_sequence
  db.prepare(`
    UPDATE workflows
    SET stage_sequence = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(newSequence), Date.now(), workflowId);

  // Persist wave membership so advanceStageCore / checkpoint logic know which stage
  // names were kicked off together and must all complete before advancing past them.
  const existingMeta = parseDecompositionMetadata(workflow.decomposition_metadata);
  const decompositionMetadata: DecompositionMetadata = {
    ...existingMeta,
    feature_count: featureCount,
    max_parallel_features: maxConcurrency,
    waves: waveStageGroups,
    had_dependency_cycle: hadCycle,
  };
  db.prepare(`
    UPDATE workflows
    SET decomposition_metadata = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(decompositionMetadata), Date.now(), workflowId);

  const waveSummary = waveStageGroups.map(w => `[${w.join(', ')}]`).join(' → ');
  logger.info(`[FEATURE DECOMP] Injected ${featureCount} feature stages as ${waveStageGroups.length} wave(s) into workflow ${workflowId}: ${waveSummary}`);
  insertEvent(workflowId, 'stage_progress', 'epic_feature_planner',
    `Injected ${featureCount} feature stages across ${waveStageGroups.length} wave(s) — up to ${maxConcurrency} run concurrently: ${waveSummary}`);

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
 * Build a rich HTML description for an ADO Epic, folding in fields that have no dedicated
 * ADO field on the Epic work item type (business value, PRD link, out-of-scope items) so
 * they're visible in ADO rather than silently dropped.
 */
export function buildEpicDescription(opts: {
  initiativeDescription?: string;
  deliverable?: string;
  phaseLabel?: string;
  businessValue?: string;
  prdLink?: string;
  outOfScope?: string[];
}): string {
  const parts: string[] = [];
  if (opts.initiativeDescription) parts.push(opts.initiativeDescription);
  if (opts.deliverable) parts.push(`<strong>${opts.phaseLabel ?? 'This phase'} delivers:</strong> ${opts.deliverable}`);
  if (opts.businessValue) parts.push(`<strong>Business Value:</strong> ${opts.businessValue}`);
  if (opts.prdLink) parts.push(`<strong>PRD Reference:</strong> ${opts.prdLink}`);
  if (opts.outOfScope && opts.outOfScope.length > 0) {
    parts.push(`<strong>Out of Scope:</strong><br>${opts.outOfScope.map(o => `&bull; ${o}`).join('<br>')}`);
  }
  return parts.join('<br><br>');
}

/**
 * Build a rich HTML description for an ADO Feature, folding in fields that have no dedicated
 * ADO field on the Feature work item type (rationale, acceptance criteria, PRD traceability,
 * deferral notes) so they're visible in ADO rather than silently dropped.
 */
/**
 * Build the shared "initiative:<slug>" tag applied to every epic and feature created for
 * one epic_features push, so they're identifiable as belonging together in ADO even though
 * phase epics have no parent-child relationship to each other.
 */
function buildInitiativeTag(epicTitle: string): string {
  const slug = epicTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `initiative:${slug}`;
}

export function buildFeatureDescription(featureData: any): string {
  const parts: string[] = [];
  if (featureData.description) parts.push(featureData.description);
  if (featureData.rationale) parts.push(`<strong>Why this phase:</strong> ${featureData.rationale}`);

  const ac: string[] = featureData.acceptanceCriteria ?? featureData.acceptance_criteria ?? [];
  if (ac.length > 0) {
    parts.push(`<strong>Acceptance Criteria:</strong><br>${ac.map(a => `&bull; ${a}`).join('<br>')}`);
  }

  const prdRef = featureData.prdRef ?? featureData.prd_ref;
  const frRefs: string[] = prdRef?.functionalRequirements ?? prdRef?.functional_requirements ?? [];
  const nfrRefs: string[] = prdRef?.nonFunctionalRequirements ?? prdRef?.non_functional_requirements ?? [];
  const journeys: string[] = prdRef?.userJourneys ?? prdRef?.user_journeys ?? [];
  if (frRefs.length > 0 || nfrRefs.length > 0 || journeys.length > 0) {
    const refLines: string[] = [];
    if (frRefs.length > 0) refLines.push(`Functional: ${frRefs.join(', ')}`);
    if (nfrRefs.length > 0) refLines.push(`Non-Functional: ${nfrRefs.join(', ')}`);
    if (journeys.length > 0) refLines.push(`User Journeys: ${journeys.join('; ')}`);
    parts.push(`<strong>PRD Traceability:</strong><br>${refLines.join('<br>')}`);
  }

  if (featureData.deferredTo) {
    parts.push(`<strong>Deferred to:</strong> ${featureData.deferredTo}`);
  }

  return parts.join('<br><br>');
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

  // Load epic_features artifact. NOTE: 'epic_features_enriched' (written by the architect
  // stage) is a differently-shaped artifact for engineering context during story decomposition
  // — phases[].features[] with technical fields (target_repos, data_contracts) and no top-level
  // 'epic' header or 'title' field. It is not a superset of 'epic_features' and must not be used here.
  const { loadLatestArtifactContent } = await import('./artifact-helpers');
  const epicFeaturesContent = await loadLatestArtifactContent(workflow.item_id, 'epic_features');

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

  // Shared tag + naming prefix so sibling phase epics (which have no parent-child relationship
  // to each other in ADO) are still identifiable as one initiative.
  const initiativeTag = buildInitiativeTag(epicFeatures.epic.title);

  // Reference links back to the docs this epic was built from (Research, PRD, Solution
  // Architecture wiki pages + the Figma file) — already produced earlier in the pipeline,
  // so they're available now and get attached to every epic created below for easy reference.
  const { loadLatestArtifactWikiUrl } = await import('./artifact-helpers');
  const referenceLinks: Array<{ url: string; comment: string }> = [];
  const researchWikiUrl = loadLatestArtifactWikiUrl(workflow.item_id, 'analyst');
  if (researchWikiUrl) referenceLinks.push({ url: researchWikiUrl, comment: 'Research Brief' });
  const prdWikiUrl = loadLatestArtifactWikiUrl(workflow.item_id, 'prd');
  if (prdWikiUrl) referenceLinks.push({ url: prdWikiUrl, comment: 'PRD' });
  const architectureWikiUrl = loadLatestArtifactWikiUrl(workflow.item_id, 'architecture');
  if (architectureWikiUrl) referenceLinks.push({ url: architectureWikiUrl, comment: 'Solution Architecture' });
  const figmaDesignContent = await loadLatestArtifactContent(workflow.item_id, 'figma_design');
  if (figmaDesignContent) {
    try {
      const figmaCleaned = figmaDesignContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const figmaFileUrl = JSON.parse(figmaCleaned).figma_file_url;
      if (figmaFileUrl) referenceLinks.push({ url: figmaFileUrl, comment: 'Figma Mockups' });
    } catch {
      logger.warn('[EPIC PUSH] figma_design artifact present but not parseable for figma_file_url — skipping link');
    }
  }

  const attachReferenceLinks = async (epicId: number): Promise<void> => {
    for (const link of referenceLinks) {
      try {
        await client.addHyperlinkToWorkItem(epicId, link.url, link.comment);
      } catch (err: any) {
        logger.warn(`[EPIC PUSH] Failed to attach "${link.comment}" link to epic #${epicId}: ${err.message}`);
      }
    }
  };

  // New phases[] format: create one ADO epic per phase, features nested under it.
  // Legacy format: create a single ADO epic for the whole initiative.
  const featureIds: number[] = [];
  let firstEpicId: number | null = null;

  if (Array.isArray(epicFeatures.phases) && epicFeatures.phases.length > 0) {
    let globalFeatureIdx = 0;
    for (const phase of epicFeatures.phases) {
      // Always build the title from the initiative + phase label — phase.epicTitle from the
      // LLM is inconsistent about whether it references the initiative name, which made
      // sibling phase epics look unrelated in ADO.
      const phaseEpicTitle = `${epicFeatures.epic.title} — ${phase.label}`;
      const phaseEpic = await client.createWorkItem({
        type: client['workItemTypes'].epic as any,
        title: phaseEpicTitle,
        description: buildEpicDescription({
          initiativeDescription: epicFeatures.epic.description,
          deliverable: phase.deliverable,
          phaseLabel: phase.label,
          businessValue: epicFeatures.epic.businessValue,
          prdLink: epicFeatures.epic.prdLink,
          outOfScope: epicFeatures.outOfScope,
        }),
        tags: initiativeTag,
      });
      const phaseEpicId = phaseEpic.id!;
      if (firstEpicId === null) firstEpicId = phaseEpicId;
      await attachReferenceLinks(phaseEpicId);

      const phaseKey = `epic_${phase.label.toLowerCase().replace(/\s+/g, '_')}`;
      const phaseEpicUrl = client.getEpicUrl(phaseEpicId);
      db.prepare(`
        INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, NULL, ?, 'epic', ?, ?, ?, ?)
      `).run(workflowId, phaseEpicId, phaseEpicUrl, phaseKey, phaseEpicTitle, now);
      logger.info(`[EPIC PUSH] Created phase epic #${phaseEpicId}: ${phaseEpicTitle}`);

      for (const featureData of (phase.features ?? [])) {
        const featureKey = featureLocalKey(globalFeatureIdx);
        const featureTitle = `[${featureKey}] ${featureData.title}`;
        const feature = await client.createWorkItem({
          type: client['workItemTypes'].feature as any,
          title: featureTitle,
          description: buildFeatureDescription(featureData),
          parentId: phaseEpicId,
          tags: initiativeTag,
        });
        featureIds.push(feature.id!);
        const featureUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${feature.id}`;
        db.prepare(`
          INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
          VALUES (?, NULL, ?, 'feature', ?, ?, ?, ?)
        `).run(workflowId, feature.id, featureUrl, featureKey, featureTitle, now);
        logger.info(`[EPIC PUSH] Created feature #${feature.id} (${featureKey}): ${featureTitle}`);
        globalFeatureIdx++;
      }
    }
  } else {
    // Legacy single-epic format
    const epic = await client.createWorkItem({
      type: client['workItemTypes'].epic as any,
      title: epicFeatures.epic.title,
      description: buildEpicDescription({
        initiativeDescription: epicFeatures.epic.description,
        businessValue: epicFeatures.epic.businessValue,
        prdLink: epicFeatures.epic.prdLink,
        outOfScope: epicFeatures.outOfScope,
      }),
      tags: initiativeTag,
    });
    firstEpicId = epic.id!;
    await attachReferenceLinks(firstEpicId);
    const epicUrl = client.getEpicUrl(firstEpicId);
    db.prepare(`
      INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
      VALUES (?, NULL, ?, 'epic', ?, 'epic', ?, ?)
    `).run(workflowId, firstEpicId, epicUrl, epicFeatures.epic.title, now);
    logger.info(`[EPIC PUSH] Created epic #${firstEpicId}: ${epicFeatures.epic.title}`);

    for (let i = 0; i < allFeatures.length; i++) {
      const featureData = allFeatures[i];
      const featureKey = featureLocalKey(i);
      const featureTitle = `[${featureKey}] ${featureData.title}`;
      const feature = await client.createWorkItem({
        type: client['workItemTypes'].feature as any,
        title: featureTitle,
        description: buildFeatureDescription(featureData),
        parentId: firstEpicId,
        tags: initiativeTag,
      });
      featureIds.push(feature.id!);
      const featureUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${feature.id}`;
      db.prepare(`
        INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
        VALUES (?, NULL, ?, 'feature', ?, ?, ?, ?)
      `).run(workflowId, feature.id, featureUrl, featureKey, featureTitle, now);
      logger.info(`[EPIC PUSH] Created feature #${feature.id}: ${featureTitle}`);
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

  // Load this feature's isolated backlog artifact (backlog_F1, backlog_F2, ... — each
  // story_decomposition_F* stage saves its own feature in isolation, not an accumulated backlog).
  const { loadLatestArtifactContent } = await import('./artifact-helpers');
  const backlogContent = await loadLatestArtifactContent(workflow.item_id, `backlog_F${featureIndex + 1}`);
  if (!backlogContent) throw new Error(`No backlog_F${featureIndex + 1} artifact found`);

  // Parse backlog
  const cleaned = backlogContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonContent = jsonStart > 0 ? cleaned.slice(jsonStart) : cleaned;
  const backlog = JSON.parse(jsonContent);

  // The isolated artifact contains exactly this one feature.
  const allBacklogFeatures = flattenFeatures(backlog);
  if (!backlog.epic || allBacklogFeatures.length === 0) {
    throw new Error(`backlog_F${featureIndex + 1} artifact has no feature data`);
  }

  const targetFeature = allBacklogFeatures[0];

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
  const featureKey = featureLocalKey(featureIndex);

  // Fetch feature mapping (should exist from pushEpicAndFeaturesToADO)
  const featureMapping = db.prepare<[string, string], { ado_id: number }>(
    `SELECT ado_id FROM ado_work_item_map
     WHERE workflow_id = ? AND ado_type = 'feature' AND local_key = ?
     LIMIT 1`
  ).get(workflowId, featureKey);

  if (!featureMapping) {
    throw new Error(`Feature mapping for ${featureKey} not found — pushEpicAndFeaturesToADO should have created it`);
  }

  const featureId = featureMapping.ado_id;

  // Check if stories already exist for this feature (avoid duplicates)
  const existingStories = db.prepare<[string, string], { local_key: string; ado_id: number }>(
    `SELECT local_key, ado_id FROM ado_work_item_map
     WHERE workflow_id = ? AND ado_type = 'story' AND local_key LIKE ?
     ORDER BY local_key`
  ).all(workflowId, `${featureKey}.S%`);

  if (existingStories.length > 0) {
    logger.info(`[STORY PUSH] Feature ${featureKey} already has ${existingStories.length} stories in ADO — skipping duplicate creation`);
    const featureUrl = `https://dev.azure.com/${process.env.AZURE_DEVOPS_ORG}/${process.env.AZURE_DEVOPS_PROJECT}/_workitems/edit/${featureId}`;
    return { epicId, featureId, storyIds: existingStories.map(s => s.ado_id), testPlanId: null, testPlanUrl: null, testCaseCount: 0 };
  }

  // Create stories under the existing feature
  const { AzureDevOpsClient } = await import('../integrations/azure-devops');
  const client = new AzureDevOpsClient();
  const storyIds: number[] = [];
  const allTestCases: any[] = [];

  for (let si = 0; si < targetFeature.stories.length; si++) {
    const storyData = targetFeature.stories[si];
    // Support both old format (persona/goal/benefit) and new format (as_a/i_want/so_that)
    const persona = storyData.persona ?? storyData.as_a ?? '';
    const goal = storyData.goal ?? storyData.i_want ?? '';
    const benefit = storyData.benefit ?? storyData.so_that ?? '';
    const acceptanceCriteria = storyData.acceptanceCriteria ?? storyData.acceptance_criteria ?? [];
    const technicalAcceptanceCriteria = storyData.technical_acceptance_criteria ?? [];
    const effort = storyData.storyPoints ?? storyData.estimated_points ?? undefined;
    const platformRaw = storyData.platform;
    const platform: string[] = Array.isArray(platformRaw) ? platformRaw : platformRaw ? [String(platformRaw)] : [];
    const technicalNotes = storyData.technical_notes ?? storyData.agentContext ?? '';

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
      title: `[${storyLocalKey(featureKey, si)}] ${storyData.title}`,
      description,
      acceptanceCriteria: allAcceptanceCriteria,
      effort,
      tags,
      parentId: featureId,
    });
    storyIds.push(story.id!);
  }

  // QA test cases live in a separate qa_tests artifact (not embedded in story JSON) — load this
  // feature's via its own checkpoint so we get exactly the right one (qa_tests isn't a per-feature
  // artifact type, so "latest" alone can't be trusted to pick the right feature).
  const qaCheckpoint = db.prepare<[string, string], { artifact_id: number | null }>(
    `SELECT artifact_id FROM checkpoints WHERE workflow_id = ? AND stage = ? AND status = 'approved'
     ORDER BY created_at DESC LIMIT 1`
  ).get(workflowId, `story_decomposition_F${featureIndex + 1}_qa`);

  if (qaCheckpoint?.artifact_id) {
    try {
      const { loadArtifactContentById } = await import('./artifact-helpers');
      const qaContent = await loadArtifactContentById(qaCheckpoint.artifact_id);
      if (qaContent) {
        const qaCleaned = qaContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
        const qaJsonStart = qaCleaned.indexOf('{');
        const qaParsed = JSON.parse(qaJsonStart > 0 ? qaCleaned.slice(qaJsonStart) : qaCleaned);
        for (const tc of qaParsed.test_cases ?? []) {
          allTestCases.push({ ...tc, title: tc.title ?? tc.id ?? 'Test Case' });
        }
      }
    } catch (err: any) {
      logger.warn(`[STORY PUSH] Failed to load QA test cases for F${featureIndex + 1}: ${err.message}`);
    }
  }

  // Save story mappings
  const now = Date.now();
  for (let i = 0; i < storyIds.length; i++) {
    const storyId = storyIds[i];
    const storyUrl = `https://dev.azure.com/${client['organization']}/${client['project']}/_workitems/edit/${storyId}`;
    const story = targetFeature.stories[i];
    const storyKey = storyLocalKey(featureKey, i);
    db.prepare(`
      INSERT INTO ado_work_item_map (workflow_id, artifact_id, ado_id, ado_type, ado_url, local_key, title, created_at)
      VALUES (?, NULL, ?, 'story', ?, ?, ?, ?)
    `).run(workflowId, storyId, storyUrl, storyKey, `[${storyKey}] ${story.title}`, now);
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
