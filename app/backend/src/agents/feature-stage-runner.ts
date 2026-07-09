/**
 * feature-stage-runner — handles the story_decomposition_F* stages, which run a
 * multi-agent collaborative refinement session per feature instead of the normal
 * single-specialist flow. Split out of runAutonomousStage, which dispatches here
 * when the stage name matches story_decomposition_F<n>.
 *
 * Exports:
 *   runBacklogMerge — merge all isolated feature artifacts into final backlog
 *   runMultiAgentFeatureStage — full 3-phase pipeline for initial runs
 *   runMultiAgentFeatureRevision / runMultiAgentFeatureQaRevision — surgical
 *     single-agent edits for human/critic revisions (spec-driven, see below)
 *   runEpicQaStage / runEpicQaRevision — epic-level QA suite generation + revision
 */
import type { AgentType } from '@pap/shared';
import db from '../data/database';
import { logger, insertEvent, stmts, loadGlobalPolicies } from './workflow-db';
import { validateBacklogJson, validateQaTestsJson } from './tool-validators';
import { isCancelRequested } from './workflow-cancel';
import { resolveAgentModel } from '../utils/ai-provider';
import { progressHeartbeatLine, collectStreamWithHeartbeat, STAGE_MAX_OUTPUT_TOKENS, resolveMaxOutputTokens } from './stage-metadata';
import { stripJsonFence, repairTruncatedJson } from '../utils/json-repair';
import { computeRevisionDiff } from '../utils/revision-diff';
import { loadEpicFeatures } from './feature-decomposition';
import { detectBacklogOverlaps, recordOverlapFlags, loadAutoResolvedStoryKeys, excludeAutoResolvedStories, buildFrOwnershipMap, detectOutOfScopeFrReferences } from './backlog-overlap';
import { loadLatestArtifactContent, saveLocalArtifact, saveDiffArtifact } from './artifact-helpers';
import { SpecialistAgent } from './specialist-agent';
import { summarizeRevisionDiff } from './revision-diff-summary';
import { isDemoWorkflow } from '../demo/demo-mode';
import { getCoordinator } from './workflow-agents';
import { runCriticGate } from './critic-gate';
import {
  runMultiAgentRefinement,
  resolveProductAreaScope,
  buildPlatformScopeSection,
  buildFeaturePlatformScopeSection,
  filterBacklogStoriesByScope,
  filterBacklogStoriesByFeaturePlatforms,
  filterQaTestCasesByStoryIds,
  ACCEPTANCE_CRITERIA_FORMAT_RULE,
  type ProductAreaScope,
} from './multi-agent-refinement';
// workflow-router is imported dynamically throughout this module: it reaches back here
// via workflow-mutations → workflow-stage-runner, so a static import would be circular.

/**
 * Log + emit a validation_warning event for a deterministic validator result, but only
 * when it actually flagged issues. Consolidates the identical "if invalid with issues →
 * warn + insertEvent" block used after every backlog / QA generation and revision.
 */
function emitValidationWarnings(
  workflowId: string,
  stage: string,
  validation: { valid: boolean; issues?: string[] },
  logPrefix: string,
  eventMessage: (issueCount: number) => string
): void {
  if (validation.valid || !Array.isArray(validation.issues) || validation.issues.length === 0) return;
  logger.warn(`${logPrefix}: ${validation.issues.join(' | ')}`);
  insertEvent(workflowId, 'validation_warning', stage, eventMessage(validation.issues.length), { issues: validation.issues });
}

/**
 * After a multi-agent stage (per-feature backlog or epic QA) produces its artifact, run the
 * quality critic against it and either checkpoint for human review (approve) or auto-fix once
 * via the stage's own targeted surgical-revision path — the same one human reviewers trigger,
 * so this reuses its existing save/diff/checkpoint handling rather than duplicating it. Bounded
 * to one automatic pass, mirroring MAX_INLINE_REVISIONS in the single-specialist inline critic
 * gate (workflow-stage-runner.ts), so a critic can't loop on issues a human could resolve in one
 * message. Skipped entirely for demo fixtures and when require_critic_review is off.
 */
