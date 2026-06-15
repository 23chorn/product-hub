/**
 * feature-stage-runner — handles the story_decomposition_F* stages, which run a
 * multi-agent collaborative refinement session per feature instead of the normal
 * single-specialist flow. Split out of runAutonomousStage, which dispatches here
 * when the stage name matches story_decomposition_F<n>.
 *
 * Exports two functions:
 *   runMultiAgentFeatureStage  — full 3-phase pipeline for initial runs
 *   runMultiAgentFeatureRevision — surgical single-agent edit for human/critic revisions
 */
import type { AgentType } from '@pap/shared';
import { logger, insertEvent } from './workflow-db';
import { validateBacklogJson, validateQaTestsJson } from './tool-validators';

/**
 * Run multi-agent collaborative refinement for one feature, accumulate its stories
 * into the running backlog artifact, and create a pending checkpoint for review.
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
    const strippedBacklog = result.backlog.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const newFeature = JSON.parse(strippedBacklog);

    // Load accumulated backlog (if any previous features completed)
    let accumulatedBacklog: any;
    const { loadLatestArtifactContent, saveLocalArtifact } = await import('./artifact-helpers');
    const priorBacklogContent = await loadLatestArtifactContent(itemId, 'backlog');

    if (priorBacklogContent) {
      // Append new feature to existing backlog
      const cleaned = priorBacklogContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      accumulatedBacklog = JSON.parse(cleaned);
      accumulatedBacklog.features.push(...newFeature.features);
    } else {
      // First feature — initialize backlog structure
      accumulatedBacklog = newFeature;
    }

    // Save the accumulated backlog artifact (epic + all features so far).
    // Type is always 'backlog' so loadLatestArtifactContent(itemId, 'backlog') finds it for accumulation.
    const artifactId = await saveLocalArtifact(sessionId, 'backlog', JSON.stringify(accumulatedBacklog, null, 2), itemId, null);

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
    if (result.qaTests) {
      const strippedQa = result.qaTests.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      await saveLocalArtifact(sessionId, 'qa_tests', strippedQa, itemId, null);
      logger.info(`[MULTI-AGENT] QA test suite artifact saved for Feature ${featureIndex + 1}`);

      // Deterministic QA suite validation
      const qaValidation = JSON.parse(validateQaTestsJson({ json: strippedQa }));
      if (!qaValidation.valid && Array.isArray(qaValidation.issues) && qaValidation.issues.length > 0) {
        logger.warn(`[MULTI-AGENT] QA test suite validation issues for Feature ${featureIndex + 1}: ${qaValidation.issues.join(' | ')}`);
        insertEvent(workflowId, 'validation_warning', stage,
          `QA test suite quality check flagged ${qaValidation.issues.length} issue(s) for Feature ${featureIndex + 1}`,
          { issues: qaValidation.issues }
        );
      }
    }

    // Create checkpoint for human review — ADO push happens at checkpoint approval
    const { pauseAtCheckpoint } = await import('./workflow-router');
    await pauseAtCheckpoint(workflowId, stage, artifactId, undefined);

    logger.info(`[MULTI-AGENT] Feature ${featureIndex + 1} refinement complete — checkpoint created`);

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

  // Shard (Product Owner) applies the targeted edit — no full multi-agent pipeline needed
  const { SpecialistAgent } = await import('./specialist-agent');
  const agent = new SpecialistAgent('story-decomposition' as AgentType);
  const persona = await agent.loadPersona(stage);
  const systemPrompt = await agent.buildSystemPrompt(persona, undefined, undefined, true, stage);

  const revisionDirective =
    `You are performing a SURGICAL EDIT of the backlog JSON above. Apply ONLY the targeted changes described in the revision brief at the top of this conversation.\n\n` +
    `Rules — apply strictly:\n` +
    `- Modify ONLY the stories for Feature ${featureNum} (story IDs F${featureNum}.S*) that are explicitly mentioned in the feedback.\n` +
    `- Copy all stories for every other feature EXACTLY as-is — no changes whatsoever.\n` +
    `- Do NOT add new stories unless the feedback explicitly requests it.\n` +
    `- Do NOT restructure, reorder, rename, or rewrite any field not mentioned in the feedback.\n` +
    `- Preserve the exact JSON schema: every story must have story_id, title, as_a, i_want, so_that, acceptance_criteria, technical_acceptance_criteria, platform, estimated_points, depends_on.\n` +
    `- Return the complete backlog JSON (epic + all features + all stories) — only the flagged stories will differ from the prior draft.`;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: brief },
    { role: 'assistant', content: '```json\n' + priorDraft + '\n```' },
    { role: 'user', content: revisionDirective },
  ];

  let fullResponse = '';
  for await (const chunk of agent.streamResponse(systemPrompt, messages, undefined, undefined, 8_000)) {
    fullResponse += chunk;
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

  // Validate only the revised feature's stories
  const singleFeatureForValidation = {
    features: revisedBacklog.features
      ? [revisedBacklog.features[featureIndex]].filter(Boolean)
      : [],
  };
  const backlogValidation = JSON.parse(validateBacklogJson({ json: JSON.stringify(singleFeatureForValidation) }));
  if (!backlogValidation.valid && Array.isArray(backlogValidation.issues) && backlogValidation.issues.length > 0) {
    logger.warn(`[MULTI-AGENT REVISION] Validation issues for Feature ${featureNum}: ${backlogValidation.issues.join(' | ')}`);
    insertEvent(workflowId, 'validation_warning', stage,
      `Revised backlog quality check flagged ${backlogValidation.issues.length} issue(s) for Feature ${featureNum}`,
      { issues: backlogValidation.issues });
  }

  // Save revised backlog artifact
  const { saveLocalArtifact, saveDiffArtifact } = await import('./artifact-helpers');
  const { computeRevisionDiff } = await import('../utils/revision-diff');
  const artifactContent = JSON.stringify(revisedBacklog, null, 2);
  const artifactId = await saveLocalArtifact(sessionId, 'backlog', artifactContent, itemId, null);

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
