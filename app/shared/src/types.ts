// ============================================
// Airtable Types
// ============================================

export interface AirtableItem {
  // Core fields
  id: string;
  initiative: string; // Primary field (was "title")
  description: string;

  // Your existing status and prioritization
  status: 'In Progress' | 'Blocked' | 'Ready' | 'Discovery' | 'Deferred' | 'Shipped';
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
  epicLink?: string;
  testPlanLink?: string;
  azureEpicId?: string;
  azureFeatureIds?: string;
  azureStoryIds?: string;

  // System fields
  createdAt: string;
  lastModified?: string;
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

export type AppMode = 'prd' | 'backlog' | 'analyst' | 'architecture' | 'decision-log' | 'context' | 'gtm' | 'feature_marketing' | 'prototype' | 'qa' | 'tech_refinement';
export type AgentType = 'pm' | 'analyst' | 'architect' | 'decision-log' | 'context-keeper' | 'gtm' | 'marketer' | 'prototype-builder' | 'qa-engineer' | 'tech-refinement';


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
// Decision Log Types
// ============================================

export interface MonthEntry {
  month: string;   // 'YYYY-MM' e.g. '2026-02'
  label: string;   // 'February 2026'
}

export interface DecisionLogSession {
  sessionId: string;
  monthId: string;
  messages: ChatMessage[];
  logExists: boolean;
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
export type WorkItemsIntegration = 'ado' | 'jira' | 'none';
export type KnowledgeBaseIntegration = 'notion' | 'gitbook' | 'none';

export interface AppConfig {
  ai: {
    provider: string;
    models: ModelOption[];
  };
  features: {
    workflowMode: 'standard';
    workflowModeEnabled: boolean;
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
// Integration Provider Interfaces
// ============================================

/** Read-only roadmap data (Airtable rows, etc.) */
export interface RoadmapItem {
  id: string;
  title: string;
  description?: string;
  status?: string;
}

export interface RoadmapProvider {
  getItems(): Promise<RoadmapItem[]>;
  getItem(id: string): Promise<RoadmapItem>;
}

/** Write-only work item creation (ADO, Jira, etc.) */
export interface WorkItemProviderEpic {
  id: string;      // provider-specific ID (ADO int, Jira key)
  url?: string;
}

export interface WorkItemProviderStory {
  id: string;
  url?: string;
}

export interface WorkItemProvider {
  createEpic(title: string, description?: string): Promise<WorkItemProviderEpic>;
  createStory(title: string, description: string, epicId: string): Promise<WorkItemProviderStory>;
  createTask(title: string, description: string, storyId: string): Promise<{ id: string }>;
  linkDependency(fromId: string, toId: string): Promise<void>;
}

/** Read-only knowledge base (Notion pages, etc.) */
export interface KnowledgeBasePage {
  id: string;
  title: string;
  content: string;
}

export interface KnowledgeBaseSearchResult {
  title: string;
  body: string;
  url: string;
}

export interface KnowledgeBaseProvider {
  getPages(): Promise<KnowledgeBasePage[]>;
  getPage(id: string): Promise<KnowledgeBasePage>;
  search(query: string, limit?: number): Promise<KnowledgeBaseSearchResult[]>;
}
