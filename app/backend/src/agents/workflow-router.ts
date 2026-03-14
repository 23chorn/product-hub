/**
 * Workflow Router — stage machine core (no LLM calls).
 *
 * Manages state transitions for coordinator-driven workflows.
 * A workflow has a stage_sequence JSON array (e.g. ["analyst","pm_prd","pm_backlog","critic","curator"]).
 * The router advances through the sequence, creating specialist sessions and checkpoints.
 *
 * All DB operations use better-sqlite3 synchronous calls.
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db, { getPolicies } from '../data/database';
import { sessionManager } from '../session/session-manager';
import { CoordinatorAgent } from './coordinator-agent';
import { CriticAgent } from './critic-agent';
import { ContextCuratorAgent } from './curator-agent';
import { BmadAgent } from './bmad-agent';
import { streamAI, resolveModelId, resolveAgentModel, type TokenUsage } from '../utils/ai-provider'; // resolveModelId used for workflow summary generation
import Logger from '../utils/logger';
import type { AppMode, AgentType } from '@pap/shared';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');

const logger = new Logger('WORKFLOW-ROUTER');

/** Read sprint_velocity and capacity_factor from agents/config.yaml. Falls back to safe defaults. */
async function loadSprintConfig(): Promise<{ sprintVelocity: number; capacityFactor: number }> {
  let sprintVelocity = 25;
  let capacityFactor = 0.7;
  try {
    const raw = await fsAsync.readFile(path.join(AGENTS_ROOT, 'config.yaml'), 'utf-8');
    for (const line of raw.split('\n')) {
      const intMatch = line.match(/^sprint_velocity:\s*(\d+)/);
      if (intMatch) sprintVelocity = parseInt(intMatch[1], 10);
      const floatMatch = line.match(/^capacity_factor:\s*([\d.]+)/);
      if (floatMatch) capacityFactor = parseFloat(floatMatch[1]);
    }
  } catch { /* fall through */ }
  return { sprintVelocity, capacityFactor };
}

/**
 * Stages that run silently with no human review gate.
 * After completing, the workflow auto-advances to the next stage.
 * Human interaction only occurs at Checkpoint A (analyst) and Checkpoint C (critic).
 */
/**
 * Stages that run silently with no human review gate.
 * Currently empty — every stage pauses for human approval.
 * To skip human review on a stage, add it here (e.g. new Set(['pm_prd'])).
 */
const SILENT_STAGES = new Set<string>([]);

/**
 * Default model overrides per stage.
 * Analyst gets a more capable model for better factual accuracy and source quality.
 * Later stages can use faster/cheaper models since they work from prior artifacts.
 * Set a key to '' (empty string) to fall back to the user-selected / provider default.
 *
 * Can also be overridden per-workflow via policy_overrides:
 *   { "model:analyst": "claude-opus-4-6", "model:pm_prd": "claude-sonnet-4-6" }
 */
// Model selection is centralised in resolveAgentModel() (ai-provider.ts).
// Per-workflow overrides are still supported via policy_overrides JSON on the workflow row:
//   { "model:analyst": "claude-opus-4-6", "model:pm_prd": "claude-sonnet-4-5-20250929" }

// Lazy singletons — avoids reading persona files at import time
let _coordinator: CoordinatorAgent | null = null;
function getCoordinator(): CoordinatorAgent {
  if (!_coordinator) _coordinator = new CoordinatorAgent();
  return _coordinator;
}

let _critic: CriticAgent | null = null;
function getCritic(): CriticAgent {
  if (!_critic) _critic = new CriticAgent();
  return _critic;
}

let _curator: ContextCuratorAgent | null = null;
function getCurator(): ContextCuratorAgent {
  if (!_curator) _curator = new ContextCuratorAgent();
  return _curator;
}

// ── Row types ──────────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  summary: string | null;    // AI-generated brief name
  status: string;
  current_stage: string | null;
  stage_sequence: string;    // JSON string[]
  policy_overrides: string;  // JSON Record<string,string>
  estimated_cost: number;    // cumulative USD cost
  created_at: number;
  updated_at: number;
}

export interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: string;
  human_feedback: string | null;
  coordinator_action: string | null;  // JSON blob
  token_usage: string | null;       // JSON: StageTokenData
  created_at: number;
  resolved_at: number | null;
}

export interface WorkflowStatus {
  workflow: WorkflowRow;
  checkpoints: CheckpointRow[];
  currentStage: string | null;
  completedStages: string[];
  pendingStage: string | null;
  currentSessionId: string | null;
}

// ── Line diff utility ──────────────────────────────────────────────────────────

/**
 * Compute a unified-style diff between two texts and return a markdown document.
 * Uses LCS (Myers-style backtrack) on lines. Practical for typical LLM outputs
 * of up to ~2 000 lines — beyond that it falls back to a stats-only summary.
 */
function computeRevisionDiff(oldText: string, newText: string, stageLabel: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Safety cap: fall back to stats only for very large documents
  if (m * n > 2_000_000) {
    return `# Revision Diff — ${stageLabel}\n\n_Document too large for line-by-line diff._\n\n- Original: ${m} lines\n- Revised: ${n} lines\n`;
  }

  // Build LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce edit operations
  type Op = { op: '+' | '-' | '='; line: string };
  const ops: Op[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ op: '=', line: oldLines[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: '+', line: newLines[j - 1] }); j--;
    } else {
      ops.push({ op: '-', line: oldLines[i - 1] }); i--;
    }
  }
  ops.reverse();

  // Emit unified diff with 3-line context windows
  const CONTEXT = 3;
  const chunks: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === '=') { k++; continue; }
    // Found a changed region — collect context around it
    const start = Math.max(0, k - CONTEXT);
    let end = k;
    while (end < ops.length && (ops[end].op !== '=' || end - k < CONTEXT)) end++;
    end = Math.min(ops.length, end + CONTEXT);

    const block: string[] = [];
    for (let x = start; x < end; x++) {
      const { op, line } = ops[x];
      block.push(op === '+' ? `+ ${line}` : op === '-' ? `- ${line}` : `  ${line}`);
    }
    chunks.push(block.join('\n'));
    k = end;
  }

  const added   = ops.filter(o => o.op === '+').length;
  const removed = ops.filter(o => o.op === '-').length;

  if (chunks.length === 0) {
    return `# Revision Diff — ${stageLabel}\n\n_No line-level changes detected between drafts._\n`;
  }

  return [
    `# Revision Diff — ${stageLabel}`,
    '',
    `_${added} line${added !== 1 ? 's' : ''} added · ${removed} line${removed !== 1 ? 's' : ''} removed_`,
    '',
    '```diff',
    chunks.join('\n~~\n'),
    '```',
  ].join('\n');
}

// ── Save critic review as artifact ─────────────────────────────────────────────

/**
 * Saves the critic's full markdown review to disk and inserts an artifact row.
 * Returns the artifact row ID.
 */