async function runFeatureCriticGate(opts: {
  workflowId: string;
  itemId: string;
  sessionId: string;
  /** Raw workflow stage, e.g. "story_decomposition_F2" or "epic_qa" — used for events/checkpoints. */
  stage: string;
  /** Persona lookup key for the critic (e.g. "story_decomposition", "epic_qa"). */
  personaStage: string;
  artifactId: number;
  artifactContent: string;
  artifactType: string;
  isDemo: boolean;
  completionMessage: string;
  /** Runs the stage's existing targeted revision path; it saves, diffs, and checkpoints itself. */
  runRevision: (priorDraft: string, brief: string) => Promise<void>;
}): Promise<void> {
  const { workflowId, itemId, sessionId, stage, personaStage, artifactId, artifactContent, artifactType, isDemo, completionMessage, runRevision } = opts;
  const { pauseAtCheckpoint } = await import('./workflow-router'); // dynamic: breaks the workflow-router → stage-runner cycle

  const policies = loadGlobalPolicies();
  const criticEnabled = policies.get('require_critic_review') !== 'false' && policies.get('require_critic_review') !== (false as any);

  if (isDemo || !criticEnabled) {
    await pauseAtCheckpoint(workflowId, stage, artifactId, undefined, undefined);
    insertEvent(workflowId, 'stage_completed', stage, completionMessage, { artifact_id: artifactId });
    return;
  }

  insertEvent(workflowId, 'stage_progress', stage, `Running quality review on ${artifactType}...`);
  const review = await runCriticGate({
    workflowId, itemId, sessionId, stage, personaStage, artifactContent, artifactType,
  });

  if (review.verdict === 'approve') {
    await pauseAtCheckpoint(workflowId, stage, artifactId, undefined, { critic: review.criticDetails });
    const minorCount = review.issues.filter(i => i.severity === 'minor').length;
    const approveMsg = minorCount > 0
      ? `Quality review passed with ${minorCount} minor note${minorCount > 1 ? 's' : ''} (resolved internally). Approve to proceed.`
      : 'Quality review passed — no issues found. Approve to proceed.';
    insertEvent(workflowId, 'critic_verdict', stage, approveMsg, review.criticDetails);
    insertEvent(workflowId, 'stage_completed', stage, completionMessage, { artifact_id: artifactId });
    return;
  }

  // Critic wants revisions — auto-revise once via the stage's targeted revision path, then
  // ask the human. Same cap as the single-specialist inline critic gate.
  const MAX_INLINE_REVISIONS = 1;
  const priorRevisions = stmts.getCheckpointsByWorkflow.all(workflowId)
    .filter(c => c.stage === stage && c.status === 'revised').length;

  if (priorRevisions >= MAX_INLINE_REVISIONS) {
    const issuesSummary = review.issues.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.description}`).join('; ');
    await pauseAtCheckpoint(workflowId, stage, artifactId, undefined, { critic: review.criticDetails });
    insertEvent(workflowId, 'critic_verdict', stage,
      `Quality review still has unresolved issues after ${MAX_INLINE_REVISIONS} revision(s): ${issuesSummary}. How would you like to proceed?`,
      review.criticDetails);
    return;
  }

  const now = Date.now();
  stmts.insertCheckpoint.run(workflowId, stage, artifactId, 'revised', JSON.stringify({ critic: review.criticDetails }), null, now);
  insertEvent(workflowId, 'critic_verdict', stage,
    `Quality review flagged issues. Auto-revising (attempt ${priorRevisions + 1}/${MAX_INLINE_REVISIONS}).`,
    review.criticDetails);

  const issueStrings = review.issues.map(i => `[${i.severity.toUpperCase()}] ${i.description}`);
  const brief = getCoordinator().generateRevisionBrief(workflowId, stage, artifactContent, issueStrings);
  await runRevision(artifactContent, brief);
}

/**
 * Compute + persist the revision diff for a surgical edit and summarise it so the
 * reviewer can confirm at a glance that the requested changes were applied.
 * Best-effort: failures are logged, never fatal to the revision itself. The diff is
 * saved under the same folder as the revised artifact (artifactType, e.g. backlog_F2),
 * not the suffixed stage name, so a feature's outputs stay together — see saveDiffArtifact.
 */
async function saveRevisionDiffAndSummary(opts: {
  itemId: string;
  sessionId: string;
  artifactType: string;
  diffLabel: string;
  priorDraft: string;
  revisedContent: string;
  brief: string;
  logPrefix: string;
}): Promise<string | undefined> {
  try {
    const diffText = computeRevisionDiff(opts.priorDraft, opts.revisedContent, opts.diffLabel);
    const diffArtifactId = await saveDiffArtifact(opts.itemId, opts.artifactType, diffText, opts.sessionId);
    if (diffArtifactId) logger.info(`${opts.logPrefix} revision diff saved (id: ${diffArtifactId})`);
    return await summarizeRevisionDiff({ stageLabel: opts.diffLabel, requestContext: opts.brief, diffText }) || undefined;
  } catch (err: any) {
    logger.warn(`${opts.logPrefix} failed to save revision diff/summary: ${err.message}`);
    return undefined;
  }
}

/**
 * Merge all isolated feature artifacts (backlog_F1, backlog_F2, backlog_F3, ...) into
 * a single final backlog artifact. This is a simple JSON merge — no LLM call needed.
 */
export async function runBacklogMerge(
  sessionId: string,
  workflowId: string,
  itemId: string
): Promise<void> {
  logger.info(`[BACKLOG MERGE] Starting merge of all feature artifacts`);

  insertEvent(workflowId, 'stage_progress', 'backlog_merge',
    'Merging all feature artifacts into final backlog...');

  // Load epic_features first — it's the authoritative source for feature count and phase
  // labels. Both the gap-safe iteration below and the phase back-fill rely on it.
  let authoritativeFeatures: any[] = [];
  let mergedEpic: any = null;
  try {
    const epicFeatures = await loadEpicFeatures(itemId);
    if (epicFeatures) authoritativeFeatures = epicFeatures.features;
  } catch (err: any) {
    logger.warn(`[BACKLOG MERGE] Could not parse epic_features: ${err.message}`);
  }

  // Iterate over every feature slot by authoritative count so a missing backlog_F* in the
  // middle (e.g. F2 not yet refined when F1 and F3 exist) doesn't silently drop everything
  // after the gap. Falls back to open-ended scan when epic_features is unavailable.
  const featureArtifacts: any[] = [];
  const totalFeatures = authoritativeFeatures.length > 0 ? authoritativeFeatures.length : Infinity;
  const missingSlots: number[] = [];

  for (let i = 1; i <= totalFeatures; i++) {
    const content = await loadLatestArtifactContent(itemId, `backlog_F${i}`);
    if (!content) {
      if (totalFeatures === Infinity) break; // open-ended scan — first gap means done
      missingSlots.push(i);
      logger.warn(`[BACKLOG MERGE] backlog_F${i} not found — feature ${i} will be absent from merged backlog`);
      continue;
    }
    try {
      const parsed = JSON.parse(stripJsonFence(content));
      if (!mergedEpic && parsed.epic) mergedEpic = parsed.epic;
      if (parsed.features && Array.isArray(parsed.features)) {
        featureArtifacts.push(...parsed.features);
      }
      logger.info(`[BACKLOG MERGE] Loaded backlog_F${i}: ${parsed.features?.length ?? 0} feature(s)`);
    } catch (err: any) {
      logger.error(`[BACKLOG MERGE] Failed to parse backlog_F${i}: ${err.message}`);
      missingSlots.push(i);
    }
  }

  if (missingSlots.length > 0) {
    insertEvent(workflowId, 'validation_warning', 'backlog_merge',
      `${missingSlots.length} feature artifact(s) missing from merge: F${missingSlots.join(', F')} — run story_decomposition for those features and re-merge`,
      { missing_features: missingSlots.map(i => `F${i}`) });
  }

  if (featureArtifacts.length === 0) {
    logger.warn(`[BACKLOG MERGE] No feature artifacts found to merge`);
    insertEvent(workflowId, 'error', 'backlog_merge', 'No feature artifacts found to merge');
    return;
  }

  // Back-fill any missing phase fields from epic_features (authoritative source).
  // The LLM sometimes drops the phase field from the backlog_F* output.
  featureArtifacts.forEach((f: any, i: number) => {
    if (!f.phase && authoritativeFeatures[i]?.phase) {
      f.phase = authoritativeFeatures[i].phase;
      logger.info(`[BACKLOG MERGE] Back-filled phase="${f.phase}" for feature ${i + 1} (was missing)`);
    }
  });

  // Drop any story already auto-resolved out at pushFeatureToADO time (see that function
  // and backlog-overlap.ts) so the merged backlog / epic QA generation matches what
  // actually reached ADO, without needing to mutate any already-approved artifact.
  const autoResolvedKeys = loadAutoResolvedStoryKeys(workflowId);
  featureArtifacts.forEach((f: any, i: number) => {
    const featureKey = f.key || `F${i + 1}`;
    f.stories = excludeAutoResolvedStories(featureKey, f.stories ?? [], autoResolvedKeys);
  });

  // Deterministic cross-feature scope-overlap check — backstop for whatever pushFeatureToADO
  // couldn't already resolve (same-wave races between concurrently-generated features, plus
  // anything below the auto-resolve confidence bar). Flags candidates for human review at
  // the checkpoint below; never blocks the merge itself. Only 'pending' rows are cleared
  // before re-scanning — auto_resolved history (and any human confirm/dismiss) survives.
  db.prepare(`DELETE FROM backlog_overlap_flags WHERE workflow_id = ? AND status = 'pending'`).run(workflowId);
  const overlaps = detectBacklogOverlaps(featureArtifacts);
  if (overlaps.length > 0) {
    recordOverlapFlags(overlaps.map(o => ({
      workflowId, itemId,
      featureKeyA: o.featureKeyA, storyIdA: o.storyIdA,
      featureKeyB: o.featureKeyB, storyIdB: o.storyIdB,
      score: o.score, matchedTerms: o.matchedTerms,
      status: 'pending' as const,
    })));
    logger.info(`[BACKLOG MERGE] Flagged ${overlaps.length} possible cross-feature overlap(s) for review`);
    insertEvent(workflowId, 'validation_warning', 'backlog_merge',
      `Detected ${overlaps.length} possible scope overlap${overlaps.length !== 1 ? 's' : ''} across features — review before approving`,
      { overlap_count: overlaps.length });
  }

  // Feature-boundary scope check backstop — same FR-ownership logic pushFeatureToADO already
  // ran per-feature, re-run here across the final merged set in case epic_features wasn't
  // available yet at push time, or ownership was edited afterward. authoritativeFeatures is
  // already loaded above and carries each feature's own prdRef.functionalRequirements.
  if (authoritativeFeatures.length > 0) {
    const frOwnership = buildFrOwnershipMap(authoritativeFeatures);
    const violations = featureArtifacts.flatMap((f: any, i: number) =>
      detectOutOfScopeFrReferences(f.key || `F${i + 1}`, f.stories ?? [], frOwnership)
    );
    if (violations.length > 0) {
      recordOverlapFlags(violations.map(v => ({
        workflowId, itemId,
        featureKeyA: v.owningFeatureKey, storyIdA: '',
        featureKeyB: v.featureKey, storyIdB: v.storyId,
        score: 1, matchedTerms: [v.frId],
        status: 'pending' as const,
        flagType: 'scope_violation' as const,
      })));
      logger.info(`[BACKLOG MERGE] Flagged ${violations.length} feature-boundary scope violation(s) for review`);
      insertEvent(workflowId, 'validation_warning', 'backlog_merge',
        `${violations.length} stor${violations.length !== 1 ? 'ies trace' : 'y traces'} to a sibling feature's FR — flagged for review`,
        { scope_violation_count: violations.length });
    }
  }

  // Build final merged backlog
  const mergedBacklog = {
    epic: mergedEpic ?? { title: 'Epic', business_value: '', definition_of_done: [], out_of_scope: [] },
    features: featureArtifacts,
  };

  // Save the merged backlog artifact
  const artifactContent = JSON.stringify(mergedBacklog, null, 2);
  const artifactId = await saveLocalArtifact(sessionId, 'backlog', artifactContent, itemId);

  logger.info(`[BACKLOG MERGE] Merged ${featureArtifacts.length} features into final backlog (artifact ${artifactId})`);
  insertEvent(workflowId, 'stage_completed', 'backlog_merge',
    `Merged ${featureArtifacts.length} features into final backlog — ready for ADO sync`,
    { artifact_id: artifactId, feature_count: featureArtifacts.length });

  // Create checkpoint for final backlog review (optional — or auto-advance)
  const { pauseAtCheckpoint } = await import('./workflow-router'); // dynamic: breaks the workflow-router → stage-runner cycle
  await pauseAtCheckpoint(workflowId, 'backlog_merge', artifactId, undefined, undefined, 'pm');
  logger.info(`[BACKLOG MERGE] Checkpoint created for final backlog review`);
}

