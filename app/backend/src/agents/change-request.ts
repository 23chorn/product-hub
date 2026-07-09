/**
 * Change Request — targeted post-completion artifact updates.
 *
 * Instead of full-stage reruns, CRs allow modifying specific sections of
 * specific artifacts. The Coordinator assesses which stages are affected,
 * then only those stages run with conversation-threaded revision briefs.
 */

import db from '../data/database';
import { getCoordinator } from './workflow-agents';
import {
  reiterateFromStage,
  getWorkflowStatus,
  advanceStage,
} from './workflow-router';
import {
  loadPriorDraftForStage,
  loadArtifactSummary,
} from './artifact-helpers';
import {
  STAGE_SESSION_MAP,
  STAGE_ARTIFACT_TYPE,
  STAGE_LABELS_INTERNAL,
} from './stage-metadata';
import {
  collapseFeatureDecompositionStages,
  expandFeatureDecompositionStages,
  extractFeatureDecompositionStages,
} from './feature-decomposition';
import { sessionManager } from '../session/session-manager';
import { SpecialistAgent } from './specialist-agent';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import Logger from '../utils/logger';

const logger = new Logger('CHANGE-REQUEST');

// ── DB row types ─────────────────────────────────────────────────────────────

export interface ChangeRequestRow {
  id: number;
  workflow_id: string;
  type: string;
  description: string;
  impact_assessment: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  status: string;
  current_stage: string | null;
  stage_sequence: string;
  policy_overrides: string;
  created_at: number;
  updated_at: number;
}

interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: string;
}

// ── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  insertCR: db.prepare(`
    INSERT INTO change_requests (workflow_id, type, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `),
  getCR: db.prepare<[number], ChangeRequestRow>('SELECT * FROM change_requests WHERE id = ?'),
  listCRs: db.prepare<[string], ChangeRequestRow>(
    'SELECT * FROM change_requests WHERE workflow_id = ? ORDER BY created_at DESC'
  ),
  updateCRStatus: db.prepare('UPDATE change_requests SET status = ?, updated_at = ? WHERE id = ?'),
  updateCRAssessment: db.prepare(
    'UPDATE change_requests SET impact_assessment = ?, status = ?, updated_at = ? WHERE id = ?'
  ),
  getWorkflow: db.prepare<[string], WorkflowRow>('SELECT * FROM workflows WHERE id = ?'),
  getActiveCR: db.prepare<[string], ChangeRequestRow>(
    `SELECT * FROM change_requests WHERE workflow_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`
  ),
  getApprovedCheckpoints: db.prepare<[string], CheckpointRow>(`
    SELECT * FROM checkpoints WHERE workflow_id = ? AND status = 'approved' ORDER BY created_at ASC
  `),
  insertCRArtifactVersion: db.prepare(`
    INSERT INTO cr_artifact_versions (change_request_id, stage, artifact_id, parent_artifact_id, version, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getLatestCRVersion: db.prepare<[number, string], { version: number }>(
    'SELECT MAX(version) as version FROM cr_artifact_versions WHERE change_request_id = ? AND stage = ?'
  ),
  insertEvent: db.prepare(`
    INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
};

function insertEvent(
  workflowId: string,
  eventType: string,
  stage: string | null,
  summary: string,
  details?: Record<string, unknown>
): void {
  stmts.insertEvent.run(
    workflowId, eventType, stage, summary,
    details ? JSON.stringify(details) : null,
    Date.now()
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new change request for a completed workflow.
 */
export function createChangeRequest(
  workflowId: string,
  type: string,
  description: string
): ChangeRequestRow {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'complete') {
    throw new Error(`Workflow ${workflowId} is not complete (status: ${workflow.status})`);
  }

  const validTypes = ['scope', 'direction', 'constraint', 'stakeholder', 'technical', 'correction'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid CR type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }

  const now = Date.now();
  const result = stmts.insertCR.run(workflowId, type, description, now, now);
  const crId = result.lastInsertRowid as number;

  insertEvent(workflowId, 'cr_created', null, `Change request created: ${description.slice(0, 200)}`, {
    crId, type,
  });

  logger.info(`Created CR #${crId} for workflow ${workflowId}: [${type}] ${description.slice(0, 100)}`);
  return stmts.getCR.get(crId)!;
}

/**
 * Get a change request by ID.
 */
export function getChangeRequest(crId: number): ChangeRequestRow | undefined {
  return stmts.getCR.get(crId);
}

/**
 * List all change requests for a workflow.
 */
export function listChangeRequests(workflowId: string): ChangeRequestRow[] {
  return stmts.listCRs.all(workflowId);
}

/**
 * Cancel a pending or assessed change request.
 */
export function cancelChangeRequest(crId: number): void {
  const cr = stmts.getCR.get(crId);
  if (!cr) throw new Error(`Change request not found: ${crId}`);
  if (cr.status !== 'pending' && cr.status !== 'assessed') {
    throw new Error(`Cannot cancel CR #${crId} in status "${cr.status}"`);
  }
  stmts.updateCRStatus.run('cancelled', Date.now(), crId);
  logger.info(`Cancelled CR #${crId}`);
}

/**
 * Assess the impact of a change request using the Coordinator.
 * Streams the assessment via SSE. Returns the assessment JSON.
 */
export async function* assessImpact(
  crId: number
): AsyncGenerator<string, { affected_stages: string[]; summary: string; cleanedText: string }, unknown> {
  const cr = stmts.getCR.get(crId);
  if (!cr) throw new Error(`Change request not found: ${crId}`);
  if (cr.status !== 'pending') {
    throw new Error(`CR #${crId} is not pending (status: ${cr.status})`);
  }

  const workflow = stmts.getWorkflow.get(cr.workflow_id);
  if (!workflow) throw new Error(`Workflow not found: ${cr.workflow_id}`);

  const stageSequence: string[] = JSON.parse(workflow.stage_sequence);

  // Collapse the per-feature story_decomposition_F<n>/backlog_merge/epic_qa block down to
  // one 'story_decomposition' entry for stage-selection purposes — a completed workflow's
  // real stage_sequence has one row per feature, which would otherwise make the coordinator
  // (and the human confirming its picks) treat N individual feature stages as separately
  // selectable. They aren't: if epic_feature_planner reruns, the whole block gets replaced
  // wholesale regardless (see syncCrStageSequenceAfterFeatureInjection), and the exact F#
  // stages shown here may not even exist anymore once it does. executeChangeRequest expands
  // this placeholder back to whatever the real current block is when the CR actually runs.
  const collapsedStageSequence = collapseFeatureDecompositionStages(stageSequence);

  // Load artifact summaries for each approved stage
  const approvedCheckpoints = stmts.getApprovedCheckpoints.all(cr.workflow_id);
  const artifactSummaries: string[] = [];
  for (const cp of approvedCheckpoints) {
    if (!cp.artifact_id) continue;
    const summary = loadArtifactSummary(cp.artifact_id);
    if (summary) {
      const label = STAGE_LABELS_INTERNAL[cp.stage] ?? cp.stage;
      artifactSummaries.push(`### ${label}\n${summary}`);
    }
  }

  // Build the assessment prompt
  const coordinator = getCoordinator();
  const systemPrompt = coordinator.buildSystemPrompt(cr.workflow_id);

  const assessmentStages = stageSequence
    .filter(s => s !== 'critic' && s !== 'curator')
    .map(s => STAGE_LABELS_INTERNAL[s] ?? s)
    .join(', ');

  const userMessage = `You are assessing the impact of a change request on a completed workflow.

## Change Request
- **Type:** ${cr.type}
- **Description:** ${cr.description}

## Workflow Goal
${workflow.goal}

## Completed Artifacts
${artifactSummaries.join('\n\n') || '(no artifacts available)'}

## Available Stages
${collapsedStageSequence.filter(s => s !== 'critic' && s !== 'curator').map(s => `- ${s} (${STAGE_LABELS_INTERNAL[s] ?? s})`).join('\n')}

## Instructions
Analyze which stages need to be re-run to address this change request. Write a clear, human-readable assessment:

1. **What changes** — summarize what specifically needs to change in plain language
2. **Which stages are affected** — list each affected stage by name and briefly explain why
3. **Cascading impact** — note if the change cascades downstream (e.g., a scope change affects the PRD, which affects the architecture and backlog)

Write conversationally for a product manager audience. Do NOT include raw JSON in your response.

After your assessment, on the very last line of your response, include this machine-readable tag (it will be hidden from the user):
IMPACT_JSON:{"affected_stages": ["stage_key1"], "summary": "one-sentence summary"}

Only include stages from: ${collapsedStageSequence.filter(s => s !== 'critic' && s !== 'curator').join(', ')}`;

  const resolvedModel = resolveAgentModel('coordinator');
  let fullResponse = '';

  for await (const chunk of streamAI(resolvedModel, systemPrompt, [{ role: 'user', content: userMessage }])) {
    fullResponse += chunk;
    yield chunk;
  }

  // Parse the assessment JSON from the response
  let assessment: { affected_stages: string[]; summary: string };
  try {
    // Try IMPACT_JSON: tag first (preferred format)
    const tagMatch = fullResponse.match(/IMPACT_JSON:\s*(\{[\s\S]*?\})\s*$/);
    // Fallback: fenced JSON block
    const jsonMatch = !tagMatch ? fullResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) : null;
    // Fallback: raw JSON
    const rawMatch = !tagMatch && !jsonMatch ? fullResponse.match(/\{"affected_stages"[\s\S]*?\}/) : null;

    const jsonStr = tagMatch?.[1] ?? jsonMatch?.[1] ?? rawMatch?.[0];
    if (jsonStr) {
      assessment = JSON.parse(jsonStr);
    } else {
      assessment = {
        affected_stages: collapsedStageSequence.filter(s => s !== 'critic' && s !== 'curator'),
        summary: 'Could not parse assessment — defaulting to all stages.',
      };
    }

    // Validate stages
    const validStages = new Set(collapsedStageSequence);
    assessment.affected_stages = assessment.affected_stages.filter(s => validStages.has(s));
    if (assessment.affected_stages.length === 0) {
      assessment.affected_stages = collapsedStageSequence.filter(s => s !== 'critic' && s !== 'curator');
      assessment.summary += ' (No valid stages found — defaulting to all stages.)';
    }
  } catch {
    assessment = {
      affected_stages: collapsedStageSequence.filter(s => s !== 'critic' && s !== 'curator'),
      summary: 'Assessment parsing failed — defaulting to all stages.',
    };
  }

  // Strip the machine-readable JSON from the response so only the human-readable
  // assessment remains in the coordinator message
  fullResponse = fullResponse
    .replace(/\n*IMPACT_JSON:\s*\{[\s\S]*?\}\s*$/, '')
    .replace(/\n*```(?:json)?\s*\{[\s\S]*?\}\s*```\s*$/, '')
    .trim();

  // Store the assessment
  stmts.updateCRAssessment.run(
    JSON.stringify(assessment), 'assessed', Date.now(), crId
  );

  insertEvent(cr.workflow_id, 'cr_assessed', null,
    `Impact assessment: ${assessment.affected_stages.length} stage(s) affected — ${assessment.summary.slice(0, 200)}`,
    { crId, ...assessment }
  );

  logger.info(`CR #${crId} assessed: ${assessment.affected_stages.join(', ')}`);
  return { ...assessment, cleanedText: fullResponse };
}

/**
 * Execute a change request by running targeted stage updates.
 * Uses reiterateFromStage for each confirmed stage, but only runs
 * the confirmed stages — not all downstream stages.
 */
export async function executeChangeRequest(
  crId: number,
  stages: string[]
): Promise<void> {
  const cr = stmts.getCR.get(crId);
  if (!cr) throw new Error(`Change request not found: ${crId}`);
  if (cr.status !== 'assessed') {
    throw new Error(`CR #${crId} is not assessed (status: ${cr.status})`);
  }

  const workflow = stmts.getWorkflow.get(cr.workflow_id);
  if (!workflow) throw new Error(`Workflow not found: ${cr.workflow_id}`);

  const stageSequence: string[] = JSON.parse(workflow.stage_sequence);

  // assessImpact() offers 'story_decomposition' as a single collapsed placeholder standing
  // in for the whole per-feature block — expand it back to this workflow's real current
  // story_decomposition_F*/backlog_merge/epic_qa stages (the placeholder itself was never
  // restored in stage_sequence, so it won't be found there for an already-completed workflow).
  const expandedStages = stages.flatMap(s => {
    if (s === 'story_decomposition' && !stageSequence.includes('story_decomposition')) {
      return [...extractFeatureDecompositionStages(stageSequence), 'backlog_merge', 'epic_qa'];
    }
    return [s];
  });

  // Validate all requested stages are in the workflow
  for (const stage of expandedStages) {
    if (!stageSequence.includes(stage)) {
      throw new Error(`Stage "${stage}" is not in the workflow's stage sequence`);
    }
  }

  // Sort stages to match workflow order
  const orderedStages = stageSequence.filter(s => expandedStages.includes(s));

  insertEvent(cr.workflow_id, 'cr_stage_started', orderedStages[0],
    `Executing change request: updating ${orderedStages.length} stage(s)`,
    { crId, stages: orderedStages }
  );

  // Build a CR-specific stage sequence: only the confirmed stages + curator if present
  const hasCurator = stageSequence.includes('curator');
  const crSequence = hasCurator
    ? [...orderedStages, 'curator']
    : orderedStages;

  // Capture parent artifact IDs before the re-run
  const parentArtifactIds: Record<string, number | null> = {};
  for (const stage of orderedStages) {
    const artifactType = STAGE_ARTIFACT_TYPE[stage];
    if (!artifactType) continue;
    const row = db.prepare<[string, string], { id: number }>(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type = ?
      ORDER BY a.created_at DESC LIMIT 1
    `).get(workflow.item_id, artifactType);
    parentArtifactIds[stage] = row?.id ?? null;
  }

  // Save the CR-specific stage sequence in the impact_assessment.
  // DO NOT overwrite the workflow's stage_sequence — the frontend displays it.
  // Instead, store the CR sequence in the impact_assessment and use it during stage advancement.
  const now = Date.now();
  const existingAssessment = cr.impact_assessment ? JSON.parse(cr.impact_assessment) : {};
  existingAssessment.cr_stage_sequence = crSequence;
  existingAssessment.cr_stages = orderedStages;
  stmts.updateCRAssessment.run(JSON.stringify(existingAssessment), 'in_progress', now, crId);

  // Set current_stage to null to signal workflow restart, but keep original stage_sequence intact.
  // The status stays 'complete' — reiterateFromStage will transition it to 'active'.
  db.prepare('UPDATE workflows SET current_stage = NULL, updated_at = ? WHERE id = ?')
    .run(now, cr.workflow_id);

  // Build a CR-specific brief that scopes changes to affected sections only.
  // This uses generateCRBrief instead of the generic generateRevisionBrief.
  const crDescription = `[Change Request #${crId} — ${cr.type}]\n${cr.description}`;
  const coordinator = getCoordinator();
  const priorDraft = await loadPriorDraftForStage(workflow.item_id, orderedStages[0]);
  const crBrief = priorDraft
    ? coordinator.generateCRBrief(cr.workflow_id, orderedStages[0], crDescription, priorDraft)
    : undefined;  // falls back to standard brief inside reiterateFromStage

  try {
    await reiterateFromStage(cr.workflow_id, orderedStages[0], crDescription, crBrief);
  } catch (err: any) {
    // Revert CR status on failure (stage_sequence was never modified)
    db.prepare('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?')
      .run('complete', Date.now(), cr.workflow_id);
    stmts.updateCRStatus.run('assessed', Date.now(), crId);
    throw err;
  }

  // Track artifact versions when stages complete
  // This is done by polling — the caller (route handler) monitors checkpoint approvals
  // and calls linkCRArtifactVersion() for each approved stage.

  logger.info(`CR #${crId} execution started for stages: ${orderedStages.join(', ')}`);
}

/**
 * Link a newly created artifact to a CR as a versioned artifact.
 * Called after a checkpoint is approved during CR execution.
 */
export function linkCRArtifactVersion(
  crId: number,
  stage: string,
  artifactId: number,
  parentArtifactId: number | null
): void {
  const existing = stmts.getLatestCRVersion.get(crId, stage);
  const version = (existing?.version ?? 0) + 1;

  stmts.insertCRArtifactVersion.run(crId, stage, artifactId, parentArtifactId, version, Date.now());
  logger.info(`Linked artifact #${artifactId} to CR #${crId} stage "${stage}" as v${version}`);
}

/**
 * Re-sync an in-progress CR's frozen cr_stage_sequence after epic_feature_planner has
 * rerun and injectFeatureDecompositionStages has re-expanded the live
 * workflow.stage_sequence to the new feature count.
 *
 * executeChangeRequest() captures cr_stage_sequence once, before epic_feature_planner
 * even reran — it can never contain stage names for features that didn't exist yet at
 * assessment time. If epic_feature_planner was one of the confirmed stages, every
 * downstream feature stage is implicitly in scope too (a stale feature stage can't be
 * meaningfully kept for a feature set that no longer matches it), so this replaces the
 * *entire* F* block in cr_stage_sequence with whatever the fresh injection produced,
 * leaving every other confirmed stage (e.g. solution_architect, curator) untouched.
 *
 * No-op if there's no in-progress CR for this workflow, or its confirmed stage list
 * never included epic_feature_planner.
 */
export function syncCrStageSequenceAfterFeatureInjection(workflowId: string): void {
  const cr = stmts.getActiveCR.get(workflowId);
  if (!cr?.impact_assessment) return;

  const assessment = JSON.parse(cr.impact_assessment);
  const oldCrSequence: string[] | undefined = assessment.cr_stage_sequence;
  if (!oldCrSequence || !oldCrSequence.includes('epic_feature_planner')) return;

  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) return;

  const liveSequence: string[] = JSON.parse(workflow.stage_sequence);
  const newFeatureStages = extractFeatureDecompositionStages(liveSequence);

  const collapsed = collapseFeatureDecompositionStages(oldCrSequence);
  const newCrSequence = expandFeatureDecompositionStages(collapsed, newFeatureStages);

  assessment.cr_stage_sequence = newCrSequence;
  stmts.updateCRAssessment.run(JSON.stringify(assessment), cr.status, Date.now(), cr.id);

  logger.info(`CR #${cr.id} cr_stage_sequence re-synced after feature injection: ${newFeatureStages.length} feature stage(s)`);
}

/**
 * Complete a change request after all stages are done.
 * The workflow's stage_sequence is never modified during CR execution,
 * so no restoration is needed.
 */
export function completeChangeRequest(crId: number, workflowId: string): void {
  stmts.updateCRStatus.run('complete', Date.now(), crId);

  // Mark workflow as complete (stage_sequence was never modified)
  db.prepare('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?')
    .run('complete', Date.now(), workflowId);

  insertEvent(workflowId, 'cr_complete', null,
    `Change request #${crId} completed`,
    { crId }
  );

  logger.info(`CR #${crId} completed`);
}