async function saveCriticArtifact(
  itemId: string,
  stage: string,
  fullText: string,
  sessionId?: string | null
): Promise<number> {
  const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, 'critic', 'artifacts');
  await fsAsync.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `${Date.now()}-critic-${stage}.md`);
  await fsAsync.writeFile(artifactPath, fullText, 'utf-8');

  const result = db.prepare(`
    INSERT INTO artifacts (session_id, type, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId ?? null, 'critic_review', artifactPath, Date.now());

  logger.info(`Saved critic review artifact for stage "${stage}" → ${artifactPath}`);
  return result.lastInsertRowid as number;
}

// ── Stage → specialist session mapping ────────────────────────────────────────

const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:              { mode: 'analyst',           agentType: 'analyst' },
  pm_prd:               { mode: 'prd',               agentType: 'pm' },
  solution_architect:   { mode: 'architecture',      agentType: 'architect' },
  pm_backlog:           { mode: 'backlog',           agentType: 'pm' },
  gtm_strategy:         { mode: 'gtm',               agentType: 'gtm' },
  feature_marketing:    { mode: 'feature_marketing', agentType: 'marketer' },
  critic:               { mode: 'analyst',           agentType: 'analyst' },
  curator:              { mode: 'analyst',           agentType: 'analyst' },
};

// Per-stage output token ceiling. Backlog gets more headroom because the JSON
// scales with story count (6 features × 12 stories at max = ~22k tokens).
// All Claude 4.x models support 64k output, so these are safe upper bounds.
const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:            12_000,
  pm_prd:             12_000,
  solution_architect: 12_000,
  pm_backlog:         32_000,
  gtm_strategy:       12_000,
  feature_marketing:  12_000,
};

// Maps stage name to the artifact.type value stored in the DB.
// Must match what getLatestPrdArtifact / getLatestAnalystArtifact query for.
const STAGE_ARTIFACT_TYPE: Record<string, string> = {
  analyst:            'analyst',
  pm_prd:             'prd',
  solution_architect: 'architecture',
  pm_backlog:         'backlog',
  gtm_strategy:       'gtm',
  feature_marketing:  'feature_marketing',
};

// ── Policy helpers ─────────────────────────────────────────────────────────────

function loadGlobalPolicies(): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of getPolicies('global')) {
    try {
      // rule_value is a JSON string — unwrap to get the plain value
      map.set(p.rule_key, JSON.parse(p.rule_value));
    } catch {
      map.set(p.rule_key, p.rule_value);
    }
  }
  return map;
}

// ── Prepared statements ────────────────────────────────────────────────────────

const stmts = {
  getWorkflow: db.prepare<[string], WorkflowRow>(
    'SELECT * FROM workflows WHERE id = ?'
  ),
  insertWorkflow: db.prepare(`
    INSERT INTO workflows (id, item_id, goal, status, current_stage, stage_sequence, policy_overrides, created_at, updated_at)
    VALUES (?, ?, ?, 'active', NULL, ?, ?, ?, ?)
  `),
  updateWorkflowSummary: db.prepare(`
    UPDATE workflows SET summary = ?, updated_at = ? WHERE id = ?
  `),
  updateWorkflowStage: db.prepare(`
    UPDATE workflows SET current_stage = ?, status = 'active', updated_at = ? WHERE id = ?
  `),
  updateWorkflowStatus: db.prepare(`
    UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?
  `),
  updateWorkflowStageAndStatus: db.prepare(`
    UPDATE workflows SET current_stage = ?, status = ?, updated_at = ? WHERE id = ?
  `),
  insertCheckpoint: db.prepare(`
    INSERT INTO checkpoints (workflow_id, stage, artifact_id, status, human_feedback, coordinator_action, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `),
  getCheckpoint: db.prepare<[number], CheckpointRow>(
    'SELECT * FROM checkpoints WHERE id = ?'
  ),
  updateCheckpoint: db.prepare(`
    UPDATE checkpoints SET status = ?, human_feedback = ?, coordinator_action = ?, resolved_at = ? WHERE id = ?
  `),
  getCheckpointsByWorkflow: db.prepare<[string], CheckpointRow>(
    'SELECT * FROM checkpoints WHERE workflow_id = ? ORDER BY created_at ASC'
  ),
  getPendingCheckpointForStage: db.prepare<[string, string], { id: number }>(`
    SELECT id FROM checkpoints WHERE workflow_id = ? AND stage = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `),
  getLatestSessionForItemMode: db.prepare<[string, string], { id: string }>(`
    SELECT s.id FROM sessions s
    WHERE s.item_id = ? AND s.mode = ?
    ORDER BY s.created_at DESC LIMIT 1
  `),
};

// ── Workflow event logging ────────────────────────────────────────────────────

export interface WorkflowEvent {
  id: number;
  workflow_id: string;
  event_type: string;
  stage: string | null;
  summary: string;
  details: string | null;
  created_at: number;
}

const eventStmts = {
  insertEvent: db.prepare(`
    INSERT INTO workflow_events (workflow_id, event_type, stage, summary, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getEventsSince: db.prepare<[string, number], WorkflowEvent>(`
    SELECT * FROM workflow_events WHERE workflow_id = ? AND id > ? ORDER BY id ASC
  `),
  getAllEvents: db.prepare<[string], WorkflowEvent>(
    'SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY id ASC'
  ),
};

function insertEvent(
  workflowId: string,
  eventType: string,
  stage: string | null,
  summary: string,
  details?: Record<string, unknown>
): number {
  const result = eventStmts.insertEvent.run(
    workflowId, eventType, stage, summary,
    details ? JSON.stringify(details) : null,
    Date.now()
  );
  return result.lastInsertRowid as number;
}

/**
 * Atomically add an estimated cost (USD) to a workflow's running total.
 */
function addWorkflowCost(workflowId: string, cost: number): void {
  if (cost <= 0) return;
  db.prepare(`UPDATE workflows SET estimated_cost = estimated_cost + ? WHERE id = ?`).run(cost, workflowId);
}

/** Build an onTokens callback that accumulates cost on a workflow. */
export function costTracker(workflowId: string): (usage: TokenUsage) => void {
  return (usage) => addWorkflowCost(workflowId, usage.estimatedCost);
}

/** Token usage breakdown stored per-stage on the checkpoint row. */
interface StageTokenData {
  specialist: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    searchCount: number;
    estimatedCost: number;
  };
  critic?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCost: number;
  };
  /** Cost from prior revision runs for this stage (not reflected in specialist/critic tokens above). */
  priorRunsCost?: number;
}

/** Write token usage JSON to a checkpoint row. */
function setCheckpointTokenUsage(checkpointRowId: number, data: StageTokenData): void {
  db.prepare('UPDATE checkpoints SET token_usage = ? WHERE id = ?')
    .run(JSON.stringify(data), checkpointRowId);
}

export function getWorkflowEvents(workflowId: string, sinceId?: number): WorkflowEvent[] {
  if (sinceId !== undefined && sinceId > 0) {
    return eventStmts.getEventsSince.all(workflowId, sinceId);
  }
  return eventStmts.getAllEvents.all(workflowId);
}

// ── Story 3.1: Core functions ──────────────────────────────────────────────────

/**
 * Create a new workflow for an item.
 * Applies stage-skip policies at creation time.
 */
export function createWorkflow(
  itemId: string,
  goal: string,
  stageSequence: string[],
  policyOverrides?: Record<string, string>
): WorkflowRow {
  const policies = loadGlobalPolicies();

  // Story 3.2: Stage-skip at creation time
  let sequence = [...stageSequence];

  const requireCritic = policies.get('require_critic_review');
  if (requireCritic === 'false' || requireCritic === false as any) {
    const before = sequence.length;
    sequence = sequence.filter(s => s !== 'critic');
    if (sequence.length < before) {
      logger.info('[POLICY] require_critic_review=false — removed critic from stage sequence');
    }
  }

  const id = uuidv4();
  const now = Date.now();

  stmts.insertWorkflow.run(
    id, itemId, goal,
    JSON.stringify(sequence),
    JSON.stringify(policyOverrides ?? {}),
    now, now
  );

  const workflow = stmts.getWorkflow.get(id)!;
  logger.info(`Created workflow ${id} (item=${itemId}) stages: ${sequence.join(' → ')}`);

  // Fire-and-forget: generate a brief summary name in the background.
  // Delay 30s to avoid competing with the first stage's LLM calls for rate limits.
  setTimeout(() => {
    generateWorkflowSummary(id, goal).catch(err =>
      logger.warn(`Failed to generate workflow summary: ${err.message}`)
    );
  }, 30_000);

  return workflow;
}

/**
 * Generate a brief summary name for a workflow via LLM.
 * Runs fire-and-forget after workflow creation — updates the DB row when done.
 */
