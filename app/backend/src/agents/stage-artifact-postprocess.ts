/**
 * Per-stage post-processing applied to a saved artifact before the critic runs.
 *
 * Each entry handles the stage-specific work that used to sit as a chain of
 * `if (stage === …)` blocks in runAutonomousStage: writing the figma design brief
 * back to Figma, extracting the tech-enriched epic/features JSON, resolving feature
 * dependencies, and stamping the resolved platform onto the prototype. Collapsing
 * them into one dispatch map (rule #4) keeps the runner to a single lookup —
 * exactly one entry can match a given stage, so order is preserved.
 *
 * A processor returns the (possibly updated) artifact content; the runner reassigns
 * `artifactContent` from the result. Each is responsible for persisting its own
 * change via updateArtifactContent — the returned string just keeps the in-memory
 * copy in sync for the critic/diff steps that follow.
 *
 * Leaf module: depends only on db + sibling agent helpers, never back on the runner.
 */

import { stripJsonFence } from '../utils/json-repair';
import { saveLocalArtifact, updateArtifactContent } from './artifact-helpers';
import { getFigmaFileKey, resolveItemPlatform, resolvedFramePlatform, writeFigmaAnnotations } from './prototype-agent';
import { flattenFeatures, resolveFeatureDependencies } from './feature-decomposition';
import { logger, insertEvent } from './workflow-db';

export interface ArtifactPostprocessParams {
  workflowId: string;
  itemId: string;
  stage: string;
  sessionId: string;
  artifactId: number;
  artifactContent: string;
  figmaBypass: boolean;
  /** true when this stage's output came from a demo fixture rather than the LLM */
  isDemoFixture: boolean;
}

type ArtifactPostprocessor = (p: ArtifactPostprocessParams) => Promise<string>;

