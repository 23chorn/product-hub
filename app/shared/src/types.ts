// ============================================
// Airtable Types
// ============================================

export interface AirtableItem {
  // Core fields
  id: string;
  initiative: string; // Primary field (was "title")
  description: string;

  // Your existing status and prioritization
  status: 'In Progress' | 'Blocked' | 'Ready' | 'Discovery' | 'Deferred' | 'Shipped'
    | 'Researching' | 'Scoping' | 'Designing' | 'Architecting' | 'Refining' | 'archived';
  businessValue: number; // 1-10 score
  priorityScore: number; // Calculated formula
  estimate: 'XS' | 'S' | 'M' | 'L' | 'XL';
  confidence: number; // Percentage (0-1)

  // Additional context fields
  targetQuarter?: string;
  targetWindow?: 'Now' | 'Next' | 'Later' | 'Under Review' | 'Someday' | 'Shipped';
  productArea?: string;
  strategicTheme?: string;
  affectedStakeholders?: string[];
  requiresDevWork?: 'Yes' | 'No';
  plannedStartDate?: string;
  plannedEndDate?: string;
  notes?: string;
  releaseLogs?: string;

  // Automation tracking fields
  owner?: string;
  researchBriefLink?: string;
  prdLink?: string;
  technicalDesignLink?: string;
  epicLink?: string;
  testPlanLink?: string;
  figmaDesignLink?: string;
  azureEpicId?: string;
  azureFeatureIds?: string;
  azureStoryIds?: string;

  // System fields
  createdAt: string;
  lastModified?: string;

  /** Local DB display number (items.seq_num) — human-facing "Initiative #N" identifier. Null for rows that predate this column and haven't been backfilled. */
  seqNum?: number | null;
}

// ============================================
// PRD Types
// ============================================

export interface PRDContent {
  title: string;
  overview: string;
  users: string[];
  useCases: string[];
  requirements: {
    functional: string[];
    nonFunctional: string[];
  };
  solutionOutline: string;
  acceptanceCriteria: string[];
  openQuestions: string[];
  risks: string[];
  analytics: string[];
  rolloutPlan: string;
  markdown: string; // Full markdown content
}

// ============================================
// Backlog Types
// ============================================

export interface InitiativeContext {
  overview: string;
  problemStatement?: string;
  targetUsers?: string[];
  successMetrics?: {
    primary: string;
    secondary: string[];
  };
  strategicAlignment?: string;
  constraints?: string[];
  outOfScope?: string[];
  references?: Array<{
    title: string;
    url: string;
  }>;
}

export interface FunctionalRequirement {
  id: string;
  requirement: string;
}

export interface NonFunctionalRequirement {
  id: string;
  category: string;
  requirement: string;
  priority: string;
}

export interface BacklogStructure {
  epic: {
    title: string;
    description: string;
    businessValue: string;
    prdLink: string;
  };
  features: Feature[];
}

export interface Feature {
  title: string;
  description: string;
  phase: string;
  stories: Story[];
}

export interface StoryTechnical {
  constraints?: string[];
  affectedComponents?: string[];
  dataChanges?: string | null;
  apiChanges?: string | null;
}

export interface StoryTechnicalNotes {
  ios?: string | null;
  android?: string | null;
  backend?: string | null;
}

export interface Story {
  title: string;
  persona: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string[];
  effort?: number;
  aiEstimatedHours?: number;
  aiEstimatedQaHours?: number;
  technical?: StoryTechnical;
  technical_notes?: StoryTechnicalNotes;
}

// ============================================
// Work Item (items table)
// ============================================

export type WorkItemType = 'initiative' | 'feature' | 'bug' | 'spike';
export type WorkItemStatus = 'active' | 'in_progress' | 'shipped' | 'archived';
export type WorkItemSource = 'airtable' | 'quick_add' | 'local';
export type ArtifactStatus = 'draft' | 'approved' | 'superseded';