async function generateWorkflowSummary(workflowId: string, goal: string): Promise<void> {
  const model = resolveModelId(undefined);
  const system = 'You generate concise workflow titles. Respond with ONLY the title — no quotes, no punctuation at the end, no explanation.';
  const userMsg = `Generate a brief summary name (4-8 words) for this product workflow goal. The name should capture the core intent, like a project name a team would use.\n\nGoal:\n${goal.split('\n\n[Coordinator context]')[0].slice(0, 500)}`;

  let summary = '';
  for await (const chunk of streamAI(model, system, [{ role: 'user', content: userMsg }], 60)) {
    summary += chunk;
  }

  summary = summary.trim().replace(/^["']|["']$/g, '').replace(/\.+$/, '');
  if (summary.length > 0 && summary.length <= 100) {
    stmts.updateWorkflowSummary.run(summary, Date.now(), workflowId);
    logger.info(`Workflow ${workflowId} summary: "${summary}"`);
  }
}

/**
 * Advance a workflow to the next stage in its sequence.
 *
 * - For regular stages (analyst, pm_prd, pm_backlog): creates a specialist session
 *   and pauses at a checkpoint for human review (unless auto-approve policy is set).
 * - For 'critic' stage: runs CriticAgent automatically; stores verdict in checkpoint;
 *   returns sessionId = null (no interactive session needed).
 * - For 'curator' stage: runs ContextCuratorAgent automatically; stores context_diffs;
 *   auto-completes — throws WORKFLOW_COMPLETE after storing diffs.
 *
 * Returns { stage, sessionId } or throws WORKFLOW_COMPLETE when all stages done.
 */
export async function advanceStage(workflowId: string): Promise<{ stage: string; sessionId: string | null }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status === 'complete') throw new Error(`Workflow ${workflowId} is already complete`);
  if (workflow.status === 'paused_at_checkpoint') {
    throw new Error(`Workflow ${workflowId} is paused at a checkpoint — resolve it before advancing`);
  }

  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  if (sequence.length === 0) throw new Error(`Workflow ${workflowId} has no stages defined`);

  const currentIndex = workflow.current_stage !== null
    ? sequence.indexOf(workflow.current_stage)
    : -1;
  const nextIndex = currentIndex + 1;

  if (nextIndex >= sequence.length) {
    const now = Date.now();
    stmts.updateWorkflowStageAndStatus.run(
      workflow.current_stage, 'complete', now, workflowId
    );
    insertEvent(workflowId, 'workflow_complete', null, 'All stages complete. Your outputs are ready for review.');
    logger.info(`Workflow ${workflowId} complete — all ${sequence.length} stages done`);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  const nextStage = sequence[nextIndex];
  const now = Date.now();

  // Move to next stage
  stmts.updateWorkflowStage.run(nextStage, now, workflowId);

  // ── Critic stage: automated single-shot review ────────────────────────────
  if (nextStage === 'critic') {
    insertEvent(workflowId, 'stage_started', 'critic', 'Running quality review...');

    const { content: artifactContent, type: artifactType } = loadLatestArtifactForItem(workflow.item_id);
    const review = await getCritic().review(artifactContent, artifactType, resolveAgentModel('critic'), costTracker(workflowId), workflow.current_stage ?? undefined);

    // Save full critic review as artifact .md file
    const criticArtifactId = await saveCriticArtifact(workflow.item_id, 'critic', review.fullText);

    const criticDetails = {
      critic_verdict: review.verdict,
      issue_count: review.issues.length,
      critical_issues: review.issues.filter(i => i.severity === 'critical').length,
      major_issues:    review.issues.filter(i => i.severity === 'major').length,
      questions:       review.questions.slice(0, 3),
      issues_summary:  review.issues.slice(0, 5).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; '),
      auto_reviewed:   true,
      critic_artifact_id: criticArtifactId,
    };
    const coordinatorAction = JSON.stringify(criticDetails);

    // Check auto_approve_critic policy
    const policies = loadGlobalPolicies();
    const autoApproveCritic = policies.get('auto_approve_critic') === 'true' || policies.get('auto_approve_critic') === true as any;

    if (autoApproveCritic && review.verdict === 'approve') {
      // Auto-approve: no human gate needed
      stmts.insertCheckpoint.run(workflowId, nextStage, null, 'approved', coordinatorAction, now);
      insertEvent(workflowId, 'critic_verdict', 'critic',
        'Quality review passed — no issues found. Auto-approved.',
        criticDetails);
      logger.info(`Critic auto-approved for workflow ${workflowId}`);

      // Continue to next stage
      return advanceStage(workflowId);
    }

    if (autoApproveCritic && review.verdict === 'revise') {
      // Auto-revise: roll back and rerun with critic feedback (max 2 retries)
      const revisionCount = (review as any)._revisionCount ?? 0;
      if (revisionCount < 2) {
        stmts.insertCheckpoint.run(workflowId, nextStage, null, 'revised', coordinatorAction, now);
        insertEvent(workflowId, 'critic_verdict', 'critic',
          `Quality review flagged issues. Auto-revising (attempt ${revisionCount + 1}/2).`,
          criticDetails);

        // Roll back to the stage before critic and rerun
        const criticIdx = sequence.indexOf('critic');
        const prevStage = criticIdx > 0 ? sequence[criticIdx - 1] : null;
        stmts.updateWorkflowStageAndStatus.run(prevStage, 'active', now, workflowId);

        // Propagate critic feedback as a revision
        const feedbackText = review.issues.map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('\n');
        const brief = await getCoordinator().generateStageBrief(workflowId, prevStage!, feedbackText);
        const stageMap = STAGE_SESSION_MAP[prevStage!] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
        const session = sessionManager.createBmadSession(workflow.item_id, stageMap.mode, stageMap.agentType);
        sessionManager.updateWorkflow(session.id, workflowId, brief);

        runAutonomousStage(session.id, workflowId, prevStage!, workflow.item_id, brief, true)
          .catch(err => logger.error(`Auto-revision after critic failed: ${err.message}`));

        logger.info(`Critic auto-revise for workflow ${workflowId} — rerunning ${prevStage}`);
        return { stage: nextStage, sessionId: null };
      }
      // Max retries exceeded — fall through to human gate
    }

    // Default: pause at checkpoint for human review
    stmts.insertCheckpoint.run(workflowId, nextStage, null, 'pending', coordinatorAction, now);
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

    if (review.verdict === 'approve') {
      insertEvent(workflowId, 'critic_verdict', 'critic',
        'Quality review passed — no issues found. Approve to proceed.',
        criticDetails);
    } else {
      const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
      insertEvent(workflowId, 'critic_verdict', 'critic',
        `Quality review flagged issues: ${issuesSummary}. How would you like to proceed?`,
        criticDetails);
    }

    logger.info(`Critic completed for workflow ${workflowId} — verdict: ${review.verdict}`);
    return { stage: nextStage, sessionId: null };
  }

  // ── Curator stage: automated curation, auto-completes workflow ────────────
  if (nextStage === 'curator') {
    insertEvent(workflowId, 'stage_started', 'curator', 'Updating project context files...');

    let curatorTokenData: StageTokenData['specialist'] | null = null;
    const curatorTokenCallback = (usage: TokenUsage) => {
      curatorTokenData = {
        model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
        searchCount: 0, estimatedCost: usage.estimatedCost,
      };
      addWorkflowCost(workflowId, usage.estimatedCost);
    };

    const { diffCount, reasoning } = await getCurator().runCuration(workflowId, resolveAgentModel('curator'), curatorTokenCallback);

    // Log the curator's reasoning so the user can review it
    if (reasoning) {
      insertEvent(workflowId, 'curator_reasoning', 'curator',
        reasoning.length > 300 ? reasoning.slice(0, 297) + '...' : reasoning,
        { full_reasoning: reasoning });
    }

    const curatorCpResult = stmts.insertCheckpoint.run(
      workflowId, nextStage, null, 'approved',
      JSON.stringify({ auto_approved: true, context_diffs_proposed: diffCount }),
      now
    );
    if (curatorTokenData) {
      setCheckpointTokenUsage(curatorCpResult.lastInsertRowid as number,
        { specialist: curatorTokenData! });
    }

    insertEvent(workflowId, 'stage_completed', 'curator',
      diffCount > 0
        ? `Context curation complete — ${diffCount} update${diffCount !== 1 ? 's' : ''} proposed.`
        : 'Context curation complete — no updates needed.',
      { context_diffs_proposed: diffCount });

    stmts.updateWorkflowStageAndStatus.run(nextStage, 'complete', now, workflowId);

    insertEvent(workflowId, 'workflow_complete', null,
      'All stages complete. Your outputs are ready for review.');

    logger.info(`Curator completed for workflow ${workflowId} — ${diffCount} diff(s) proposed, workflow complete`);
    throw new Error(`WORKFLOW_COMPLETE:${workflowId}`);
  }

  // ── Regular specialist stage: run autonomously in the background ─────────
  const STAGE_NARRATION: Record<string, string> = {
    analyst:            'Sage is starting market research. This stage uses web search and typically takes 2–4 minutes.',
    pm_prd:             'Rex is writing the Product Requirements Document based on the research brief.',
    solution_architect: 'Atlas is designing the solution architecture based on the PRD.',
    pm_backlog:         'Pip is creating the backlog with epics, features, and stories.',
    gtm_strategy:       'Quinn is developing the Go-to-Market strategy based on the approved PRD.',
    feature_marketing:  'Milo is writing the feature marketing content pack based on the GTM strategy and PRD.',
  };
  insertEvent(workflowId, 'stage_started', nextStage,
    STAGE_NARRATION[nextStage] ?? `Starting ${nextStage}...`);

  const stageMap = STAGE_SESSION_MAP[nextStage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
  const session = sessionManager.createBmadSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  logger.info(`Created ${stageMap.mode} session ${session.id} for stage "${nextStage}"`);

  insertEvent(workflowId, 'stage_progress', nextStage, 'Coordinator is briefing the specialist...');
  const brief = await getCoordinator().generateStageBrief(workflowId, nextStage);
  sessionManager.updateWorkflow(session.id, workflowId, brief);
  insertEvent(workflowId, 'stage_progress', nextStage, 'Brief received. Specialist is working...');

  // Silent stages (pm_prd, pm_backlog) auto-approve and chain to the next stage.
  // Human gates only at analyst (Checkpoint A) and critic (Checkpoint C).
  const shouldAutoApprove = SILENT_STAGES.has(nextStage);

  // Fire the autonomous specialist run as a background task.
  // It will collect the full output, store an artifact, then create the checkpoint.
  runAutonomousStage(session.id, workflowId, nextStage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => {
      logger.error(`Autonomous stage "${nextStage}" background task failed: ${err.message}`);
      // Safety net: if runAutonomousStage's inner try/catch didn't create a checkpoint,
      // create one here so the workflow doesn't get stuck in 'active' forever.
      try {
        const wf = stmts.getWorkflow.get(workflowId);
        if (wf && wf.status === 'active') {
          const now = Date.now();
          insertEvent(workflowId, 'error', nextStage,
            `Stage "${nextStage}" failed unexpectedly: ${err.message}`,
            { error: err.message });
          stmts.insertCheckpoint.run(
            workflowId, nextStage, null, 'pending',
            JSON.stringify({ error: err.message, autonomous: true, safety_net: true }),
            now
          );
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
          logger.info(`Safety net: created error checkpoint for stuck workflow ${workflowId}`);
        }
      } catch (inner) {
        logger.error(`Safety net checkpoint creation also failed: ${(inner as Error).message}`);
      }
    });

  return { stage: nextStage, sessionId: null };
}

/**
 * Explicitly complete the current stage, creating a pending checkpoint.
 * Called when the user decides the specialist's output is ready for review.
 * Sets workflow status to 'paused_at_checkpoint'.
 */
export function completeStage(workflowId: string): void {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (!workflow.current_stage) throw new Error(`Workflow ${workflowId} has no current stage`);
  if (workflow.status !== 'active') {
    throw new Error(`Workflow ${workflowId} is not active (status: ${workflow.status})`);
  }

  const now = Date.now();

  // Attempt to find the latest artifact for the item to attach to the checkpoint
  const artifactRow = db.prepare<[string], { id: number }>(`
    SELECT a.id FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? ORDER BY a.created_at DESC LIMIT 1
  `).get(workflow.item_id);

  // Find the specialist session for this stage
  const stageMap = STAGE_SESSION_MAP[workflow.current_stage];
  let sessionId: string | null = null;
  if (stageMap) {
    const row = stmts.getLatestSessionForItemMode.get(workflow.item_id, stageMap.mode);
    sessionId = row?.id ?? null;
  }

  stmts.insertCheckpoint.run(
    workflowId,
    workflow.current_stage,
    artifactRow?.id ?? null,
    'pending',
    sessionId ? JSON.stringify({ session_id: sessionId }) : null,
    now
  );
  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  logger.info(`Stage "${workflow.current_stage}" submitted for review — workflow ${workflowId} paused at checkpoint`);
}

/**
 * Run a specialist stage autonomously (no user interaction).
 * Builds the specialist's system prompt, sends a single "produce output now"
 * message, collects the full response, saves it as an artifact, then creates
 * a pending checkpoint so the human reviews the output.
 *
 * This is a fire-and-forget background task called from advanceStage().
 */
async function runAutonomousStage(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  brief: string,
  autoApprove: boolean,
  priorCriticIssues?: string[],
  priorDraftContent?: string,
  priorRunsCost?: number,
  skipCritic?: boolean
): Promise<void> {
  const stageMap = STAGE_SESSION_MAP[stage];
  if (!stageMap) {
    logger.error(`runAutonomousStage: no stage map for "${stage}"`);
    return;
  }

  // Resolve model: workflow policy_overrides take priority, then per-agent defaults
  const workflow = stmts.getWorkflow.get(workflowId);
  const policyOverrides: Record<string, string> = workflow?.policy_overrides
    ? JSON.parse(workflow.policy_overrides)
    : {};
  const stageModelKey = `model:${stage}`;
  const stageModel = policyOverrides[stageModelKey] || resolveAgentModel(stage);
  logger.info(`Stage "${stage}" using model: ${stageModel}`);

  // Per-stage token tracking — captured here, stored on the final pending checkpoint.
  let specialistTokenData: StageTokenData['specialist'] | null = null;
  let criticTokenData: StageTokenData['critic'] | null = null;
  // Costs captured in plain numbers to avoid TS5.9 closure-narrowing issues with ?.estimatedCost
  let specialistRunCost = 0;
  let criticRunCost = 0;

  const specialistTokenCallback = (usage: TokenUsage) => {
    specialistTokenData = {
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      searchCount: usage.searchCount, estimatedCost: usage.estimatedCost,
    };
    specialistRunCost = usage.estimatedCost;
    addWorkflowCost(workflowId, usage.estimatedCost);
  };
  const criticTokenCallback = (usage: TokenUsage) => {
    criticTokenData = {
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      estimatedCost: usage.estimatedCost,
    };
    criticRunCost = usage.estimatedCost;
    addWorkflowCost(workflowId, usage.estimatedCost);
  };

  logger.info(`Autonomous stage "${stage}" starting (session=${sessionId})`);

  try {
    const agent = new BmadAgent(stageMap.agentType);
    const persona = await agent.loadPersona();

    // Extract the goal from the brief and pin it in the system prompt so the
    // model cannot miss it even when the project context describes a different product.
    const goalMatch = brief.match(/^## Goal\n([\s\S]*?)(?=\n## |\n# |$)/m);
    const goalText = goalMatch ? goalMatch[1].trim() : null;

    // Build item context: for analyst, the goal itself is the primary context.
    // For later stages, inject the previous stage's artifact.
    let itemContext: string | undefined;
    if (stage === 'analyst') {
      if (goalText) {
        itemContext = `## THIS IS YOUR RESEARCH TOPIC\nThe task below defines exactly what to research. The company context above is background only — your output must be about this specific goal, NOT about the company's existing products.\n\n**Goal:** ${goalText}`;
      }
    } else if (stage === 'pm_prd') {
      const analystPath = sessionManager.getLatestAnalystArtifactPath(itemId);
      if (analystPath) {
        try {
          const content = fs.readFileSync(analystPath, 'utf-8');
          itemContext = `**Research Brief (use as background for the PRD):**\n\n${content}`;
        } catch { /* ignore */ }
      }
    } else if (stage === 'solution_architect') {
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      let prdContent = '';
      if (prdPath) {
        try { prdContent = fs.readFileSync(prdPath, 'utf-8'); } catch { /* ignore */ }
      }
      // Load tech-stack context if available
      const techStackPath = path.join(PROJECT_ROOT, 'context', 'tech-stack.md');
      let techStackNote = '';
      try {
        const techStack = fs.readFileSync(techStackPath, 'utf-8');
        techStackNote = `**Existing Tech Stack (align your architecture with this):**\n\n${techStack}`;
      } catch {
        techStackNote = `**Note:** No existing tech stack document found at context/tech-stack.md. You should recommend technology choices with tradeoffs for each decision.`;
      }
      const parts: string[] = [];
      if (prdContent) parts.push(`**PRD Document (use as source of requirements for the architecture):**\n\n${prdContent}`);
      parts.push(techStackNote);
      itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'pm_backlog') {
      const parts: string[] = [];
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          parts.push(`**PRD Document (use as source of requirements for the backlog):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      const archPath = getLatestArchitectureArtifactPath(itemId);
      if (archPath) {
        try {
          const content = fs.readFileSync(archPath, 'utf-8');
          parts.push(`**Architecture Document (reference specific services, APIs, and data models in stories):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'gtm_strategy') {
      const parts: string[] = [];
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          parts.push(`**PRD Document (use as the source of truth for personas, scope, and success metrics — do not redefine these):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    } else if (stage === 'feature_marketing') {
      const parts: string[] = [];
      const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
      if (prdPath) {
        try {
          const content = fs.readFileSync(prdPath, 'utf-8');
          parts.push(`**PRD Document (use to verify that all copy references only approved capabilities):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      const gtmPath = getLatestArtifactPathByType(itemId, 'gtm');
      if (gtmPath) {
        try {
          const content = fs.readFileSync(gtmPath, 'utf-8');
          parts.push(`**GTM Strategy (use as the source of positioning, messaging hierarchy, and channel direction):**\n\n${content}`);
        } catch { /* ignore */ }
      }
      if (parts.length > 0) itemContext = parts.join('\n\n---\n\n');
    }

    const systemPrompt = await agent.buildSystemPrompt(persona, undefined, itemContext, true, stage);

    // For revision runs: construct a conversation thread so the specialist sees its
    // prior output as its own assistant turn and makes targeted edits rather than
    // rewriting from scratch. The brief contains revision instructions only (no
    // embedded prior draft). The prior draft is injected as the assistant turn.
    const STAGE_ARTIFACT_LABEL: Record<string, string> = {
      analyst: 'Research Brief',
      pm_prd: 'PRD',
      solution_architect: 'Architecture Document',
      pm_backlog: 'Backlog',
      gtm_strategy: 'GTM Strategy',
      feature_marketing: 'Feature Marketing Content Pack',
    };
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = priorDraftContent
      ? (() => {
          const artifactLabel = STAGE_ARTIFACT_LABEL[stage] ?? 'document';
          const issueLines = priorCriticIssues && priorCriticIssues.length > 0
            ? `\n\nThe specific issues to address:\n${priorCriticIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`
            : '';
          const revisionDirective =
            `Please revise the ${artifactLabel} above based on the issues listed in the revision instructions.${issueLines}\n\n` +
            `Make targeted changes only — locate and fix the flagged sections directly. ` +
            `Do not rewrite, restructure, or modify any section that was not flagged. ` +
            `Return the complete revised ${artifactLabel} with all sections included.`;
          return [
            { role: 'user' as const, content: brief },
            { role: 'assistant' as const, content: priorDraftContent },
            { role: 'user' as const, content: revisionDirective },
          ];
        })()
      : [
          { role: 'user', content: brief },
        ];

    let fullResponse = '';
    let lastReportedSection = '';
    const startTime = Date.now();
    let lastProgressTime = startTime;

    for await (const chunk of agent.streamResponse(systemPrompt, messages, stageModel, specialistTokenCallback, STAGE_MAX_OUTPUT_TOKENS[stage])) {
      fullResponse += chunk;

      // Detect new markdown sections and emit progress events
      const now = Date.now();
      if (now - lastProgressTime > 3000) {  // Throttle to max once every 3s
        const sectionMatch = fullResponse.match(/^## ([^\n]+)/gm);
        if (sectionMatch && sectionMatch.length > 0) {
          const latestSection = sectionMatch[sectionMatch.length - 1].replace(/^## /, '').trim();
          if (latestSection !== lastReportedSection) {
            lastReportedSection = latestSection;
            const sectionCount = sectionMatch.length;
            insertEvent(workflowId, 'stage_progress', stage,
              `Writing section ${sectionCount}: ${latestSection}...`);
            lastProgressTime = now;
          }
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.info(`Autonomous stage "${stage}" LLM streaming complete (${elapsed}s, ${fullResponse.length} chars)`);

    // Write artifact to disk
    const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, stageMap.mode, 'artifacts');
    await fsAsync.mkdir(artifactDir, { recursive: true });
    const ext = stage === 'pm_backlog' ? 'json' : 'md';
    const artifactPath = path.join(artifactDir, `${Date.now()}-${stage}.${ext}`);
    // Clean up LLM output before saving
    let artifactContent: string;
    if (stage === 'pm_backlog') {
      // Strip markdown code fences from JSON output
      const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      // Inject sprint estimate into epic object
      try {
        const parsed = JSON.parse(stripped);
        // Normalise: stories can live in features[].stories, feature.stories, epic.stories, or as a single story
        const allStories: any[] = parsed.features
          ? (parsed.features as any[]).flatMap((f: any) => f.stories ?? [])
          : parsed.feature?.stories
          ? (parsed.feature.stories as any[])
          : parsed.epic?.stories
          ? (parsed.epic.stories as any[])
          : parsed.story
          ? [parsed.story]
          : [];
        const totalEffort: number = allStories
          .reduce((sum: number, s: any) => sum + (Number(s.effort) || 0), 0);
        const { sprintVelocity, capacityFactor } = await loadSprintConfig();
        const effectiveVelocity = Math.round(sprintVelocity * capacityFactor * 10) / 10;
        const sprintsRequired = effectiveVelocity > 0
          ? Math.round((totalEffort / effectiveVelocity) * 10) / 10
          : null;
        // Inject sprint metadata into the appropriate top-level object
        const sprintMeta = { totalEffort, sprintsRequired, sprintVelocity, capacityFactor, effectiveVelocity };
        if (parsed.epic) {
          parsed.epic = { ...parsed.epic, ...sprintMeta };
        } else if (parsed.feature) {
          parsed.feature = { ...parsed.feature, ...sprintMeta };
        } else if (parsed.story) {
          parsed.story = { ...parsed.story, ...sprintMeta };
        }
        artifactContent = JSON.stringify(parsed, null, 2);
        logger.info(`Backlog sprint estimate: ${totalEffort} pts / ${effectiveVelocity} effective velocity (${sprintVelocity} × ${capacityFactor}) = ${sprintsRequired} sprints`);
      } catch {
        // If JSON parse fails, save as-is and let downstream error handling catch it
        artifactContent = stripped;
      }
    } else {
      // Strip any preamble before the first markdown heading (e.g. "Here's the research brief:")
      const match = fullResponse.match(/^# /m);
      artifactContent = match?.index && match.index > 0
        ? fullResponse.slice(match.index)
        : fullResponse;
    }
    await fsAsync.writeFile(artifactPath, artifactContent, 'utf-8');

    // Insert artifact record (type must match what getLatestPrdArtifact / getLatestAnalystArtifact query for)
    const artifactType = STAGE_ARTIFACT_TYPE[stage] ?? stage;
    const artifactResult = db.prepare(`
      INSERT INTO artifacts (session_id, type, file_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, artifactType, artifactPath, Date.now());
    const artifactId = artifactResult.lastInsertRowid as number;

    // If this is a revision run, compute and save a diff of what changed
    let diffArtifactId: number | null = null;
    if (priorDraftContent) {
      try {
        const stageLabel = STAGE_ARTIFACT_TYPE[stage] ?? stage;
        const diffText = computeRevisionDiff(priorDraftContent, artifactContent, stageLabel);
        const diffPath = path.join(artifactDir, `${Date.now()}-${stage}-diff.md`);
        await fsAsync.writeFile(diffPath, diffText, 'utf-8');
        const diffResult = db.prepare(`
          INSERT INTO artifacts (session_id, type, file_path, created_at)
          VALUES (?, ?, ?, ?)
        `).run(sessionId, `${stage}_diff`, diffPath, Date.now());
        diffArtifactId = diffResult.lastInsertRowid as number;
        logger.info(`Revision diff saved for stage "${stage}" (artifact ${diffArtifactId})`);
      } catch (err: any) {
        logger.warn(`Failed to compute revision diff for "${stage}": ${err.message}`);
      }
    }

    // Log stage completion event with excerpt
    const excerpt = fullResponse.slice(0, 200).replace(/\n+/g, ' ').trim();
    const stageLabel = stage === 'analyst' ? 'Research' : stage === 'pm_prd' ? 'PRD' : stage === 'solution_architect' ? 'Architecture' : stage === 'pm_backlog' ? 'Backlog' : stage === 'gtm_strategy' ? 'GTM Strategy' : stage === 'feature_marketing' ? 'Feature Marketing' : stage;

    // ── Inline critic review for specialist stages ────────────────────────────
    // After each specialist produces an artifact, the critic reviews it.
    // If issues are found, auto-revise once. If still unresolved,
    // pause and ask the human for input.
    const specialistStages = new Set(['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'gtm_strategy', 'feature_marketing']);
    const policies = loadGlobalPolicies();
    const criticEnabled = policies.get('require_critic_review') !== 'false' && policies.get('require_critic_review') !== (false as any);

    if (specialistStages.has(stage) && criticEnabled && !skipCritic) {
      insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} draft complete.`,
        { excerpt, artifact_id: artifactId });

      // Brief pause before critic to reduce back-to-back API rate limit pressure
      await new Promise(r => setTimeout(r, 8_000));

      insertEvent(workflowId, 'stage_progress', stage, 'Running quality review...');

      // Load reference documents so the critic can cross-check completeness.
      // pm_backlog: needs PRD (FR coverage) + architecture (story scoping)
      // solution_architect: needs PRD (NFR traceability)
      // gtm_strategy: needs PRD (persona/scope consistency)
      // feature_marketing: needs PRD + GTM strategy (copy scope verification)
      let criticReferenceDocuments: string | undefined;
      if (stage === 'pm_backlog' || stage === 'solution_architect' || stage === 'gtm_strategy') {
        const refParts: string[] = [];
        const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
        if (prdPath) {
          try {
            const content = fs.readFileSync(prdPath, 'utf-8');
            refParts.push(`### PRD Document\n\n${content}`);
          } catch { /* ignore */ }
        }
        if (stage === 'pm_backlog') {
          const archPath = getLatestArchitectureArtifactPath(itemId);
          if (archPath) {
            try {
              const content = fs.readFileSync(archPath, 'utf-8');
              refParts.push(`### Architecture Document\n\n${content}`);
            } catch { /* ignore */ }
          }
        }
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      } else if (stage === 'feature_marketing') {
        const refParts: string[] = [];
        const prdPath = sessionManager.getLatestPrdArtifactPath(itemId);
        if (prdPath) {
          try {
            const content = fs.readFileSync(prdPath, 'utf-8');
            refParts.push(`### PRD Document\n\n${content}`);
          } catch { /* ignore */ }
        }
        const gtmPath = getLatestArtifactPathByType(itemId, 'gtm');
        if (gtmPath) {
          try {
            const content = fs.readFileSync(gtmPath, 'utf-8');
            refParts.push(`### GTM Strategy\n\n${content}`);
          } catch { /* ignore */ }
        }
        if (refParts.length > 0) criticReferenceDocuments = refParts.join('\n\n---\n\n');
      }

      const review = await getCritic().review(fullResponse, artifactType, resolveAgentModel('critic'), criticTokenCallback, stage, priorCriticIssues, criticReferenceDocuments);
      insertEvent(workflowId, 'stage_progress', stage, 'Quality review complete. Processing results...');

      // Save full critic review as artifact .md file
      const criticArtifactId = await saveCriticArtifact(itemId, stage, review.fullText, sessionId);

      const criticDetails = {
        critic_verdict: review.verdict,
        issue_count: review.issues.length,
        critical_issues: review.issues.filter(i => i.severity === 'critical').length,
        major_issues: review.issues.filter(i => i.severity === 'major').length,
        issues_summary: review.issues.slice(0, 5).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; '),
        inline_review: true,
        reviewed_stage: stage,
        critic_artifact_id: criticArtifactId,
        questions: review.questions,
        issues: review.issues.slice(0, 10),
      };

      if (review.verdict === 'approve') {
        // Critic approved — still pause for human review before advancing
        const now = Date.now();
        const cpResult = stmts.insertCheckpoint.run(
          workflowId, stage, artifactId, 'pending',
          JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
          now
        );
        if (specialistTokenData) {
          setCheckpointTokenUsage(cpResult.lastInsertRowid as number,
            { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}), ...(priorRunsCost ? { priorRunsCost } : {}) });
        }
        stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
        const minorCount = review.issues.filter(i => i.severity === 'minor').length;
        const approveMsg = minorCount > 0
          ? `Quality review passed with ${minorCount} minor note${minorCount > 1 ? 's' : ''} (resolved internally). Approve to proceed.`
          : 'Quality review passed — no issues found. Approve to proceed.';
        insertEvent(workflowId, 'critic_verdict', stage, approveMsg, criticDetails);
        logger.info(`Inline critic approved "${stage}" for workflow ${workflowId} — paused for human review`);
        return;
      }

      // Critic wants revisions — auto-revise once, then ask the human.
      // Keeps agents from looping on issues a human can resolve quickly.
      const MAX_INLINE_REVISIONS = 1;

      // Check how many times we've already revised this stage in this workflow
      const priorRevisions = stmts.getCheckpointsByWorkflow.all(workflowId)
        .filter(c => c.stage === stage && c.status === 'revised').length;

      if (priorRevisions < MAX_INLINE_REVISIONS) {
        // Auto-revise: rerun the specialist with the prior draft + explicit issue list.
        const now = Date.now();
        stmts.insertCheckpoint.run(
          workflowId, stage, artifactId, 'revised',
          JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails }),
          now
        );
        insertEvent(workflowId, 'critic_verdict', stage,
          `Quality review flagged issues. Auto-revising (attempt ${priorRevisions + 1}/${MAX_INLINE_REVISIONS}).`,
          criticDetails);

        // Keep workflow on the same stage
        stmts.updateWorkflowStageAndStatus.run(stage, 'active', now, workflowId);

        // Build a revision brief: includes the prior draft + explicit issue list so the
        // specialist revises its own output rather than writing a new document from scratch.
        const priorIssuesForRevision = review.issues.map(i => `[${i.severity.toUpperCase()}] ${i.description}`);
        const revisedBrief = getCoordinator().generateRevisionBrief(workflowId, stage, fullResponse, priorIssuesForRevision);
        const newSession = sessionManager.createBmadSession(itemId, stageMap.mode, stageMap.agentType);
        sessionManager.updateWorkflow(newSession.id, workflowId, revisedBrief);

        logger.info(`Inline critic revision ${priorRevisions + 1}/${MAX_INLINE_REVISIONS} for "${stage}" in workflow ${workflowId}`);
        const thisRunCost = specialistRunCost + criticRunCost;
        runAutonomousStage(newSession.id, workflowId, stage, itemId, revisedBrief, autoApprove, priorIssuesForRevision, fullResponse, (priorRunsCost ?? 0) + thisRunCost)
          .catch(err => logger.error(`Inline revision for "${stage}" failed: ${err.message}`));
        return;
      }

      // Max revisions exhausted — pause at checkpoint for human input
      const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
      const hasQuestions = review.questions && review.questions.length > 0;
      const questionsSummary = hasQuestions
        ? ` Questions: ${review.questions.slice(0, 2).join('; ')}`
        : '';

      const now = Date.now();
      const cpResult2 = stmts.insertCheckpoint.run(
        workflowId, stage, artifactId, 'pending',
        JSON.stringify({ session_id: sessionId, autonomous: true, critic: criticDetails, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
        now
      );
      if (specialistTokenData) {
        setCheckpointTokenUsage(cpResult2.lastInsertRowid as number,
          { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}) });
      }
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      insertEvent(workflowId, 'critic_verdict', stage,
        `Quality review still has unresolved issues after ${MAX_INLINE_REVISIONS} revision(s): ${issuesSummary}.${questionsSummary} How would you like to proceed?`,
        criticDetails);
      logger.info(`Inline critic exhausted revisions for "${stage}" — pausing for human input`);
      return;
    }

    // ── Non-critic path (critic disabled or non-specialist stage) ─────────────
    const checkpointStatus = autoApprove ? 'approved' : 'pending';
    const now = Date.now();
    const cpResult3 = stmts.insertCheckpoint.run(
      workflowId, stage, artifactId, checkpointStatus,
      JSON.stringify({ session_id: sessionId, autonomous: true, auto_approved: autoApprove, ...(diffArtifactId ? { diff_artifact_id: diffArtifactId } : {}) }),
      now
    );
    if (specialistTokenData) {
      setCheckpointTokenUsage(cpResult3.lastInsertRowid as number,
        { specialist: specialistTokenData, ...(criticTokenData ? { critic: criticTokenData } : {}) });
    }
    insertEvent(workflowId, 'stage_completed', stage, `${stageLabel} complete.`,
      { excerpt, artifact_id: artifactId });

    if (autoApprove) {
      logger.info(`Autonomous stage "${stage}" complete (silent) — advancing to next stage`);
      advanceStage(workflowId).catch(err => {
        if (err.message?.startsWith('WORKFLOW_COMPLETE')) {
          logger.info(`Workflow ${workflowId} completed after silent chain through "${stage}"`);
        } else {
          logger.error(`Auto-advance after silent stage "${stage}" failed: ${err.message}`);
          const now2 = Date.now();
          stmts.insertCheckpoint.run(
            workflowId, stage, null, 'pending',
            JSON.stringify({ error: `Auto-advance failed: ${err.message}`, autonomous: true }),
            now2
          );
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now2, workflowId);
        }
      });
    } else {
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      logger.info(`Autonomous stage "${stage}" complete — checkpoint created, workflow paused`);
    }
  } catch (err: any) {
    logger.error(`Autonomous stage "${stage}" failed: ${err.message}`);
    insertEvent(workflowId, 'error', stage,
      `Stage "${stage}" encountered an error: ${err.message}`,
      { error: err.message });
    // Create a pending checkpoint with the error so the UI doesn't hang forever
    const now = Date.now();
    stmts.insertCheckpoint.run(
      workflowId, stage, null, 'pending',
      JSON.stringify({ error: err.message, autonomous: true }),
      now
    );
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
  }
}

/**
 * Get the file path of the most recent architecture artifact for an item.
 */
function getLatestArchitectureArtifactPath(itemId: string): string | null {
  const row = db.prepare<[string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode = 'architecture'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  return row?.file_path ?? null;
}

/**
 * Get the file path of the most recent artifact of a given type for an item.
 * Used to load reference documents for the critic (e.g. GTM strategy when reviewing feature marketing).
 */
function getLatestArtifactPathByType(itemId: string, artifactType: string): string | null {
  const row = db.prepare<[string, string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  return row?.file_path ?? null;
}

/**
 * Load the most recently created artifact for an item, across all sessions.
 * Used by the critic stage to find the document to review.
 */
function loadLatestArtifactForItem(itemId: string): { content: string; type: string } {
  const row = db.prepare<[string], { file_path: string; type: string }>(`
    SELECT a.file_path, a.type
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND s.mode IN ('prd', 'analyst', 'architecture', 'backlog')
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);

  if (!row?.file_path) return { content: '(no artifact found)', type: 'document' };
  try {
    return { content: fs.readFileSync(row.file_path, 'utf-8'), type: row.type };
  } catch {
    return { content: '(artifact file unreadable)', type: row.type };
  }
}

/**
 * Force a workflow's status to 'complete' (e.g. after a rejection decision).
 */
export function markWorkflowComplete(workflowId: string): void {
  stmts.updateWorkflowStatus.run('complete', Date.now(), workflowId);
  insertEvent(workflowId, 'workflow_complete', null, 'Workflow ended.');
  logger.info(`Workflow ${workflowId} marked complete`);
}

/**
 * Pause a workflow at a checkpoint, waiting for human review.
 * The optional sessionId is stored in coordinator_action for later feedback propagation.
 */
export function pauseAtCheckpoint(
  workflowId: string,
  stage: string,
  artifactId?: number,
  sessionId?: string
): CheckpointRow {
  const now = Date.now();
  const coordinatorAction = sessionId ? JSON.stringify({ session_id: sessionId }) : null;

  const result = stmts.insertCheckpoint.run(
    workflowId, stage, artifactId ?? null, 'pending', coordinatorAction, now
  );

  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  const checkpoint = stmts.getCheckpoint.get(result.lastInsertRowid as number)!;
  logger.info(`Paused workflow ${workflowId} at checkpoint #${checkpoint.id} for stage "${stage}"`);
  return checkpoint;
}

/**
 * Resolve a checkpoint after human review.
 * - approved: workflow can advance to the next stage
 * - rejected: workflow stays active but intervention is needed
 * - revised: current_stage is rolled back so advanceStage reruns it
 */
export function resolveCheckpoint(
  checkpointId: number,
  status: 'approved' | 'rejected' | 'revised',
  feedback?: string
): void {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);
  if (checkpoint.status !== 'pending') {
    throw new Error(`Checkpoint ${checkpointId} is not pending (current: ${checkpoint.status})`);
  }

  const now = Date.now();

  if (status === 'revised') {
    // Roll current_stage back to the stage before this one so advanceStage re-enters it
    const workflow = stmts.getWorkflow.get(checkpoint.workflow_id)!;
    const sequence: string[] = JSON.parse(workflow.stage_sequence);
    const stageIdx = sequence.indexOf(checkpoint.stage);
    const prevStage = stageIdx > 0 ? sequence[stageIdx - 1] : null;

    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);
    stmts.updateWorkflowStageAndStatus.run(prevStage, 'active', now, checkpoint.workflow_id);
    logger.info(`Checkpoint ${checkpointId} revised — workflow ${checkpoint.workflow_id} will rerun stage "${checkpoint.stage}"`);
  } else {
    // approved or rejected — both set workflow back to active
    stmts.updateCheckpoint.run(status, feedback ?? null, checkpoint.coordinator_action, now, checkpointId);
    stmts.updateWorkflowStatus.run('active', now, checkpoint.workflow_id);
    logger.info(`Checkpoint ${checkpointId} ${status} — workflow ${checkpoint.workflow_id} active`);
  }
}

/**
 * Get the full status of a workflow: workflow row, all checkpoints, stage info.
 */
export function getWorkflowStatus(workflowId: string): WorkflowStatus {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const checkpoints = stmts.getCheckpointsByWorkflow.all(workflowId);

  const completedStages = checkpoints
    .filter(c => c.status === 'approved')
    .map(c => c.stage);

  const pendingCheckpoint = checkpoints.find(c => c.status === 'pending');

  // Look up the active specialist session for the current stage
  let currentSessionId: string | null = null;
  if (workflow.current_stage && workflow.status === 'active') {
    const stageMap = STAGE_SESSION_MAP[workflow.current_stage];
    if (stageMap) {
      const row = stmts.getLatestSessionForItemMode.get(workflow.item_id, stageMap.mode);
      currentSessionId = row?.id ?? null;
    }
  }

  return {
    workflow,
    checkpoints,
    currentStage: workflow.current_stage,
    completedStages,
    pendingStage: pendingCheckpoint?.stage ?? null,
    currentSessionId,
  };
}

// ── Story 3.3: Feedback propagation ───────────────────────────────────────────

/**
 * Propagate human feedback on a checkpoint back to the specialist session.
 * Generates a revised stage brief via the Coordinator and appends it as a user
 * message to the specialist's existing session, then marks the checkpoint as revised.
 */
export async function propagateFeedback(checkpointId: number, feedback: string): Promise<void> {
  const checkpoint = stmts.getCheckpoint.get(checkpointId);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);

  const workflow = stmts.getWorkflow.get(checkpoint.workflow_id);
  if (!workflow) throw new Error(`Workflow not found: ${checkpoint.workflow_id}`);

  // Load the full prior artifact — passed as the assistant turn in the conversation thread
  const priorDraft = checkpoint.artifact_id
    ? loadFullArtifact(checkpoint.artifact_id)
    : undefined;

  // Build the revision brief (instructions only — prior draft goes into the message thread)
  const brief = priorDraft
    ? getCoordinator().generateRevisionBrief(
        checkpoint.workflow_id,
        checkpoint.stage,
        priorDraft,
        [`[HUMAN FEEDBACK] ${feedback}`]
      )
    : await getCoordinator().generateStageBrief(
        checkpoint.workflow_id,
        checkpoint.stage,
        `**Human feedback requiring revision:** ${feedback}`
      );

  // Mark the old checkpoint as revised.
  const now = Date.now();
  stmts.updateCheckpoint.run(
    'revised',
    feedback,
    JSON.stringify({ action: 'revision_rerun', feedback_summary: feedback.slice(0, 200), acted_at: now }),
    now,
    checkpointId
  );

  // Set current_stage to this stage and status to active — a new run is starting.
  stmts.updateWorkflowStageAndStatus.run(checkpoint.stage, 'active', now, checkpoint.workflow_id);

  // Create a fresh specialist session and fire an autonomous re-run.
  const stageMap = STAGE_SESSION_MAP[checkpoint.stage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
  const session = sessionManager.createBmadSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, checkpoint.workflow_id, brief);

  const shouldAutoApprove = SILENT_STAGES.has(checkpoint.stage);

  // Skip critic on human-initiated revisions — the human is now the reviewer
  // Pass priorDraft so runAutonomousStage threads it as the assistant turn
  runAutonomousStage(session.id, checkpoint.workflow_id, checkpoint.stage, workflow.item_id, brief, shouldAutoApprove, undefined, priorDraft, undefined, true)
    .catch(err => logger.error(`Revision re-run for stage "${checkpoint.stage}" failed: ${err.message}`));

  logger.info(`Revision re-run started — session ${session.id} for stage "${checkpoint.stage}" in workflow ${checkpoint.workflow_id}`);
}

/**
 * Re-enter a completed workflow at a specific stage.
 * The given stage and all downstream stages are re-run using the user's
 * feedback as context. Existing artifacts are preserved for audit trail.
 */
export async function reiterateFromStage(
  workflowId: string,
  fromStage: string,
  feedback: string
): Promise<void> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'complete') {
    throw new Error(`Workflow ${workflowId} is not complete (status: ${workflow.status}) — reiteration only applies to completed workflows`);
  }

  const sequence: string[] = JSON.parse(workflow.stage_sequence);
  const idx = sequence.indexOf(fromStage);
  if (idx < 0) throw new Error(`Stage "${fromStage}" is not in the workflow's stage sequence`);

  const stageLabel = STAGE_LABELS_INTERNAL[fromStage] ?? fromStage;
  insertEvent(workflowId, 'reiteration', fromStage,
    `Re-entering at ${stageLabel}: ${feedback.slice(0, 200)}`);

  // Mark existing approved checkpoints for fromStage and all downstream stages
  // as 'revised' so they no longer count as completed in the UI
  const downstreamStages = sequence.slice(idx);
  for (const stage of downstreamStages) {
    db.prepare(`
      UPDATE checkpoints SET status = 'revised'
      WHERE workflow_id = ? AND stage = ? AND status = 'approved'
    `).run(workflowId, stage);
  }

  // Set current_stage to fromStage so the UI shows the correct active stage
  // and retryCurrentStage can recover if the server restarts mid-run
  const now = Date.now();
  stmts.updateWorkflowStageAndStatus.run(fromStage, 'active', now, workflowId);

  // Load the prior artifact so the specialist can revise in-place
  const priorDraft = loadLatestArtifactForStage(workflow.item_id, fromStage);
  const brief = priorDraft
    ? getCoordinator().generateRevisionBrief(workflowId, fromStage, priorDraft, [`[HUMAN FEEDBACK] ${feedback}`])
    : await getCoordinator().generateStageBrief(workflowId, fromStage, feedback);

  // Create a new specialist session
  const stageMap = STAGE_SESSION_MAP[fromStage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
  const session = sessionManager.createBmadSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, workflowId, brief);

  const shouldAutoApprove = SILENT_STAGES.has(fromStage);

  // Fire the autonomous stage — skip critic since this is human-initiated
  // Pass priorDraft so runAutonomousStage threads it as the assistant turn
  runAutonomousStage(session.id, workflowId, fromStage, workflow.item_id, brief, shouldAutoApprove, undefined, priorDraft, undefined, true)
    .catch(err => logger.error(`Reiteration re-run for stage "${fromStage}" failed: ${err.message}`));

  logger.info(`Reiteration started — session ${session.id} for stage "${fromStage}" in workflow ${workflowId}`);
}

/**
 * Extend a completed workflow by appending new stages.
 *
 * New stages are inserted before 'curator' (if present), so the curator runs
 * last after all new content has been produced. The workflow is re-activated
 * and advanceStage() fires the first new stage immediately.
 *
 * Rules:
 * - Workflow must be 'complete'.
 * - Stages must be known and not already in the sequence.
 * - At least one stage required.
 */
export async function extendWorkflow(workflowId: string, stagesToAdd: string[]): Promise<void> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'complete') {
    throw new Error(`Workflow ${workflowId} is not complete (status: ${workflow.status}) — only completed workflows can be extended`);
  }
  if (!stagesToAdd.length) throw new Error('At least one stage is required');

  const sequence: string[] = JSON.parse(workflow.stage_sequence);

  // Reject stages that are already in the sequence
  const duplicates = stagesToAdd.filter(s => sequence.includes(s));
  if (duplicates.length) {
    throw new Error(`Stage(s) already in workflow: ${duplicates.join(', ')}`);
  }

  // Insert new stages before curator (if present), otherwise append
  const curatorIdx = sequence.indexOf('curator');
  const newSequence = curatorIdx >= 0
    ? [...sequence.slice(0, curatorIdx), ...stagesToAdd, ...sequence.slice(curatorIdx)]
    : [...sequence, ...stagesToAdd];

  const firstNewStage = stagesToAdd[0];
  const now = Date.now();

  // If curator had an approved checkpoint, mark it revised so it will re-run
  if (curatorIdx >= 0) {
    db.prepare(`
      UPDATE checkpoints SET status = 'revised'
      WHERE workflow_id = ? AND stage = 'curator' AND status = 'approved'
    `).run(workflowId);
  }

  // Set current_stage to the stage BEFORE firstNewStage so advanceStage()
  // naturally advances into firstNewStage first. Without this, advanceStage
  // would advance FROM firstNewStage TO the second new stage, skipping the first.
  const firstNewIdx = newSequence.indexOf(firstNewStage);
  const stageBeforeFirst = firstNewIdx > 0 ? newSequence[firstNewIdx - 1] : null;

  // Persist the new sequence and re-activate the workflow
  db.prepare(`
    UPDATE workflows SET stage_sequence = ?, current_stage = ?, status = 'active', updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(newSequence), stageBeforeFirst, now, workflowId);

  const addedLabels = stagesToAdd.map(s => STAGE_LABELS_INTERNAL[s] ?? s).join(', ');
  insertEvent(workflowId, 'reiteration', firstNewStage,
    `Workflow extended with new stage${stagesToAdd.length > 1 ? 's' : ''}: ${addedLabels}`);

  logger.info(`Workflow ${workflowId} extended with [${stagesToAdd.join(', ')}] — new sequence: ${newSequence.join(' → ')}`);

  // Kick off the first new stage
  await advanceStage(workflowId);
}

/**
 * Retry the current stage of an active workflow that appears stuck.
 * Only allowed when status is 'active' and there's a current_stage set.
 * Re-generates the stage brief and starts a fresh specialist session.
 */
export async function retryCurrentStage(workflowId: string): Promise<{ stage: string }> {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  if (workflow.status !== 'active') {
    throw new Error(`Workflow is not active (status: ${workflow.status})`);
  }
  if (!workflow.current_stage) {
    throw new Error('No current stage to retry');
  }

  const stage = workflow.current_stage;
  const stageLabel = STAGE_LABELS_INTERNAL[stage] ?? stage;

  logger.info(`Retrying stuck stage "${stage}" for workflow ${workflowId}`);
  insertEvent(workflowId, 'stage_progress', stage,
    `Retrying ${stageLabel} (manually triggered)...`);

  // Reset workflow status to active on this stage
  const now = Date.now();
  stmts.updateWorkflowStageAndStatus.run(stage, 'active', now, workflowId);

  // Generate a fresh brief
  const brief = await getCoordinator().generateStageBrief(workflowId, stage);

  // Create a new specialist session
  const stageMap = STAGE_SESSION_MAP[stage] ?? { mode: 'analyst' as AppMode, agentType: 'analyst' as AgentType };
  const session = sessionManager.createBmadSession(workflow.item_id, stageMap.mode, stageMap.agentType);
  sessionManager.updateWorkflow(session.id, workflowId, brief);

  const shouldAutoApprove = SILENT_STAGES.has(stage);

  runAutonomousStage(session.id, workflowId, stage, workflow.item_id, brief, shouldAutoApprove)
    .catch(err => logger.error(`Retry re-run for stage "${stage}" failed: ${err.message}`));

  return { stage };
}

const STAGE_LABELS_INTERNAL: Record<string, string> = {
  analyst:            'Analyst — Sage',
  pm_prd:             'Requirements — Rex',
  solution_architect: 'Architect — Atlas',
  pm_backlog:         'Backlog — Pip',
  gtm_strategy:       'GTM Strategy — Quinn',
  feature_marketing:  'Feature Marketing — Milo',
  critic:             'Critic — Flint',
  curator:            'Curator — Ivy',
};

/**
 * Delete a workflow and all associated data:
 * - Artifact files on disk (specialist outputs, critic reviews, diffs)
 * - Sessions created for this workflow (cascades messages + artifact rows)
 * - Checkpoints, context_diffs, workflow_events, coordinator_sessions
 * - The workflow row itself
 */
export function deleteWorkflow(workflowId: string): void {
  const workflow = stmts.getWorkflow.get(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  // ── 1. Collect session IDs and artifact file paths from checkpoints ──────
  const checkpoints = stmts.getCheckpointsByWorkflow.all(workflowId);

  const sessionIds = new Set<string>();
  const artifactIds = new Set<number>();

  for (const cp of checkpoints) {
    // Collect artifact IDs referenced by checkpoints
    if (cp.artifact_id) artifactIds.add(cp.artifact_id);

    // Parse coordinator_action for session_id and additional artifact IDs
    if (cp.coordinator_action) {
      try {
        const action = JSON.parse(cp.coordinator_action);
        if (action.session_id) sessionIds.add(action.session_id);
        if (action.critic?.critic_artifact_id) artifactIds.add(action.critic.critic_artifact_id);
        if (action.diff_artifact_id) artifactIds.add(action.diff_artifact_id);
        // Also check nested critic object
        if (action.critic_artifact_id) artifactIds.add(action.critic_artifact_id);
      } catch { /* ignore malformed JSON */ }
    }
  }

  // ── 2. Resolve artifact file paths from DB ───────────────────────────────
  const filePaths: string[] = [];
  for (const id of artifactIds) {
    const row = db.prepare<[number], { file_path: string }>(
      'SELECT file_path FROM artifacts WHERE id = ?'
    ).get(id);
    if (row?.file_path) filePaths.push(row.file_path);
  }

  // Also collect file paths for all artifacts owned by these sessions
  // (catches any artifacts not directly referenced by checkpoints)
  for (const sessionId of sessionIds) {
    const rows = db.prepare<[string], { file_path: string }>(
      'SELECT file_path FROM artifacts WHERE session_id = ?'
    ).all(sessionId);
    for (const row of rows) {
      if (row.file_path) filePaths.push(row.file_path);
    }
  }

  // ── 3. Delete artifact files from disk ───────────────────────────────────
  let deletedFiles = 0;
  for (const filePath of filePaths) {
    try {
      fs.unlinkSync(filePath);
      deletedFiles++;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not delete artifact file ${filePath}: ${err.message}`);
      }
    }
  }

  // ── 4. Delete sessions (cascades to messages, artifacts, staged_decisions) ─
  for (const sessionId of sessionIds) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  // ── 5. Delete workflow child rows and the workflow itself ─────────────────
  db.prepare('DELETE FROM checkpoints WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM context_diffs WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM workflow_events WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM coordinator_sessions WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);

  logger.info(`Deleted workflow ${workflowId} — ${deletedFiles} file(s) removed, ${sessionIds.size} session(s) deleted`);
}

