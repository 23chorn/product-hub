/**
 * feature-stage-runner — handles the story_decomposition_F* stages, which run a
 * multi-agent collaborative refinement session per feature instead of the normal
 * single-specialist flow. Split out of runAutonomousStage, which dispatches here
 * when the stage name matches story_decomposition_F<n>.
 *
 * Exports three functions:
 *   runBacklogMerge — merge all isolated feature artifacts into final backlog
 *   runMultiAgentFeatureStage  — full 3-phase pipeline for initial runs
 *   runMultiAgentFeatureRevision — surgical single-agent edit for human/critic revisions
 */
import type { AgentType } from '@pap/shared';
import { logger, insertEvent } from './workflow-db';
import { validateBacklogJson, validateQaTestsJson } from './tool-validators';
import { isCancelRequested } from './workflow-cancel';
import { progressHeartbeatLine } from './stage-metadata';

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
  const { loadLatestArtifactContent, saveLocalArtifact } = await import('./artifact-helpers');

  insertEvent(workflowId, 'stage_progress', 'backlog_merge',
    'Merging all feature artifacts into final backlog...');

  // Load all feature artifacts (backlog_F1, backlog_F2, ...)
  const featureArtifacts: any[] = [];
  let featureIndex = 1;
  let mergedEpic: any = null;

  while (true) {
    const artifactType = `backlog_F${featureIndex}`;
    const content = await loadLatestArtifactContent(itemId, artifactType);
    if (!content) break; // No more features

    try {
      const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const parsed = JSON.parse(cleaned);

      // Store epic from first feature (they should all be identical)
      if (!mergedEpic && parsed.epic) {
        mergedEpic = parsed.epic;
      }

      // Collect features array
      if (parsed.features && Array.isArray(parsed.features)) {
        featureArtifacts.push(...parsed.features);
      }

      logger.info(`[BACKLOG MERGE] Loaded Feature ${featureIndex}: ${parsed.features?.length ?? 0} features`);
      featureIndex++;
    } catch (err: any) {
      logger.error(`[BACKLOG MERGE] Failed to parse ${artifactType}: ${err.message}`);
      break;
    }
  }

  if (featureArtifacts.length === 0) {
    logger.warn(`[BACKLOG MERGE] No feature artifacts found to merge`);
    insertEvent(workflowId, 'error', 'backlog_merge', 'No feature artifacts found to merge');
    return;
  }

  // Build final merged backlog
  const mergedBacklog = {
    epic: mergedEpic ?? { title: 'Epic', business_value: '', definition_of_done: [], out_of_scope: [] },
    features: featureArtifacts,
  };

  // Save the merged backlog artifact
  const artifactContent = JSON.stringify(mergedBacklog, null, 2);
  const artifactId = await saveLocalArtifact(sessionId, 'backlog', artifactContent, itemId, null);

  logger.info(`[BACKLOG MERGE] Merged ${featureArtifacts.length} features into final backlog (artifact ${artifactId})`);
  insertEvent(workflowId, 'stage_completed', 'backlog_merge',
    `Merged ${featureArtifacts.length} features into final backlog — ready for ADO sync`,
    { artifact_id: artifactId, feature_count: featureArtifacts.length });

  // Create checkpoint for final backlog review (optional — or auto-advance)
  const { pauseAtCheckpoint } = await import('./workflow-router');
  await pauseAtCheckpoint(workflowId, 'backlog_merge', artifactId, undefined, undefined, 'pm');
  logger.info(`[BACKLOG MERGE] Checkpoint created for final backlog review`);
}

/**
 * Run multi-agent collaborative refinement for one feature, save it in isolation,
 * and create TWO pending checkpoints for PM + QA review.
 * `featureIndex` is zero-based.
 */
