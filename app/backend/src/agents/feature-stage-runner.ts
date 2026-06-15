/**
 * feature-stage-runner — handles the story_decomposition_F* stages, which run a
 * multi-agent collaborative refinement session per feature instead of the normal
 * single-specialist flow. Split out of runAutonomousStage, which dispatches here
 * when the stage name matches story_decomposition_F<n>.
 */
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
