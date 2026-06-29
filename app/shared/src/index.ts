// Export all types
export * from './types';

// Explicit named re-exports (not `export *`) — tsc compiles `export *` to a runtime
// copy-loop (__exportStar) with no static `exports.NAME = ...` for bundlers to detect,
// so esbuild/Rollup can't see these as named exports. Explicit re-exports compile to
// literal `Object.defineProperty(exports, "NAME", ...)` calls, which both can see.
export { STAGE_PERSONAS, stagePersonaLabel } from './stage-personas';
export type { StagePersonaInfo } from './stage-personas';
export { renderArtifactMarkdown, isDocumentArtifact } from './artifact-markdown';
export type { MarkdownVariant } from './artifact-markdown';
export {
  effectiveStatus, resolveDisplayTitle, featureLocalKey, storyLocalKey,
  parseFeatureLocalKey, parseStoryLocalKey,
} from './initiative-status';
export type { WorkflowInfo } from './initiative-status';
export {
  backlogTier, getSprintMeta, getAllStories, getAllFeatures, tryParseBacklog, isBacklogArtifactType,
  TICKET_PLATFORMS, PLATFORM_LABELS, getStoryPlatforms, countTicketsByPlatform,
  tryParseResearchBrief, tryParsePRD, tryParseArchitecture,
} from './backlog-helpers';
export type {
  BacklogStory, BacklogFeature, BacklogSprintMeta, BacklogData, TicketPlatform, TicketPlatformBreakdown,
} from './backlog-helpers';
export { tryParseQATests, mergeQaTests } from './qa-test-helpers';
export type { QAScenario, TestCase, TestCoverage, QATestSuite } from './qa-test-helpers';
