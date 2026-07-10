/**
 * workflow-planning — shared helpers for the pre-workflow coordinator planning
 * phase. Used by both the coordinator routes (which run the planning Q&A) and the
 * /start route (which consumes the accumulated planning cost when the workflow is
 * created). Kept in one module so the in-memory cost map is a single shared
 * singleton across those route files.
 */
import db from '../data/database';
import { CoordinatorAgent } from '../agents/coordinator-agent';

// Critic no longer appears as a standalone stage — it runs inline after each specialist stage.
// The curator runs at the end to update project context files.
export const DEFAULT_STAGES = ['analyst', 'pm_prd', 'prototype', 'figma_design', 'solution_architect', 'api_spec', 'epic_feature_planner', 'story_decomposition', 'curator'];

// ── Coordinator planning sessions (DB-backed) ─────────────────────────────────

export type PlanningMessages = Array<{ role: 'user' | 'assistant'; content: string }>;

export function saveCoordinatorSession(
  id: string,
  workflowId: string | null,
  type: 'pre_workflow' | 'stage_briefing',
  nextStage: string | null,
  messages: PlanningMessages
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO coordinator_sessions (id, workflow_id, type, next_stage, messages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at
  `).run(id, workflowId, type, nextStage, JSON.stringify(messages), now, now);
}

export function loadCoordinatorSession(id: string): {
  messages: PlanningMessages;
  type: 'pre_workflow' | 'stage_briefing';
  nextStage: string | null;
  workflowId: string | null;
} | null {
  const row = db.prepare('SELECT * FROM coordinator_sessions WHERE id = ?').get(id) as {
    messages: string; type: string; next_stage: string | null; workflow_id: string | null;
  } | undefined;
  if (!row) return null;
  return {
    messages: JSON.parse(row.messages ?? '[]'),
    type: row.type as 'pre_workflow' | 'stage_briefing',
    nextStage: row.next_stage,
    workflowId: row.workflow_id,
  };
}

let _planningCoordinator: CoordinatorAgent | null = null;
export function getPlanningCoordinator(): CoordinatorAgent {
  if (!_planningCoordinator) _planningCoordinator = new CoordinatorAgent();
  return _planningCoordinator;
}

/**
 * Strip leaked system prompt instructions from coordinator responses.
 * Small models (especially Ollama) sometimes echo their instructions verbatim.
 */
export function cleanCoordinatorResponse(text: string): string {
  // Patterns that indicate leaked system prompt content
  const leakedPatterns = [
    /^#+\s*(Hard limits|What actually matters|How to ask|Signalling readiness|Format rules)[^\n]*\n/gm,
    /\*?\*?(Maximum \d+ questions|Maximum \d+ rounds|Prefer to launch early)\*?\*?[^\n]*\n/gm,
    /Do NOT ask about feature lists[^\n]*\n/gm,
    /Put each question on its own line[^\n]*\n/gm,
    /Use lettered options \(A \/ B \/ C\) when choices are clear:\s*\n\s*A\) Option one\s*\n\s*B\) Option two\s*\n/gm,
    /Accept terse answers and make reasonable inferences[^\n]*\n/gm,
    /End your response with exactly these two lines[^\n]*\n/gm,
    /`?COORDINATOR_READY`? must be a standalone line[^\n]*\n/gm,
    /The JSON object must be on the very next line[^\n]*\n/gm,
    /COORDINATOR_READY is\s*\*?\*?forbidden\*?\*?\s*in your first message[^\n]*\n/gm,
    /From message \d+ onward[^\n]*\n/gm,
    /By message \d+ you must include it[^\n]*\n/gm,
    /a wrong format causes a system failure[^\n]*\n/gm,
    /Do not ask a fourth round[^\n]*\n/gm,
    /Ask only if you genuinely cannot infer[^\n]*:\n/gm,
    /\*?\*?Who is it for\*?\*?\s*—\s*primary user\/customer segment[^\n]*\n/gm,
    /\*?\*?Scope\*?\*?\s*—\s*MVP or full product[^\n]*\n/gm,
    /\*?\*?Hard blockers\*?\*?\s*—\s*regulatory, technical[^\n]*\n/gm,
    /For message \d+, provide the following[^\n]*/gm,
    /Nothing may follow the JSON line[^\n]*\n/gm,
    /Do NOT repeat or quote these instructions[^\n]*\n/gm,
  ];

  let cleaned = text;
  for (const pattern of leakedPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