export async function runMultiAgentFeatureStage(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number
): Promise<void> {
  const { runMultiAgentRefinement } = await import('./multi-agent-refinement');

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

    const strippedBacklog = result.backlog.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const newFeature = JSON.parse(strippedBacklog);

    // Save this feature in isolation (not accumulated).
    // Each feature stage gets its own artifact: backlog_F1, backlog_F2, backlog_F3
    // This prevents exponential token growth — F9 doesn't need to re-output F1-F8!
    const { saveLocalArtifact } = await import('./artifact-helpers');
    const featureNum = featureIndex + 1;
    const featureArtifactType = `backlog_F${featureNum}`;
    const featureArtifactContent = JSON.stringify(newFeature, null, 2);
    const artifactId = await saveLocalArtifact(sessionId, featureArtifactType, featureArtifactContent, itemId, null);

    // Deterministic backlog validation — runs regardless of LLM tool use
    const backlogValidation = JSON.parse(validateBacklogJson({ json: JSON.stringify(newFeature) }));
    if (!backlogValidation.valid && Array.isArray(backlogValidation.issues) && backlogValidation.issues.length > 0) {
      logger.warn(`[MULTI-AGENT] Backlog validation issues for Feature ${featureIndex + 1}: ${backlogValidation.issues.join(' | ')}`);
      insertEvent(workflowId, 'validation_warning', stage,
        `Backlog quality check flagged ${backlogValidation.issues.length} issue(s) for Feature ${featureIndex + 1} — review before approving`,
        { issues: backlogValidation.issues }
      );
    }

    // Save the standalone QA test suite for this feature as a separate artifact.
    // Type 'qa_tests' lets the QA engineer stage or external tooling load it directly.
    let qaArtifactId: number | null = null;
    let qaTestCaseCount: number | undefined;
    if (result.qaTests) {
      const strippedQa = result.qaTests.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      qaArtifactId = await saveLocalArtifact(sessionId, 'qa_tests', strippedQa, itemId, null);
      logger.info(`[MULTI-AGENT] QA test suite artifact saved for Feature ${featureIndex + 1}`);
      try { qaTestCaseCount = JSON.parse(strippedQa).test_cases?.length; } catch { /* best-effort, used for event copy only */ }

      // Deterministic QA suite validation — tagged to the QA sub-stage (not the base
      // story stage) so it shows up in the QA section of the event log.
      const qaValidation = JSON.parse(validateQaTestsJson({ json: strippedQa }));
      if (!qaValidation.valid && Array.isArray(qaValidation.issues) && qaValidation.issues.length > 0) {
        logger.warn(`[MULTI-AGENT] QA test suite validation issues for Feature ${featureIndex + 1}: ${qaValidation.issues.join(' | ')}`);
        insertEvent(workflowId, 'validation_warning', `${stage}_qa`,
          `QA test suite quality check flagged ${qaValidation.issues.length} issue(s) for Feature ${featureIndex + 1}`,
          { issues: qaValidation.issues }
        );
      }
    }

    // Create TWO checkpoints for two-stage approval. Roles come from the stage_roles
    // table (normalized to the base "story_decomposition" / "story_decomposition_qa"
    // stage — see normalizeStageForRoles), so they're configurable per-deployment and
    // apply uniformly regardless of how many features this initiative has.
    const { pauseAtCheckpoint } = await import('./workflow-router');

    // Checkpoint 1: Backlog review
    await pauseAtCheckpoint(workflowId, stage, artifactId, undefined, undefined);
    logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} backlog checkpoint created`);

    // Checkpoint 2: QA test suite review
    if (qaArtifactId) {
      await pauseAtCheckpoint(workflowId, `${stage}_qa`, qaArtifactId, undefined, undefined);
      logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} QA test suite checkpoint created`);

      insertEvent(workflowId, 'stage_completed', `${stage}_qa`,
        qaTestCaseCount !== undefined
          ? `QA test suite ready for review — ${qaTestCaseCount} test case(s) for Feature ${featureIndex + 1}`
          : `QA test suite ready for review for Feature ${featureIndex + 1}`,
        { artifact_id: qaArtifactId });
    }

    logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement complete — dual checkpoints created`);

    insertEvent(workflowId, 'stage_completed', stage,
      `Multi-agent collaborative refinement complete for Feature ${featureIndex + 1} — ready for human review`,
      { artifact_id: artifactId });
  } catch (err: any) {
    logger.error(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement failed: ${err.message}`);
    insertEvent(workflowId, 'error', stage, `Multi-agent refinement failed: ${err.message}`);
    throw err;
  }
}