function loadLatestArtifactForStage(itemId: string, stage: string): string | undefined {
  const artifactType = STAGE_ARTIFACT_TYPE[stage];
  if (!artifactType) return undefined;
  const row = db.prepare<[string, string], { file_path: string }>(`
    SELECT a.file_path FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = ?
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId, artifactType);
  if (!row?.file_path) return undefined;
  try {
    return fs.readFileSync(row.file_path, 'utf-8');
  } catch {
    return undefined;
  }
}

function loadFullArtifact(artifactId: number): string | undefined {
  const row = db.prepare<[number], { file_path: string }>(
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row?.file_path) return undefined;
  try {
    return fs.readFileSync(row.file_path, 'utf-8');
  } catch {
    return undefined;
  }
}

function loadArtifactSummary(artifactId: number): string | undefined {
  const row = db.prepare<[number], { file_path: string }>(
    'SELECT file_path FROM artifacts WHERE id = ?'
  ).get(artifactId);
  if (!row?.file_path) return undefined;
  try {
    const content = fs.readFileSync(row.file_path, 'utf-8');
    return content.slice(0, 500) + (content.length > 500 ? '\n[…truncated]' : '');
  } catch {
    return undefined;
  }
}

// ── Stale workflow recovery ─────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes with no update = stale

interface StaleWorkflowRow {
  id: string;
  current_stage: string | null;
  updated_at: number;
}

/**
 * Recover workflows stuck in 'active' status with no recent updates.
 * Creates an error checkpoint so the user can retry or dismiss.
 * Safe to call on startup and periodically.
 */
export function recoverStaleWorkflows(): number {
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  const stale = db.prepare<[number], StaleWorkflowRow>(
    `SELECT id, current_stage, updated_at FROM workflows
     WHERE status = 'active' AND updated_at < ?`
  ).all(cutoff);

  let recovered = 0;
  for (const wf of stale) {
    const stage = wf.current_stage ?? 'unknown';
    const staleMinutes = Math.round((Date.now() - wf.updated_at) / 60_000);
    const now = Date.now();

    insertEvent(wf.id, 'error', stage,
      `Stage "${stage}" appears stuck (no activity for ${staleMinutes} minutes). You can retry or dismiss this stage.`,
      { error: 'stale_workflow_recovery', stale_minutes: staleMinutes });

    stmts.insertCheckpoint.run(
      wf.id, stage, null, 'pending',
      JSON.stringify({ error: `Stage stalled after ${staleMinutes} minutes of inactivity`, autonomous: true, stale_recovery: true }),
      now
    );
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, wf.id);

    logger.warn(`Recovered stale workflow ${wf.id} — stage "${stage}" stuck for ${staleMinutes}m`);
    recovered++;
  }

  if (recovered > 0) {
    logger.info(`Stale workflow recovery: ${recovered} workflow(s) recovered`);
  }
  return recovered;
}

// Run stale recovery on module load (server startup) and every 5 minutes
recoverStaleWorkflows();
setInterval(recoverStaleWorkflows, 5 * 60 * 1000);