export const STAGE_ARTIFACT_POSTPROCESSORS: Record<string, ArtifactPostprocessor> = {
  // ── pm_prd: renumber NFRs sequentially to remove gaps after deletion ──
  async pm_prd({ artifactId, artifactContent }) {
    try {
      const parsed = JSON.parse(stripJsonFence(artifactContent));
      if (Array.isArray(parsed.non_functional_requirements) && parsed.non_functional_requirements.length > 0) {
        // Renumber NFRs sequentially (NFR1, NFR2, NFR3, ...)
        parsed.non_functional_requirements = parsed.non_functional_requirements.map((nfr: any, index: number) => ({
          ...nfr,
          id: `NFR${index + 1}`,
        }));

        const updated = JSON.stringify(parsed, null, 2);
        await updateArtifactContent(artifactId, updated);
        logger.info(`Renumbered ${parsed.non_functional_requirements.length} NFRs sequentially`);
        return updated;
      }
    } catch (err: any) {
      logger.warn(`Failed to renumber NFRs in PRD: ${err.message}`);
    }
    return artifactContent;
  },

  // ── figma_design: write design brief to Figma as a comment ──
  async figma_design({ workflowId, itemId, stage, artifactId, artifactContent, figmaBypass }) {
    if (figmaBypass) return artifactContent;
    try {
      const parsed = JSON.parse(stripJsonFence(artifactContent));
      const fileKey = getFigmaFileKey(itemId);
      const screens = Array.isArray(parsed.screens_created) ? parsed.screens_created : [];

      if (fileKey && screens.length > 0) {
        insertEvent(workflowId, 'stage_progress', stage, 'Writing design brief to Figma...');
        const result = await writeFigmaAnnotations(fileKey, screens, parsed.navigation_flow);

        if (result.success) {
          parsed.figma_write_status = 'annotated';
          if (result.commentId) parsed.figma_comment_id = result.commentId;
          const updated = JSON.stringify(parsed, null, 2);
          await updateArtifactContent(artifactId, updated);
          insertEvent(workflowId, 'stage_progress', stage,
            `Design brief posted to Figma — open the file and make your edits, then mark complete in xCube Flow.`);
          return updated;
        }
        logger.warn(`[FIGMA-DESIGN] Annotation write failed for file ${fileKey} — status remains "planned"`);
      } else if (!fileKey) {
        logger.info('[FIGMA-DESIGN] No Figma file key — annotation skipped');
      }
    } catch (err: any) {
      logger.warn(`[FIGMA-DESIGN] Post-processing failed: ${err.message}`);
    }
    return artifactContent;
  },

  // ── epic_feature_planner: ensure empty stories arrays, and resolve each feature's
  // dependsOn (title references) into stable dependsOnIndices using the same flatten
  // order F-keys are assigned from downstream. ──
  async epic_feature_planner({ workflowId, stage, artifactId, artifactContent }) {
    const jsonContent = stripJsonFence(artifactContent);
    try {
      const parsed = JSON.parse(jsonContent);

      // Ensure stories: [] on every feature (phased or legacy) — the legacy block
      // only ever handled the flat shape; phased output was previously left untouched.
      const ensureStories = (f: any) => ({ ...f, stories: f.stories ?? [] });
      if (Array.isArray(parsed.phases)) {
        parsed.phases = parsed.phases.map((p: any) => ({
          ...p,
          features: Array.isArray(p.features) ? p.features.map(ensureStories) : [],
        }));
      } else if (Array.isArray(parsed.features)) {
        parsed.features = parsed.features.map(ensureStories);
      }

      const flatFeatures = flattenFeatures(parsed);
      const { resolvedByIndex, warnings } = resolveFeatureDependencies(flatFeatures);

      // Stamp dependsOnIndices back onto each feature in its original nested location,
      // by position — flattenFeatures()'s order is stable for a given parsed JSON.
      let flatIdx = 0;
      const stampDeps = (f: any) => {
        const resolved = resolvedByIndex.get(flatIdx) ?? [];
        flatIdx++;
        return { ...f, dependsOnIndices: resolved };
      };
      if (Array.isArray(parsed.phases)) {
        parsed.phases = parsed.phases.map((p: any) => ({
          ...p,
          features: Array.isArray(p.features) ? p.features.map(stampDeps) : [],
        }));
      } else if (Array.isArray(parsed.features)) {
        parsed.features = parsed.features.map(stampDeps);
      }

      if (warnings.length > 0) {
        logger.warn(`[epic_feature_planner] Dependency resolution warnings: ${warnings.join(' | ')}`);
        insertEvent(workflowId, 'validation_warning', stage,
          `${warnings.length} feature dependency reference(s) could not be resolved — treated as independent`,
          { warnings });
      }

      const updated = JSON.stringify(parsed, null, 2);
      await updateArtifactContent(artifactId, updated);
      logger.info(`Updated artifact in-place for stage "${stage}" (dependencies resolved)`);
      return updated;
    } catch (err: any) {
      logger.warn(`Failed to parse JSON for ${stage}: ${err.message}`);
    }
    return artifactContent;
  },

  // ── prototype: stamp the resolved platform onto the artifact so the preview can
  // render a fixed device frame instead of a switchable one. Demo fixtures already set
  // their own platform (e.g. mobile) — resolveItemPlatform() would default to 'web' for
  // a demo item with no productArea metadata, clobbering it. ──
  async prototype({ itemId, artifactId, artifactContent, isDemoFixture }) {
    if (isDemoFixture) return artifactContent;
    try {
      const parsed = JSON.parse(stripJsonFence(artifactContent));
      parsed.platform = resolvedFramePlatform(resolveItemPlatform(itemId));
      const updated = JSON.stringify(parsed, null, 2);
      await updateArtifactContent(artifactId, updated);
      logger.info(`Stamped platform "${parsed.platform}" onto prototype artifact`);
      return updated;
    } catch (err: any) {
      logger.warn(`Failed to stamp platform onto prototype artifact: ${err.message}`);
    }
    return artifactContent;
  },
};