/**
 * Targeted single-agent revision for story_decomposition_F* stages.
 *
 * Called when a human reviewer (or the critic) requests changes after the multi-agent
 * pipeline has already completed. Instead of re-running the full 3-phase pipeline,
 * Shard (Product Owner) applies a SURGICAL EDIT — only the stories mentioned in the
 * revision brief are modified; all other features are copied exactly as-is.
 */
export async function runMultiAgentFeatureRevision(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number,
  priorDraft: string,
  brief: string
): Promise<void> {
  const featureNum = featureIndex + 1;
  logger.info(`[MULTI-AGENT REVISION] Targeted revision for Feature ${featureNum} (stage: ${stage})`);

  insertEvent(workflowId, 'stage_progress', stage,
    `Revision mode: applying targeted changes to Feature ${featureNum} stories only…`);

  // Reload upstream artifacts fresh — a revision may be happening because the PRD or
  // architecture was itself corrected since this feature was last drafted. Without this,
  // the surgical edit only sees the (possibly stale) prior draft and generic feedback text,
  // so a since-corrected PRD claim never reaches the model and can resurface unchanged.
  const { loadLatestArtifactContent } = await import('./artifact-helpers');
  const { resolveProductAreaScope, buildPlatformScopeSection, filterBacklogStoriesByScope } = await import('./multi-agent-refinement');
  const [prdContent, archContent] = await Promise.all([
    loadLatestArtifactContent(itemId, 'prd'),
    loadLatestArtifactContent(itemId, 'architecture'),
  ]);
  const platformScope = resolveProductAreaScope(itemId);

  const contextParts: string[] = [];
  if (prdContent) contextParts.push(`**Current PRD (use as the source of truth — supersedes anything implied by the prior draft below):**\n\n${prdContent}`);
  if (archContent) contextParts.push(`**Current Architecture Document:**\n\n${archContent}`);
  const platformScopeSection = buildPlatformScopeSection(platformScope);
  if (platformScopeSection) contextParts.push(platformScopeSection);
  const itemContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : undefined;

  // Shard (Product Owner) applies the targeted edit to THIS FEATURE ONLY (isolated revision)
  const { SpecialistAgent } = await import('./specialist-agent');
  const agent = new SpecialistAgent('story-decomposition' as AgentType);
  const persona = await agent.loadPersona(stage);
  const systemPrompt = await agent.buildSystemPrompt(persona, undefined, itemContext, true, stage);

  const revisionDirective =
    `You are performing a SURGICAL EDIT of Feature ${featureNum} stories above. Apply ONLY the targeted changes described in the revision brief at the top of this conversation.\n\n` +
    `Rules — apply strictly:\n` +
    `- Modify ONLY the stories for Feature ${featureNum} (story IDs F${featureNum}.S*) that are explicitly mentioned in the feedback.\n` +
    `- Copy all other stories for Feature ${featureNum} EXACTLY as-is.\n` +
    `- Do NOT add new stories unless the feedback explicitly requests it.\n` +
    `- Do NOT restructure, reorder, rename, or rewrite any field not mentioned in the feedback.\n` +
    `- Preserve the exact JSON schema: every story must have story_id, title, as_a, i_want, so_that, acceptance_criteria, technical_acceptance_criteria, platform, estimated_points, depends_on.\n` +
    `- Return the complete Feature ${featureNum} JSON (epic + this one feature + all its stories) — only the flagged stories will differ from the prior draft.${platformScopeSection ? '\n- Stay within the Platform Scope above — drop any existing story that falls outside it even if the feedback didn\'t mention it.' : ''}`;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: brief },
    { role: 'assistant', content: '```json\n' + priorDraft + '\n```' },
    { role: 'user', content: revisionDirective },
  ];

  // Revisions now only output THIS feature (not accumulated). Use the same ceiling as the
  // initial synthesis (multi-agent-refinement.ts) so revisions don't truncate where drafts don't.
  const { STAGE_MAX_OUTPUT_TOKENS } = await import('./stage-metadata');
  const maxTokens = STAGE_MAX_OUTPUT_TOKENS['story_decomposition'] ?? 16_000;

  let fullResponse = '';
  const revisionStart = Date.now();
  let lastHeartbeat = revisionStart;
  for await (const chunk of agent.streamResponse(systemPrompt, messages, undefined, undefined, maxTokens)) {
    fullResponse += chunk;
    const now = Date.now();
    if (now - lastHeartbeat > 12_000) {
      lastHeartbeat = now;
      const elapsedSec = Math.round((now - revisionStart) / 1000);
      insertEvent(workflowId, 'stage_progress', stage,
        progressHeartbeatLine(`Revising Feature ${featureNum} stories`, elapsedSec, fullResponse.length));
    }
  }

  // Bail out if the workflow was cancelled while this revision was in flight —
  // see same guard in runMultiAgentFeatureStage above.
  if (isCancelRequested(workflowId)) {
    logger.info(`[MULTI-AGENT REVISION] Feature ${featureNum} result discarded — workflow ${workflowId} was cancelled mid-flight`);
    return;
  }

  // Parse revised backlog JSON
  const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = stripped.indexOf('{');
  const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;

  let revisedBacklog: any;
  try {
    revisedBacklog = JSON.parse(jsonContent);
  } catch (err: any) {
    logger.error(`[MULTI-AGENT REVISION] Invalid JSON from revision: ${err.message}`);
    throw new Error(`Revision produced invalid JSON: ${err.message}`);
  }

  // Enforce platform scope on the revision too — guards against a model carrying an
  // out-of-scope story forward from the prior draft when the feedback didn't mention it.
  const { backlog: scopedBacklogText } = filterBacklogStoriesByScope(JSON.stringify(revisedBacklog), platformScope);
  revisedBacklog = JSON.parse(scopedBacklogText);

  // Validate the revised feature
  const backlogValidation = JSON.parse(validateBacklogJson({ json: JSON.stringify(revisedBacklog) }));
  if (!backlogValidation.valid && Array.isArray(backlogValidation.issues) && backlogValidation.issues.length > 0) {
    logger.warn(`[MULTI-AGENT REVISION] Validation issues for Feature ${featureNum}: ${backlogValidation.issues.join(' | ')}`);
    insertEvent(workflowId, 'validation_warning', stage,
      `Revised backlog quality check flagged ${backlogValidation.issues.length} issue(s) for Feature ${featureNum}`,
      { issues: backlogValidation.issues });
  }

  // Save revised feature artifact (isolated, not accumulated)
  const { saveLocalArtifact, saveDiffArtifact } = await import('./artifact-helpers');
  const { computeRevisionDiff } = await import('../utils/revision-diff');
  const featureArtifactType = `backlog_F${featureNum}`;
  const artifactContent = JSON.stringify(revisedBacklog, null, 2);
  const artifactId = await saveLocalArtifact(sessionId, featureArtifactType, artifactContent, itemId, null);

  // Compute and save diff so the reviewer can see exactly what changed
  try {
    const diffText = computeRevisionDiff(priorDraft, artifactContent, `Feature ${featureNum} Backlog`);
    const diffArtifactId = await saveDiffArtifact(itemId, stage, diffText, sessionId, 'story-decomposition');
    if (diffArtifactId) logger.info(`[MULTI-AGENT REVISION] Diff artifact saved (id: ${diffArtifactId})`);
  } catch (err: any) {
    logger.warn(`[MULTI-AGENT REVISION] Failed to save diff: ${err.message}`);
  }

  // Create checkpoint for human review
  const { pauseAtCheckpoint } = await import('./workflow-router');
  pauseAtCheckpoint(workflowId, stage, artifactId, sessionId, { revision_mode: true, feature: featureNum });

  insertEvent(workflowId, 'stage_completed', stage,
    `Targeted revision applied for Feature ${featureNum} — only affected stories modified. Ready for review.`,
    { artifact_id: artifactId });

  logger.info(`[MULTI-AGENT REVISION] Feature ${featureNum} targeted revision complete (artifact ${artifactId})`);
}

