/**
 * critic-gate — shared "run the critic, filter its findings through the
 * Coordinator's scope check, and persist the review" flow. Used by both the
 * single-specialist stage runner (workflow-stage-runner.ts) and the multi-agent
 * feature/QA stage runner (feature-stage-runner.ts) so the two pipelines can't
 * drift on how a critic verdict is produced.
 *
 * Callers own everything downstream of the verdict (checkpoint creation, the
 * approve/revise branch, auto-revision) since that differs between the two
 * pipelines.
 */
import { resolveAgentModel, type TokenUsage } from '../utils/ai-provider';
import { getCritic, getCoordinator } from './workflow-agents';
import { saveCriticArtifact } from './artifact-helpers';
import { insertEvent } from './workflow-db';
import type { CriticIssue } from './critic-agent';

export interface CriticGateResult {
  verdict: 'approve' | 'revise';
  issues: CriticIssue[];
  questions: string[];
  criticArtifactId: number;
  criticDetails: Record<string, unknown>;
}

export async function runCriticGate(opts: {
  workflowId: string;
  itemId: string;
  sessionId: string;
  stage: string;
  /** Stage key used to look up the critic's persona/stage-check file (critic-agent.ts's
   *  STAGE_CRITIC_FILE). Defaults to `stage`. Needed for the per-feature multi-agent stages
   *  (e.g. "story_decomposition_F2"), which have no entry of their own and must resolve to
   *  the base persona key ("story_decomposition") instead. */
  personaStage?: string;
  artifactContent: string;
  artifactType: string;
  referenceDocuments?: string;
  priorIssues?: string[];
  onTokens?: (usage: TokenUsage) => void;
}): Promise<CriticGateResult> {
  let review = await getCritic().review(
    opts.artifactContent, opts.artifactType, resolveAgentModel('critic'),
    opts.onTokens, opts.personaStage ?? opts.stage, opts.priorIssues, opts.referenceDocuments
  );

  // Coordinator scope filter — issues that contradict the initiative's stated
  // scope are dropped before the revision decision is made.
  if (review.verdict === 'revise' && review.issues.length > 0) {
    const filterResult = await getCoordinator().filterCriticIssues(opts.workflowId, opts.stage, review.issues);
    if (filterResult.filteredCount > 0) {
      const noun = filterResult.filteredCount === 1 ? 'issue' : 'issues';
      insertEvent(opts.workflowId, 'stage_progress', opts.stage,
        `Chief of Staff removed ${filterResult.filteredCount} out-of-scope ${noun}. ${filterResult.reasoning}`);
    }
    review = { ...review, issues: filterResult.validIssues };
    const hasCritical = filterResult.validIssues.some(i => i.severity === 'critical');
    const majorCount = filterResult.validIssues.filter(i => i.severity === 'major').length;
    if (!hasCritical && majorCount < 2) review = { ...review, verdict: 'approve' };
  }

  const criticArtifactId = await saveCriticArtifact(opts.itemId, opts.stage, review.fullText, opts.sessionId);

  const criticDetails = {
    critic_verdict: review.verdict,
    issue_count: review.issues.length,
    critical_issues: review.issues.filter(i => i.severity === 'critical').length,
    major_issues: review.issues.filter(i => i.severity === 'major').length,
    issues_summary: review.issues.slice(0, 5).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; '),
    inline_review: true,
    reviewed_stage: opts.stage,
    critic_artifact_id: criticArtifactId,
    questions: review.questions,
    issues: review.issues.slice(0, 10),
  };

  return { verdict: review.verdict, issues: review.issues, questions: review.questions, criticArtifactId, criticDetails };
}