export interface WorkItem {
  id: string;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  source: WorkItemSource;
  airtableId?: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// Model Types
// ============================================

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

// ============================================
// Local Initiative Types (roadmap=none mode)
// ============================================

export interface LocalInitiative {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// Discovery Mode Types
// ============================================

export type DiscoverySourceType = 'user_interview' | 'app_store_review' | 'play_store_review' | 'competitor_note' | 'other';
export type DiscoveryRunStatus = 'running' | 'complete' | 'error';
export type DiscoveryOpportunityStatus = 'new' | 'reviewed' | 'promoted' | 'dismissed';

export interface DiscoverySource {
  id: string;
  sourceType: DiscoverySourceType;
  title: string;
  content: string;
  origin: 'manual' | 'api';
  externalId?: string;
  externalUrl?: string;
  fetchedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DiscoveryOpportunityEvidence {
  sourceTitle: string;
  sourceId?: string;
  quote?: string;
  url?: string;
}

export interface DiscoveryOpportunity {
  id: number;
  runId: string;
  title: string;
  description: string;
  rationale: string;
  confidence?: number;
  evidence: DiscoveryOpportunityEvidence[];
  status: DiscoveryOpportunityStatus;
  promotedItemId?: string;
  reviewedAt?: number;
  createdAt: number;
}

export interface DiscoveryRun {
  id: string;
  status: DiscoveryRunStatus;
  sourceIds: string[];
  opportunityCount: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

// ============================================
// Quick Session Types
// ============================================

export interface QuickItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// Specialist Agent Types
// ============================================

export type AppMode = 'prd' | 'backlog' | 'analyst' | 'epic_features' | 'architecture' | 'context' | 'prototype' | 'qa' | 'tech_refinement' | 'figma_design';
export type AgentType = 'pm' | 'analyst' | 'epic-feature-planner' | 'architect' | 'api-spec-designer' | 'story-decomposition' | 'context-keeper' | 'prototype-builder' | 'qa-engineer' | 'tech-refinement' | 'backend-engineer' | 'web-engineer' | 'ios-engineer' | 'android-engineer' | 'figma-designer';


// ============================================
// Session Types
// ============================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Session {
  id: string;
  itemId: string;
  type: 'prd' | 'backlog';
  status: 'active' | 'completed' | 'cancelled' | 'archived';
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  prdContent?: PRDContent;
  backlogStructure?: BacklogStructure;
  // Agent fields
  agentType?: AgentType;
  agentId?: string;             // e.g. 'pm-prd' | 'pm-backlog' | 'analyst'
  mode?: AppMode;
  activeWorkflow?: string;
  workflowContext?: string;
  conversationPath?: string;
  parentSessionId?: string;
  intendedOutput?: string;
}

// ============================================
// API Request/Response Types
// ============================================

export interface StartPRDSessionRequest {
  itemId: string;
}

export interface StartPRDSessionResponse {
  sessionId: string;
  message: string;
}

export interface SendMessageRequest {
  sessionId: string;
  message: string;
}

export interface PublishPRDRequest {
  sessionId: string;
}

export interface PublishPRDResponse {
  success: boolean;
  gitbookUrl: string;
  airtableUpdated: boolean;
}

export interface StartBacklogSessionRequest {
  sessionId: string; // PRD session ID
}

// ============================================
// Context Keeper Types
// ============================================

export interface StatusChange {
  airtableId: string;
  title: string;
  oldStatus: string;
  newStatus: string;
  detectedAt: number;
}

export interface ContextChangeProposal {
  id: number;
  sessionId: string;
  fileName: string;
  sectionHint: string | null;
  proposedText: string;
  rationale: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  createdAt: number;
  reviewedAt: number | null;
}

export interface ContextStatusResponse {
  pendingCount: number;
  lastChecked: number | null;
  changes: StatusChange[];
  proposals: ContextChangeProposal[];
}

// ============================================
// Error Types
// ============================================

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public service: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// ============================================
// Validation Types
// ============================================

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// ============================================
// App Config (shared between backend and frontend)
// Secrets (API keys, PATs) are never included here.
// ============================================

export type RoadmapIntegration = 'airtable' | 'none';
export type WorkItemsIntegration = 'ado' | 'none';
export type KnowledgeBaseIntegration = 'azure_wiki' | 'none';

export interface AppConfig {
  ai: {
    provider: string;
    models: ModelOption[];
  };
  features: {
    workflowMode: 'standard';
    workflowModeEnabled: boolean;
    navTabs: {
      progressTracker: boolean;
      discovery: boolean;
      knowledgeStudio: boolean;
      quickFeature: boolean;
    };
  };
  integrations: {
    roadmap: RoadmapIntegration;
    workItems: WorkItemsIntegration;
    knowledgeBase: KnowledgeBaseIntegration;
  };
  stages: {
    enabledStages: Record<string, boolean>;
  };
  server: {
    nodeEnv: string;
    useMockData: boolean;
  };
}

// ── Workflow Engine Types ──────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'paused_at_checkpoint' | 'complete';

/** DB row shape — JSON columns (stage_sequence, policy_overrides) stored as TEXT. */
export interface Workflow {
  id: string;
  item_id: string;
  goal: string;
  status: WorkflowStatus;
  current_stage: string | null;
  stage_sequence: string;    // JSON-encoded string[] — parse with JSON.parse()
  policy_overrides: string;  // JSON-encoded Record<string,string> — parse with JSON.parse()
  created_at: number;
  updated_at: number;
}

export type CheckpointStatus = 'pending' | 'approved' | 'rejected' | 'revised';

export interface Checkpoint {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: CheckpointStatus;
  human_feedback: string | null;
  coordinator_action: string | null;  // JSON blob — parse with JSON.parse()
  required_role: string | null;       // JSON array string e.g. '["product","tech_lead"]', or null
  created_at: number;
  resolved_at: number | null;
}

export interface ContextDiff {
  id: number;
  workflow_id: string | null;
  file_name: string;
  diff_content: string;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  created_at: number;
}

export interface Policy {
  id: number;
  scope: 'global' | 'workflow_type' | 'agent';
  scope_value: string | null;
  rule_key: string;
  rule_value: string;  // always a JSON string — parse at call site
  created_at: number;
}

// ============================================
// Knowledge Studio: cross-repo documentation review
// ============================================

export type KbCommentSource = 'user' | 'agent';
export type KbCommentStatus = 'open' | 'resolved';

export interface KbRepo {
  id: number;
  label: string;
  repository: string;
  branch: string | null;
  project: string | null;
  fileCount: number;
  lastSyncedAt: number | null;
  createdAt: number;
}

/** Lightweight row for list views — omits the full file content. */
export interface KbFileListItem {
  id: number;
  repoId: number;
  repoLabel: string;
  path: string;
  frontmatterFileName: string | null;
  frontmatterOwner: string | null;
  frontmatterStatus: string | null;
  frontmatterValid: boolean;
  openCommentCount: number;
  lastSyncedAt: number;
}

export interface KbFile extends KbFileListItem {
  content: string;
  commitId: string | null;
}

export interface KbComment {
  id: number;
  fileId: number;
  source: KbCommentSource;
  authorName: string;
  body: string;
  quote: string | null;
  status: KbCommentStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export interface KbFileCommit {
  commitId: string;
  authorName: string;
  authorEmail: string;
  date: number;
  message: string;
  /** Line-level change counts vs. the previous commit that touched this file. */
  linesAdded: number;
  linesRemoved: number;
}

// ============================================
// Completed Initiatives: ADO ticket-state review
// ============================================

export type WorkItemStateBucket = 'not_started' | 'in_progress' | 'done' | 'removed';

export interface CompletedInitiativeSummary {
  itemId: string;
  seqNum: number | null;
  title: string;
  epicAdoUrl: string | null;
  epicCount: number;
  featureCount: number;
  storyCount: number;
  stateBuckets: Record<WorkItemStateBucket, number>;
  testCaseCount: number;
  lastRefreshedAt: number | null;
  /** Average ADO status progress (0-100) across the most granular synced work items
   *  (stories, or features when an initiative has no stories). Null until at least one
   *  work item has a synced state. */
  percentComplete: number | null;
}

export interface CompletedInitiativeWorkItemRow {
  localKey: string;
  /** For features: the local_key of the parent epic (e.g. 'epic_mvp'). Null for old records. */
  parentLocalKey: string | null;
  adoId: number;
  adoType: 'epic' | 'feature' | 'story';
  adoUrl: string | null;
  title: string;
  state: string | null;
  stateBucket: WorkItemStateBucket | null;
  /** ADO status progress (0-100) for this single work item's raw state. Null until synced. */
  statePercent: number | null;
  stateSyncedAt: number | null;
  artifactId: number | null;
}

export interface CompletedInitiativeTestPlanRow {
  planId: number;
  planUrl: string;
  testCaseCount: number | null;
  /** The qa_tests artifact pushed to build this plan — lets the detail page render the
   *  underlying test cases (type/priority breakdown), not just the ADO count. */
  artifactId: number | null;
}

export interface CompletedInitiativeDetail extends CompletedInitiativeSummary {
  workItems: CompletedInitiativeWorkItemRow[];
  testPlans: CompletedInitiativeTestPlanRow[];
  /** Latest research/analyst-brief, PRD, architecture, and Figma artifact ids for this item, if
   *  the stage ran — lets the detail page cycle through every produced document, not just
   *  tickets/tests. Resolved independent of the ADO push tables (see getDocumentArtifactIds in
   *  completed-initiatives-routes.ts for why those can't be trusted here). */
  researchArtifactId: number | null;
  prdArtifactId: number | null;
  architectureArtifactId: number | null;
  figmaArtifactId: number | null;
  /** The merged final backlog artifact (backlog_merge output) — already combines every
   *  feature, so the detail page can read it directly with no per-feature merge. */
  ticketArtifactId: number | null;
  /** Latest epic_features artifact id — used to canonicalise feature→phase grouping in BacklogView. */
  epicFeaturesArtifactId: number | null;
  /** One qa_tests artifact id per feature (latest approved story_decomposition_F<n>_qa
   *  checkpoint) — qa_tests has no per-feature-suffixed type, so these must be merged
   *  client-side the same way the per-feature backlog/QA Stories+Tests view already does. */
  testArtifactIds: number[];
}

// ============================================
// Admin: linked Swagger/OpenAPI docs (current API context for the architect stage)
// ============================================

export interface SwaggerApiDoc {
  id: number;
  label: string;
  docUrl: string;
  active: boolean;
  specTitle: string | null;
  specVersion: string | null;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  createdAt: number;
}