/**
 * Targeted single-agent revision for story_decomposition_F*_qa checkpoints.
 *
 * Mirrors runMultiAgentFeatureRevision above, but edits the QA test suite instead of
 * the stories — Vera (QA Engineer) applies a SURGICAL EDIT to only the test cases
 * flagged in the revision brief; every other test case for this feature is copied as-is.
 */
export async function runMultiAgentFeatureQaRevision(
  sessionId: string,
  workflowId: string,
  stage: string,
  itemId: string,
  featureIndex: number,
  priorDraft: string,
  brief: string
): Promise<void> {
  const featureNum = featureIndex + 1;
  // Vera resolves her persona from the unsuffixed feature stage during the original
  // synthesis (synthesizeQaArtifact in multi-agent-refinement.ts) — match that here so
  // a QA revision loads the exact same persona the initial generation used.
  const baseStage = stage.replace(/_qa$/, '');
  logger.info(`[MULTI-AGENT REVISION] Targeted QA revision for Feature ${featureNum} (stage: ${stage})`);

  insertEvent(workflowId, 'stage_progress', stage,
    `Revision mode: applying targeted changes to Feature ${featureNum} QA tests only…`);

  // Reload upstream artifacts fresh — same rationale as runMultiAgentFeatureRevision: a
  // since-corrected PRD, or a backlog revision that dropped/changed stories, must reach
  // this revision or stale claims and dangling story references persist unchanged.
  const { loadLatestArtifactContent } = await import('./artifact-helpers');
  const { resolveProductAreaScope, buildPlatformScopeSection, filterQaTestCasesByStoryIds } = await import('./multi-agent-refinement');
  const [prdContent, currentBacklogContent] = await Promise.all([
    loadLatestArtifactContent(itemId, 'prd'),
    loadLatestArtifactContent(itemId, `backlog_F${featureNum}`),
  ]);
  const platformScope = resolveProductAreaScope(itemId);

  const contextParts: string[] = [];
  if (prdContent) contextParts.push(`**Current PRD (use as the source of truth):**\n\n${prdContent}`);
  if (currentBacklogContent) contextParts.push(`**Current Feature ${featureNum} Stories (test against these — not the prior draft's assumptions):**\n\n${currentBacklogContent}`);
  const platformScopeSection = buildPlatformScopeSection(platformScope);
  if (platformScopeSection) contextParts.push(platformScopeSection);
  const itemContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : undefined;

  const { SpecialistAgent } = await import('./specialist-agent');
  const agent = new SpecialistAgent('qa-engineer' as AgentType);
  const persona = await agent.loadPersona(baseStage);
  const systemPrompt = await agent.buildSystemPrompt(persona, undefined, itemContext, true, baseStage);

  const revisionDirective =
    `You are performing a SURGICAL EDIT of the Feature ${featureNum} QA test suite above. Apply ONLY the targeted changes described in the revision brief at the top of this conversation.\n\n` +
    `Rules — apply strictly:\n` +
    `- Modify ONLY the test cases (TC-F${featureNum}-*) explicitly mentioned in the feedback.\n` +
    `- Copy all other test cases for Feature ${featureNum} EXACTLY as-is.\n` +
    `- Do NOT add new test cases unless the feedback explicitly requests it.\n` +
    `- Do NOT restructure, reorder, rename, or rewrite any field not mentioned in the feedback.\n` +
    `- Preserve the exact JSON schema for every test case.\n` +
    `- Drop any test case whose story_ref no longer exists in the Current Feature ${featureNum} Stories above, even if the feedback didn't mention it.\n` +
    `- Return the complete Feature ${featureNum} QA test suite JSON — only the flagged test cases will differ from the prior draft.`;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: brief },
    { role: 'assistant', content: '```json\n' + priorDraft + '\n```' },
    { role: 'user', content: revisionDirective },
  ];

  const { STAGE_MAX_OUTPUT_TOKENS } = await import('./stage-metadata');
  const maxTokens = STAGE_MAX_OUTPUT_TOKENS['qa_engineer'] ?? 14_000;

  let fullResponse = '';
  const revisionStart = Date.now();
  let lastHeartbeat = revisionStart;
  for await (const chunk of agent.streamResponse(systemPrompt, messages, undefined, undefined, maxTokens)) {
    fullResponse += chunk;
    const now = Date.now();
    if (now - lastHeartbeat > 12_000) {
      lastHeartbeat = now;
      const elapsedSec = Math.round((now - revisionStart) / 1000);
      insertEvent(workflowId, 'stage_progress', stage,
        progressHeartbeatLine(`Revising Feature ${featureNum} QA tests`, elapsedSec, fullResponse.length));
    }
  }

  if (isCancelRequested(workflowId)) {
    logger.info(`[MULTI-AGENT REVISION] Feature ${featureNum} QA result discarded — workflow ${workflowId} was cancelled mid-flight`);
    return;
  }

  const stripped = fullResponse.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  const jsonStart = stripped.indexOf('{');
  const jsonContent = jsonStart > 0 ? stripped.slice(jsonStart) : stripped;

  let revisedQaTests: any;
  try {
    revisedQaTests = JSON.parse(jsonContent);
  } catch (err: any) {
    logger.error(`[MULTI-AGENT REVISION] Invalid JSON from QA revision: ${err.message}`);
    throw new Error(`QA revision produced invalid JSON: ${err.message}`);
  }

  // Drop any test case referencing a story that no longer exists in the current backlog
  // (e.g. dropped by a platform-scope or prior backlog revision) — backstop for the
  // "drop stale story_ref" instruction above in case the model didn't comply.
  if (currentBacklogContent) {
    try {
      const backlogJson = JSON.parse(currentBacklogContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim());
      const validStoryIds = new Set<string>();
      for (const feature of backlogJson.features ?? []) {
        for (const story of feature.stories ?? []) {
          if (story?.story_id) validStoryIds.add(story.story_id);
        }
      }
      const { qaTests: scopedQaText, dropped } = filterQaTestCasesByStoryIds(JSON.stringify(revisedQaTests), validStoryIds);
      if (dropped > 0) {
        revisedQaTests = JSON.parse(scopedQaText);
        logger.warn(`[MULTI-AGENT REVISION] Feature ${featureNum} QA revision — stripped ${dropped} test case(s) referencing stories that no longer exist`);
      }
    } catch (err: any) {
      logger.warn(`[MULTI-AGENT REVISION] Could not cross-check QA revision against current backlog: ${err.message}`);
    }
  }

  const qaValidation = JSON.parse(validateQaTestsJson({ json: JSON.stringify(revisedQaTests) }));
  if (!qaValidation.valid && Array.isArray(qaValidation.issues) && qaValidation.issues.length > 0) {
    logger.warn(`[MULTI-AGENT REVISION] QA validation issues for Feature ${featureNum}: ${qaValidation.issues.join(' | ')}`);
    insertEvent(workflowId, 'validation_warning', stage,
      `Revised QA test suite quality check flagged ${qaValidation.issues.length} issue(s) for Feature ${featureNum}`,
      { issues: qaValidation.issues });
  }

  const { saveLocalArtifact, saveDiffArtifact } = await import('./artifact-helpers');
  const { computeRevisionDiff } = await import('../utils/revision-diff');
  const artifactContent = JSON.stringify(revisedQaTests, null, 2);
  const artifactId = await saveLocalArtifact(sessionId, 'qa_tests', artifactContent, itemId, null);

  try {
    const diffText = computeRevisionDiff(priorDraft, artifactContent, `Feature ${featureNum} QA Tests`);
    const diffArtifactId = await saveDiffArtifact(itemId, stage, diffText, sessionId, 'qa-engineer');
    if (diffArtifactId) logger.info(`[MULTI-AGENT REVISION] QA diff artifact saved (id: ${diffArtifactId})`);
  } catch (err: any) {
    logger.warn(`[MULTI-AGENT REVISION] Failed to save QA diff: ${err.message}`);
  }

  const { pauseAtCheckpoint } = await import('./workflow-router');
  pauseAtCheckpoint(workflowId, stage, artifactId, sessionId, { revision_mode: true, feature: featureNum });

  insertEvent(workflowId, 'stage_completed', stage,
    `Targeted QA revision applied for Feature ${featureNum} — only affected test cases modified. Ready for review.`,
    { artifact_id: artifactId });

  logger.info(`[MULTI-AGENT REVISION] Feature ${featureNum} QA targeted revision complete (artifact ${artifactId})`);
}