/**
 * Run multi-agent collaborative refinement for one feature, save it in isolation,
 * and create a single checkpoint for backlog review. QA is generated at epic level
 * after all features are approved (see runEpicQaStage).
 * `featureIndex` is zero-based.
 */
export async function runMultiAgentFeatureStage(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number
): Promise<void> {

  try {
    const result = await runMultiAgentRefinement(workflowId, itemId, stage, featureIndex);

    // Bail out if the workflow was cancelled while this multi-agent session was in
    // flight. Without this check, a late-arriving result would create checkpoints
    // and call pauseAtCheckpoint() below, which overwrites the cancelled workflow's
    // status back to 'paused_at_checkpoint' — undoing the stop (see same guard in
    // workflow-stage-runner.ts).
    if (isCancelRequested(workflowId)) {
      logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} result discarded — workflow ${workflowId} was cancelled mid-flight`);
      return;
    }

    const strippedBacklog = stripJsonFence(result.backlog);
    // The synthesis call can hit its maxTokens ceiling on a dense feature, leaving the
    // tail of the JSON mid-string — repair before parsing instead of crashing the stage.
    let newFeature: any;
    const featureNum = featureIndex + 1;
    try {
      newFeature = JSON.parse(repairTruncatedJson(strippedBacklog));
    } catch (parseErr: any) {
      // Save the raw LLM output so the artifact is visible for inspection even though
      // the stage fails — without this the file is never written and there's nothing to debug.
      await saveLocalArtifact(sessionId, `backlog_F${featureNum}`, strippedBacklog, itemId);
      throw parseErr;
    }
    const featureArtifactType = `backlog_F${featureNum}`;
    const featureArtifactContent = JSON.stringify(newFeature, null, 2);
    const artifactId = await saveLocalArtifact(sessionId, featureArtifactType, featureArtifactContent, itemId);

    // Deterministic backlog validation — runs regardless of LLM tool use
    emitValidationWarnings(workflowId, stage,
      JSON.parse(validateBacklogJson({ json: JSON.stringify(newFeature) })),
      `[MULTI-AGENT] Backlog validation issues for Feature ${featureIndex + 1}`,
      (n) => `Backlog quality check flagged ${n} issue(s) for Feature ${featureIndex + 1} — review before approving`);

    // Same policy_overrides source runMultiAgentRefinement used internally to decide whether
    // to serve a demo fixture — re-derived here since it doesn't surface that decision back.
    const wfRow = db.prepare<[string], { policy_overrides: string | null }>(
      'SELECT policy_overrides FROM workflows WHERE id = ?'
    ).get(workflowId);
    const isDemo = isDemoWorkflow(wfRow?.policy_overrides ? JSON.parse(wfRow.policy_overrides) : {});

    await runFeatureCriticGate({
      workflowId, itemId, sessionId, stage, personaStage: 'story_decomposition',
      artifactId, artifactContent: featureArtifactContent, artifactType: `Feature ${featureNum} Stories`,
      isDemo,
      completionMessage: `Multi-agent collaborative refinement complete for Feature ${featureIndex + 1} — ready for human review`,
      runRevision: (priorDraft, brief) => runMultiAgentFeatureRevision(sessionId, workflowId, stage, itemId, featureIndex, priorDraft, brief),
    });
    logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement complete — checkpoint created`);
  } catch (err: any) {
    logger.error(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement failed: ${err.message}`);
    insertEvent(workflowId, 'error', stage, `Multi-agent refinement failed: ${err.message}`);
    throw err;
  }
}

// ── Targeted single-agent revisions ────────────────────────────────────────────
// Both story and QA revisions follow the identical pipeline — reload upstream
// artifacts, build a 3-message conversation thread (brief → prior draft → surgical
// directive), stream the edit with a heartbeat, then parse / clean / validate /
// save / diff / checkpoint. The only differences (which agent, which artifacts to
// reload, the directive wording, the deterministic cleanup, the validator, and the
// artifact/diff labels) are captured by a SurgicalRevisionSpec; runFeatureSurgicalRevision
// drives the shared flow. Keeps the two paths from drifting (e.g. one gaining a cancel
// guard or scope backstop the other lacks).

interface SurgicalRevisionContext {
  /** Resolved platform scope for the item. */
  platformScope: ProductAreaScope;
  featureNum: number;
  /** Anything loadContext stashed for postProcess (e.g. the current backlog for QA cross-checks). */
  extra: Record<string, any>;
}

interface SurgicalRevisionSpec {
  agentType: AgentType;
  /** Human-readable unit being revised, used in progress/heartbeat copy: 'stories' | 'QA tests'. */
  noun: string;
  /** Unit named in the completion event ('stories' | 'test cases'). */
  unitNoun: string;
  /** Stage to load the persona from (the QA flow uses the unsuffixed base stage). */
  personaStage(stage: string): string;
  /** STAGE_MAX_OUTPUT_TOKENS key + fallback ceiling. */
  tokenKey: string;
  fallbackTokens: number;
  /** Artifact type to save the revised JSON under (e.g. backlog_F2, qa_tests). */
  artifactType(featureNum: number): string;
  /** Title passed to computeRevisionDiff. */
  diffLabel(featureNum: number): string;
  /** Reload upstream artifacts and build the itemContext + anything postProcess needs. */
  loadContext(itemId: string, featureNum: number, platformScopeSection: string): Promise<{ itemContext?: string; extra: Record<string, any> }>;
  /** The surgical-edit directive appended as the final user turn. */
  buildDirective(featureNum: number, platformScopeSection: string): string;
  /** Deterministic post-parse cleanup (scope / story-ref filtering). Returns the cleaned object. */
  postProcess(revised: any, ctx: SurgicalRevisionContext): Promise<any>;
  /** Deterministic validation — returns the parsed validator result. */
  validate(jsonStr: string): { valid: boolean; issues?: string[] };
}

/**
 * Shared driver for the targeted story / QA revisions. See the block comment above
 * for the spec-vs-shared split.
 */
async function runFeatureSurgicalRevision(
  spec: SurgicalRevisionSpec,
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number,
  priorDraft: string,
  brief: string
): Promise<void> {
  const featureNum = featureIndex + 1;
  logger.info(`[MULTI-AGENT REVISION] Targeted ${spec.noun} revision for Feature ${featureNum} (stage: ${stage})`);

  insertEvent(workflowId, 'stage_progress', stage,
    `Revision mode: applying targeted changes to Feature ${featureNum} ${spec.noun} only…`);

  // Reload upstream artifacts fresh — a revision may be happening because the PRD,
  // architecture, or an upstream backlog was itself corrected since this feature was last
  // drafted. Without this, the surgical edit only sees the (possibly stale) prior draft and
  // generic feedback text, so a since-corrected claim never reaches the model and can resurface.
  const platformScope = resolveProductAreaScope(itemId);
  const platformScopeSection = buildPlatformScopeSection(platformScope);
  const { itemContext, extra } = await spec.loadContext(itemId, featureNum, platformScopeSection);

  const agent = new SpecialistAgent(spec.agentType);
  const personaStage = spec.personaStage(stage);
  const persona = await agent.loadPersona(personaStage);
  const systemPrompt = await agent.buildSystemPrompt(persona, undefined, itemContext, true, personaStage);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: brief },
    { role: 'assistant', content: '```json\n' + priorDraft + '\n```' },
    { role: 'user', content: spec.buildDirective(featureNum, platformScopeSection) },
  ];

  // Boosted beyond the initial synthesis ceiling (multi-agent-refinement.ts) — a revision
  // must reproduce the entire prior draft verbatim plus the edit, so it needs more headroom
  // than a fresh generation of the same document (see resolveMaxOutputTokens).
  const maxTokens = resolveMaxOutputTokens(STAGE_MAX_OUTPUT_TOKENS[spec.tokenKey] ?? spec.fallbackTokens, true);

  const fullResponse = await collectStreamWithHeartbeat(
    agent.streamResponse(systemPrompt, messages, resolveAgentModel(spec.agentType), undefined, maxTokens),
    (elapsedSec, chars) => insertEvent(workflowId, 'stage_progress', stage,
      progressHeartbeatLine(`Revising Feature ${featureNum} ${spec.noun}`, elapsedSec, chars)),
  );

  // Bail out if the workflow was cancelled while this revision was in flight —
  // see same guard in runMultiAgentFeatureStage above.
  if (isCancelRequested(workflowId)) {
    logger.info(`[MULTI-AGENT REVISION] Feature ${featureNum} ${spec.noun} result discarded — workflow ${workflowId} was cancelled mid-flight`);
    return;
  }

  const jsonContent = stripJsonFence(fullResponse);
  let revised: any;
  try {
    revised = JSON.parse(jsonContent);
  } catch (err: any) {
    logger.error(`[MULTI-AGENT REVISION] Invalid JSON from ${spec.noun} revision: ${err.message}`);
    throw new Error(`${spec.noun} revision produced invalid JSON: ${err.message}`);
  }

  // Deterministic cleanup (platform-scope / dangling story_ref backstops)
  revised = await spec.postProcess(revised, { platformScope, featureNum, extra });

  // Deterministic validation
  emitValidationWarnings(workflowId, stage,
    spec.validate(JSON.stringify(revised)),
    `[MULTI-AGENT REVISION] Validation issues for Feature ${featureNum}`,
    (n) => `Revised ${spec.noun} quality check flagged ${n} issue(s) for Feature ${featureNum}`);

  // Save revised artifact (isolated, not accumulated)
  const artifactContent = JSON.stringify(revised, null, 2);
  const artifactId = await saveLocalArtifact(sessionId, spec.artifactType(featureNum), artifactContent, itemId);

  const revisionSummary = await saveRevisionDiffAndSummary({
    itemId, sessionId, brief, priorDraft,
    revisedContent: artifactContent,
    artifactType: spec.artifactType(featureNum),
    diffLabel: spec.diffLabel(featureNum),
    logPrefix: `[MULTI-AGENT REVISION] ${spec.noun}`,
  });

  // Create checkpoint for human review
  const { pauseAtCheckpoint } = await import('./workflow-router'); // dynamic: breaks the workflow-router → stage-runner cycle
  pauseAtCheckpoint(workflowId, stage, artifactId, sessionId, {
    revision_mode: true, feature: featureNum,
    ...(revisionSummary ? { revision_summary: revisionSummary } : {}),
  });

  insertEvent(workflowId, 'stage_completed', stage,
    `Targeted revision applied for Feature ${featureNum} — only affected ${spec.unitNoun} modified. Ready for review.`,
    { artifact_id: artifactId });

  logger.info(`[MULTI-AGENT REVISION] Feature ${featureNum} ${spec.noun} targeted revision complete (artifact ${artifactId})`);
}

const STORY_REVISION_SPEC: SurgicalRevisionSpec = {
  agentType: 'story-decomposition' as AgentType,
  noun: 'stories',
  unitNoun: 'stories',
  personaStage: (stage) => stage,
  tokenKey: 'story_decomposition',
  fallbackTokens: 16_000,
  artifactType: (featureNum) => `backlog_F${featureNum}`,
  diffLabel: (featureNum) => `Feature ${featureNum} Backlog`,

  async loadContext(itemId, featureNum, platformScopeSection) {
    // This feature's own platform declaration (if the planner scoped it to specific
    // platforms, e.g. a sibling feature owns the other UI platform) — same lookup the
    // initial synthesis uses, so a revision can't drift from that scope.
    const [prdContent, archContent, epicFeaturesLoaded] = await Promise.all([
      loadLatestArtifactContent(itemId, 'prd'),
      loadLatestArtifactContent(itemId, 'architecture'),
      loadEpicFeatures(itemId).catch((err: any) => {
        logger.warn(`[MULTI-AGENT REVISION] Failed to resolve Feature ${featureNum} platform scope: ${err.message}`);
        return null;
      }),
    ]);

    let featurePlatforms: string[] | undefined;
    const revisionTargetFeature = epicFeaturesLoaded?.features[featureNum - 1];
    if (Array.isArray(revisionTargetFeature?.platforms)) featurePlatforms = revisionTargetFeature.platforms;
    const featurePlatformScopeSection = buildFeaturePlatformScopeSection(featurePlatforms);

    const contextParts: string[] = [];
    if (prdContent) contextParts.push(`**Current PRD (use as the source of truth — supersedes anything implied by the prior draft below):**\n\n${prdContent}`);
    if (archContent) contextParts.push(`**Current Architecture Document:**\n\n${archContent}`);
    if (platformScopeSection) contextParts.push(platformScopeSection);
    if (featurePlatformScopeSection) contextParts.push(featurePlatformScopeSection);
    return { itemContext: contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : undefined, extra: { featurePlatforms } };
  },

  buildDirective(featureNum, platformScopeSection) {
    return (
      `You are performing a SURGICAL EDIT of Feature ${featureNum} stories above. Apply ONLY the targeted changes described in the revision brief at the top of this conversation.\n\n` +
      `Rules — apply strictly:\n` +
      `- Modify ONLY the stories for Feature ${featureNum} (story IDs F${featureNum}.S*) that are explicitly mentioned in the feedback.\n` +
      `- Copy all other stories for Feature ${featureNum} EXACTLY as-is.\n` +
      `- Do NOT add new stories unless the feedback explicitly requests it.\n` +
      `- Do NOT restructure, reorder, rename, or rewrite any field not mentioned in the feedback.\n` +
      `- Preserve the exact JSON schema: every story must have story_id, title, as_a, i_want, so_that, acceptance_criteria, technical_acceptance_criteria, platform, depends_on.\n` +
      `- Return the complete Feature ${featureNum} JSON (epic + this one feature + all its stories) — only the flagged stories will differ from the prior draft.${platformScopeSection ? '\n- Stay within the Platform Scope above — drop any existing story that falls outside it even if the feedback didn\'t mention it.' : ''}\n\n` +
      `${ACCEPTANCE_CRITERIA_FORMAT_RULE}`
    );
  },

  async postProcess(revised, { platformScope, extra }) {
    // Enforce platform scope on the revision too — guards against a model carrying an
    // out-of-scope story forward from the prior draft when the feedback didn't mention it.
    // Checks both the initiative-wide scope and this feature's own narrower declaration.
    const { backlog: itemScoped } = filterBacklogStoriesByScope(JSON.stringify(revised), platformScope);
    const { backlog } = filterBacklogStoriesByFeaturePlatforms(itemScoped, extra.featurePlatforms);
    return JSON.parse(backlog);
  },

  validate(jsonStr) {
    return JSON.parse(validateBacklogJson({ json: jsonStr }));
  },
};

const QA_REVISION_SPEC: SurgicalRevisionSpec = {
  agentType: 'qa-engineer' as AgentType,
  noun: 'QA tests',
  unitNoun: 'test cases',
  // Vera resolves her persona from the unsuffixed feature stage during the original
  // synthesis (synthesizeQaArtifact in multi-agent-refinement.ts) — match that here so
  // a QA revision loads the exact same persona the initial generation used.
  personaStage: (stage) => stage.replace(/_qa$/, ''),
  tokenKey: 'qa_engineer',
  fallbackTokens: 14_000,
  artifactType: () => 'qa_tests',
  diffLabel: (featureNum) => `Feature ${featureNum} QA Tests`,

  async loadContext(itemId, featureNum, platformScopeSection) {
    // Reload fresh — a since-corrected PRD, or a backlog revision that dropped/changed
    // stories, must reach this revision or stale claims and dangling story references persist.
    const [prdContent, currentBacklogContent] = await Promise.all([
      loadLatestArtifactContent(itemId, 'prd'),
      loadLatestArtifactContent(itemId, `backlog_F${featureNum}`),
    ]);
    const contextParts: string[] = [];
    if (prdContent) contextParts.push(`**Current PRD (use as the source of truth):**\n\n${prdContent}`);
    if (currentBacklogContent) contextParts.push(`**Current Feature ${featureNum} Stories (test against these — not the prior draft's assumptions):**\n\n${currentBacklogContent}`);
    if (platformScopeSection) contextParts.push(platformScopeSection);
    return { itemContext: contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : undefined, extra: { currentBacklogContent } };
  },

  buildDirective(featureNum) {
    return (
      `You are performing a SURGICAL EDIT of the Feature ${featureNum} QA test suite above. Apply ONLY the targeted changes described in the revision brief at the top of this conversation.\n\n` +
      `Rules — apply strictly:\n` +
      `- Modify ONLY the test cases (TC-F${featureNum}-*) explicitly mentioned in the feedback.\n` +
      `- Copy all other test cases for Feature ${featureNum} EXACTLY as-is.\n` +
      `- Do NOT add new test cases unless the feedback explicitly requests it.\n` +
      `- Do NOT restructure, reorder, rename, or rewrite any field not mentioned in the feedback.\n` +
      `- Preserve the exact JSON schema for every test case.\n` +
      `- Drop any test case whose story_ref no longer exists in the Current Feature ${featureNum} Stories above, even if the feedback didn't mention it.\n` +
      `- Return the complete Feature ${featureNum} QA test suite JSON — only the flagged test cases will differ from the prior draft.`
    );
  },

  async postProcess(revised, { featureNum, extra }) {
    // Drop any test case referencing a story that no longer exists in the current backlog
    // (e.g. dropped by a platform-scope or prior backlog revision) — backstop for the
    // "drop stale story_ref" instruction in case the model didn't comply.
    const currentBacklogContent: string | null = extra.currentBacklogContent ?? null;
    if (!currentBacklogContent) return revised;
    try {
      const backlogJson = JSON.parse(stripJsonFence(currentBacklogContent));
      const validStoryIds = new Set<string>();
      for (const feature of backlogJson.features ?? []) {
        for (const story of feature.stories ?? []) {
          if (story?.story_id) validStoryIds.add(story.story_id);
        }
      }
      const { qaTests, dropped } = filterQaTestCasesByStoryIds(JSON.stringify(revised), validStoryIds, `F${featureNum}`);
      if (dropped > 0) {
        logger.warn(`[MULTI-AGENT REVISION] Feature ${featureNum} QA revision — stripped ${dropped} test case(s) referencing stories that no longer exist`);
        return JSON.parse(qaTests);
      }
    } catch (err: any) {
      logger.warn(`[MULTI-AGENT REVISION] Could not cross-check QA revision against current backlog: ${err.message}`);
    }
    return revised;
  },

  validate(jsonStr) {
    return JSON.parse(validateQaTestsJson({ json: jsonStr }));
  },
};

// ── Epic-level QA stage ────────────────────────────────────────────────────────
// Runs once after backlog_merge. Reads all approved feature backlogs together
// and has Vera produce a single unified test suite for the full epic — no
// per-feature duplication, proper cross-feature integration coverage.

/**
 * Load the artifacts shared by epic QA generation and revision: merged backlog, PRD,
 * and (optionally) the epic_features plan. The API contract is only loaded when the
 * api_spec stage is actually enabled for this workflow (a stray artifact from before
 * it was disabled must not resurrect technical coverage), and only counts when it
 * produced content — an empty/whitespace artifact means no endpoints.
 */
async function loadEpicQaInputs(
  workflowId: string,
  itemId: string,
  opts: { includeEpicFeatures?: boolean } = {}
): Promise<{
  mergedBacklogContent: string | null;
  prdContent: string | null;
  epicFeaturesContent: string | null;
  apiSpecContent: string | null;
}> {
  const wfRow = db.prepare<[string], { stage_sequence: string }>(
    'SELECT stage_sequence FROM workflows WHERE id = ?'
  ).get(workflowId);
  const apiSpecStageEnabled = wfRow ? (JSON.parse(wfRow.stage_sequence) as string[]).includes('api_spec') : false;

  const [mergedBacklogContent, prdContent, epicFeaturesContent, rawApiSpecContent] = await Promise.all([
    loadLatestArtifactContent(itemId, 'backlog'),
    loadLatestArtifactContent(itemId, 'prd'),
    opts.includeEpicFeatures ? loadLatestArtifactContent(itemId, 'epic_features') : Promise.resolve(null),
    apiSpecStageEnabled ? loadLatestArtifactContent(itemId, 'api_spec') : Promise.resolve(null),
  ]);

  return { mergedBacklogContent, prdContent, epicFeaturesContent, apiSpecContent: rawApiSpecContent?.trim() || null };
}

/** Vera configured for the epic QA stage — her persona is registered under the 'story_decomposition' stage tag.
 *  isRevision boosts the token ceiling (see resolveMaxOutputTokens) since a revision call must
 *  reproduce the entire prior test suite verbatim plus the edit. */
async function buildEpicQaAgent(itemContext?: string, isRevision = false) {
  const vera = new SpecialistAgent('qa-engineer');
  const persona = await vera.loadPersona('story_decomposition');
  const systemPrompt = await vera.buildSystemPrompt(persona, undefined, itemContext, true, 'story_decomposition');
  const maxTokens = resolveMaxOutputTokens(STAGE_MAX_OUTPUT_TOKENS['epic_qa'] ?? 28_000, isRevision);
  return { vera, systemPrompt, maxTokens };
}

/** Best-effort test_cases count from a QA suite JSON string — undefined when unparseable. */
function countTestCases(json: string): number | undefined {
  try { return JSON.parse(json).test_cases?.length; } catch { return undefined; }
}

function buildEpicQaPrompt(
  mergedBacklog: string,
  prdContent: string | null,
  epicFeaturesContent: string | null,
  apiSpecContent: string | null,
): string {
  const contextParts: string[] = [];
  if (prdContent) contextParts.push(`**PRD (source of functional requirements):**\n${prdContent}`);
  if (epicFeaturesContent) contextParts.push(`**Epic & Features Plan:**\n${epicFeaturesContent}`);
  contextParts.push(`**Merged Backlog (all approved features and stories):**\n${mergedBacklog}`);
  if (apiSpecContent) contextParts.push(`**API Contract (OpenAPI 3.0 — source of endpoints for technical test coverage):**\n${apiSpecContent}`);

  return `${contextParts.join('\n\n---\n\n')}

---

**Your Task — Produce a Comprehensive Epic QA Test Suite:**

All features for this epic have been approved. Using the merged backlog above, write a single unified QA test suite covering the full epic. The suite has two layers:

- **User-facing layer** (\`"layer": "user_facing"\`) — end-to-end scenarios exercised through the UI, from the user's perspective.
${apiSpecContent
  ? '- **Technical layer** (`"layer": "technical"`) — direct coverage of the endpoints in the API Contract above: request validation, auth/permission checks, status codes, and response shape. These are contract checks, not UI flows.'
  : '- **Technical layer** — skip this layer. No API Contract was provided for this epic, so there are no endpoints to trace technical test cases to.'}

Focus areas for the user-facing layer (in priority order):
1. **Happy path flows** — the primary user journeys each feature enables
2. **Cross-feature integration scenarios** — behaviour that requires two or more features working together (e.g. Feature A creates data that Feature B displays). These are the highest-risk gaps and deserve explicit coverage.
3. **Negative/error paths** — the most important failure modes (validation errors, permission failures, boundary violations)
4. **Edge cases** — unusual states the stories explicitly define or imply
${apiSpecContent ? `
Focus areas for the technical layer (in priority order):
1. **Happy path per endpoint** — one case per endpoint verifying the success response matches its schema
2. **Auth/permission failures** — 401/403 cases for endpoints that require authentication or specific roles
3. **Validation failures** — 400 cases for the most important required-field or format violations
4. **Not-found / conflict paths** — 404/409 cases where the endpoint's behaviour depends on referenced resource state` : ''}

\`\`\`json
{
  "suite": "<Epic title> — QA Test Suite",
  "version": "1.0",
  "metadata": {
    "source_stage": "epic_qa",
    "feature_count": 0,
    "notes": "<brief summary of coverage strategy and top risk areas>"
  },
  "test_cases": [
    {
      "id": "TC-UI-001",
      "title": "<what is being verified>",
      "description": "<why this scenario matters>",
      "type": "happy_path | negative | edge | boundary | security | performance",
      "priority": "critical | high | medium | low",
      "category": "<test category, e.g. End-to-End Flow, Cross-Feature, Error Handling>",
      "layer": "user_facing",
      "features": ["F1", "F2"],
      "story_ref": "F1.S3",
      "prd_ref": ["FR-01"],
      "scenario": {
        "given": ["<precondition>"],
        "when": ["<action>"],
        "then": ["<expected outcome>"]
      },
      "preconditions": ["<required system state>"],
      "tags": ["@smoke", "@regression"]
    }${apiSpecContent ? `,
    {
      "id": "TC-API-001",
      "title": "<what is being verified>",
      "description": "<why this contract check matters>",
      "type": "happy_path | negative | edge | boundary | security | performance",
      "priority": "critical | high | medium | low",
      "category": "API Contract",
      "layer": "technical",
      "endpoint": { "method": "POST", "path": "/tasks" },
      "features": ["F1"],
      "story_ref": "F1.S3",
      "prd_ref": ["FR-01"],
      "scenario": {
        "given": ["<precondition, e.g. authenticated as role X>"],
        "when": ["<request made, e.g. POST /tasks with missing title>"],
        "then": ["<expected status code and response shape>"]
      },
      "preconditions": ["<required system state>"],
      "tags": ["@smoke", "@regression"]
    }` : ''}
  ]
}
\`\`\`

Requirements:
- **Scope — user-facing layer covers user-facing stories only.** Write user-facing test cases for stories tagged platform: web, ios, android. Backend-only stories have no dedicated user-facing test case unless there is a directly observable user outcome (e.g. a notification email). Frame every user-facing test from the user's perspective, never as an API/contract check.
- **No accessibility scope.** Do not write test cases for WCAG compliance, color contrast, screen reader announcements, keyboard-only navigation, or other accessibility concerns unless the PRD or backlog explicitly requires them — out of scope for this product by default.
- **No duplication.** Each scenario appears once. If two features share a user flow, write one integrated test case, not two.
- **iOS + Android = one "mobile" test case.** When a functional scenario has both an iOS story and an Android story (same flow, split into per-platform tickets only because story authoring requires one platform per story), write ONE test case covering both — reference both story_ids in \`story_ref\` as an array (e.g. \`["F1.S9", "F1.S10"]\`) and phrase the title/scenario as the shared "mobile" flow, not "iOS: ..." or "Android: ...". Only split them into separate test cases when the flows genuinely diverge per platform (e.g. a platform-specific permission prompt, gesture, or store policy) — if you do, say so explicitly in the description. Web always gets its own separate test case since its flow is never identical to mobile's.
- **Conservative count — quality over quantity.** Target 1 user-facing test case per functional requirement, maximum 2 where the FR has a single critical failure mode worth calling out separately. The absolute cap is 3 test cases per FR. Do not pad.
  - Every feature with user-facing stories must have at least one @smoke happy-path case.
  - At least 25% of user-facing cases must be negative or edge type.
  - Cross-feature integration scenarios should be called out with two or more entries in the \`features\` array.
- **ID format:** TC-UI-NNN for user-facing cases (three-digit counter, UI = user-facing/UI layer)${apiSpecContent ? '; TC-API-NNN for technical cases (three-digit counter, API = technical/contract layer).' : '.'}
- **story_ref:** a real story_id from the merged backlog (e.g. "F1.S3"). When a scenario legitimately spans multiple stories (an end-to-end flow, the iOS+Android combined case above), \`story_ref\` MUST be a JSON array of the individual story_ids (e.g. \`["F1.S3", "F1.S4", "F1.S5"]\`) — never concatenate multiple story_ids into one string (e.g. \`"F1.S3F1.S4F1.S5"\` is WRONG). Never invent a placeholder.
- **features:** list the feature keys this test exercises (["F1"], ["F2", "F3"], etc.).
- **prd_ref:** list the FR IDs from the referenced story's prd_ref.
- **layer:** exactly one of: user_facing, technical.
- **type:** exactly one of: happy_path, negative, edge, boundary, security, performance.
- **tags:** non-empty array using only: @smoke, @regression, @negative, @edge, @security, @performance.
${apiSpecContent ? `- **Technical layer coverage:** every endpoint in the API Contract gets exactly one happy-path technical case, plus its most important failure case(s) — do not write more than 3 technical cases per endpoint. Each technical case's \`endpoint\` field must reference a real \`method\`+\`path\` pair from the API Contract above. Never invent an endpoint that isn't in the contract.` : ''}
- Include ONLY the JSON artifact in your response (no prose before or after).`;
}

/**
 * Generate a single comprehensive QA test suite for the full epic, run once after
 * backlog_merge when all feature backlogs are approved. Replaces per-feature
 * qa_tests artifacts with one holistic suite that covers cross-feature flows.
 */
export async function runEpicQaStage(
  sessionId: string,
  workflowId: string,
  itemId: string,
): Promise<void> {
  logger.info('[EPIC QA] Starting epic-level QA test suite generation');

  // ── Demo mode ──────────────────────────────────────────────────────────────
  const wfRow = db.prepare<[string], { policy_overrides: string | null }>(
    'SELECT policy_overrides FROM workflows WHERE id = ?'
  ).get(workflowId);
  const policyOverrides: Record<string, string> = wfRow?.policy_overrides
    ? JSON.parse(wfRow.policy_overrides) : {};

  if (isDemoWorkflow(policyOverrides)) {
    const stub = JSON.stringify({ suite: 'Epic QA Test Suite (Demo)', version: '1.0', metadata: { source_stage: 'epic_qa', notes: 'Demo mode' }, test_cases: [] }, null, 2);
    const demoArtifactId = await saveLocalArtifact(sessionId, 'qa_tests', stub, itemId);
    const { pauseAtCheckpoint } = await import('./workflow-router'); // dynamic: breaks the workflow-router → stage-runner cycle
    await pauseAtCheckpoint(workflowId, 'epic_qa', demoArtifactId, undefined, undefined);
    insertEvent(workflowId, 'stage_completed', 'epic_qa', 'Epic QA test suite ready for review (demo mode)', { artifact_id: demoArtifactId });
    return;
  }

  // ── Load context ───────────────────────────────────────────────────────────
  insertEvent(workflowId, 'stage_progress', 'epic_qa', 'Loading merged backlog and PRD for QA synthesis...');

  const { mergedBacklogContent, prdContent, epicFeaturesContent, apiSpecContent } =
    await loadEpicQaInputs(workflowId, itemId, { includeEpicFeatures: true });

  if (!mergedBacklogContent) {
    insertEvent(workflowId, 'error', 'epic_qa', 'No merged backlog found — ensure backlog_merge completed successfully');
    logger.error('[EPIC QA] No merged backlog artifact found');
    return;
  }

  let featureCount = 0;
  let storyCount = 0;
  try {
    const backlogJson = JSON.parse(stripJsonFence(mergedBacklogContent));
    featureCount = backlogJson.features?.length ?? 0;
    storyCount = (backlogJson.features ?? []).reduce((n: number, f: any) => n + (f.stories?.length ?? 0), 0);
  } catch { /* best-effort — used only for the progress event */ }

  insertEvent(workflowId, 'stage_progress', 'epic_qa',
    `Synthesising QA test suite across ${featureCount} feature(s), ${storyCount} stories...`);

  // ── Synthesise ─────────────────────────────────────────────────────────────
  const synthesisPrompt = buildEpicQaPrompt(mergedBacklogContent, prdContent, epicFeaturesContent, apiSpecContent);

  const { vera, systemPrompt, maxTokens } = await buildEpicQaAgent();

  const rawOutput = await collectStreamWithHeartbeat(
    vera.streamResponse(systemPrompt, [{ role: 'user', content: synthesisPrompt }], resolveAgentModel('qa-engineer'), undefined, maxTokens),
    (elapsedSec, chars) => insertEvent(workflowId, 'stage_progress', 'epic_qa',
      progressHeartbeatLine('Synthesising epic QA test suite', elapsedSec, chars)),
  );

  if (isCancelRequested(workflowId)) {
    logger.info('[EPIC QA] Result discarded — workflow was cancelled mid-flight');
    return;
  }

  const stripped = stripJsonFence(rawOutput.trim());
  const artifactId = await saveLocalArtifact(sessionId, 'qa_tests', stripped, itemId);

  emitValidationWarnings(workflowId, 'epic_qa',
    JSON.parse(validateQaTestsJson({ json: stripped })),
    '[EPIC QA] QA test suite validation issues',
    (n) => `Epic QA suite quality check flagged ${n} issue(s) — review before approving`);

  const testCaseCount = countTestCases(stripped);

  await runFeatureCriticGate({
    workflowId, itemId, sessionId, stage: 'epic_qa', personaStage: 'epic_qa',
    artifactId, artifactContent: stripped, artifactType: 'Epic QA Test Suite',
    isDemo: false, // the demo branch above already returned before reaching this point
    completionMessage: testCaseCount !== undefined
      ? `Epic QA test suite ready — ${testCaseCount} test case(s) across ${featureCount} features`
      : 'Epic QA test suite ready for review',
    runRevision: (priorDraft, brief) => runEpicQaRevision(sessionId, workflowId, itemId, priorDraft, brief),
  });

  logger.info(`[EPIC QA] Generated ${testCaseCount ?? '?'} test cases across ${featureCount} features`);
}

/**
 * Targeted revision of the epic-level QA test suite after a human reviewer
 * requests changes. Vera applies only the flagged edits; all other test cases
 * are copied as-is.
 */
export async function runEpicQaRevision(
  sessionId: string,
  workflowId: string,
  itemId: string,
  priorDraft: string,
  brief: string,
): Promise<void> {
  logger.info('[EPIC QA] Starting targeted revision of epic QA test suite');

  const { mergedBacklogContent, prdContent, apiSpecContent } = await loadEpicQaInputs(workflowId, itemId);

  const contextParts: string[] = [];
  if (prdContent) contextParts.push(`**Current PRD (source of truth):**\n${prdContent}`);
  if (mergedBacklogContent) contextParts.push(`**Current Merged Backlog (stories to test):**\n${mergedBacklogContent}`);
  if (apiSpecContent) contextParts.push(`**Current API Contract (source of endpoints for technical cases):**\n${apiSpecContent}`);
  const itemContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : undefined;

  const directive =
    'You are performing a SURGICAL EDIT of the Epic QA test suite above. Apply ONLY the targeted changes described in the revision brief at the top of this conversation.\n\n' +
    'Rules — apply strictly:\n' +
    '- Modify ONLY the test cases (TC-UI-* or TC-API-*) explicitly mentioned in the feedback.\n' +
    '- Copy all other test cases EXACTLY as-is.\n' +
    '- Do NOT add new test cases unless the feedback explicitly requests it.\n' +
    '- Do NOT restructure, reorder, or rewrite any field not mentioned in the feedback.\n' +
    '- Preserve the exact JSON schema for every test case.\n' +
    '- Drop any test case whose story_ref no longer exists in the current merged backlog.\n' +
    '- Return the complete epic QA test suite JSON — only the flagged test cases will differ.';

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: brief },
    { role: 'assistant', content: '```json\n' + priorDraft + '\n```' },
    { role: 'user', content: directive },
  ];

  const { vera, systemPrompt, maxTokens } = await buildEpicQaAgent(itemContext, true);

  const rawOutput = await collectStreamWithHeartbeat(
    vera.streamResponse(systemPrompt, messages, resolveAgentModel('qa-engineer'), undefined, maxTokens),
    (elapsedSec, chars) => insertEvent(workflowId, 'stage_progress', 'epic_qa',
      progressHeartbeatLine('Revising epic QA test suite', elapsedSec, chars)),
  );

  if (isCancelRequested(workflowId)) {
    logger.info('[EPIC QA] Revision result discarded — workflow was cancelled mid-flight');
    return;
  }

  const stripped = stripJsonFence(rawOutput.trim());
  const artifactId = await saveLocalArtifact(sessionId, 'qa_tests', stripped, itemId);

  emitValidationWarnings(workflowId, 'epic_qa',
    JSON.parse(validateQaTestsJson({ json: stripped })),
    '[EPIC QA] QA revision validation issues',
    (n) => `Epic QA suite revision flagged ${n} issue(s)`);

  const revisionSummary = await saveRevisionDiffAndSummary({
    itemId, sessionId, brief, priorDraft,
    revisedContent: stripped,
    artifactType: 'qa_tests',
    diffLabel: 'Epic QA Tests',
    logPrefix: '[EPIC QA]',
  });

  const { pauseAtCheckpoint } = await import('./workflow-router'); // dynamic: breaks the workflow-router → stage-runner cycle
  pauseAtCheckpoint(workflowId, 'epic_qa', artifactId, sessionId, {
    revision_mode: true,
    ...(revisionSummary ? { revision_summary: revisionSummary } : {}),
  });

  const testCaseCount = countTestCases(stripped);

  insertEvent(workflowId, 'stage_completed', 'epic_qa',
    testCaseCount !== undefined
      ? `Epic QA test suite revised — ${testCaseCount} test case(s) ready for review`
      : 'Epic QA test suite revised — ready for review',
    { artifact_id: artifactId });

  logger.info(`[EPIC QA] Revision complete — ${testCaseCount ?? '?'} test cases`);
}

/**
 * Targeted single-agent revision for story_decomposition_F* stages.
 *
 * Called when a human reviewer (or the critic) requests changes after the multi-agent
 * pipeline has already completed. Instead of re-running the full 3-phase pipeline,
 * Shard (Product Owner) applies a SURGICAL EDIT — only the stories mentioned in the
 * revision brief are modified; all other features are copied exactly as-is.
 */
export function runMultiAgentFeatureRevision(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number,
  priorDraft: string,
  brief: string
): Promise<void> {
  return runFeatureSurgicalRevision(STORY_REVISION_SPEC, sessionId, workflowId, stage, itemId, featureIndex, priorDraft, brief);
}

/**
 * Targeted single-agent revision for story_decomposition_F*_qa checkpoints.
 *
 * Mirrors runMultiAgentFeatureRevision above, but edits the QA test suite instead of
 * the stories — Vera (QA Engineer) applies a SURGICAL EDIT to only the test cases
 * flagged in the revision brief; every other test case for this feature is copied as-is.
 */
export function runMultiAgentFeatureQaRevision(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number,
  priorDraft: string,
  brief: string
): Promise<void> {
  return runFeatureSurgicalRevision(QA_REVISION_SPEC, sessionId, workflowId, stage, itemId, featureIndex, priorDraft, brief);
}
