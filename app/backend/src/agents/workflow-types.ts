export interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  summary: string | null;    // AI-generated brief name
  status: string;
  current_stage: string | null;
  stage_sequence: string;    // JSON string[]
  policy_overrides: string;  // JSON Record<string,string>
  decomposition_metadata: string | null;  // JSON DecompositionMetadata (feature wave membership)
  created_at: number;
  updated_at: number;
}

export interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: string;
  human_feedback: string | null;
  coordinator_action: string | null;  // JSON blob
  token_usage: string | null;       // JSON: StageTokenData
  required_role: string | null;
  resolved_by_user_id: number | null;
  resolved_by_name: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface WorkflowStatus {
  workflow: WorkflowRow;
  checkpoints: CheckpointRow[];
  currentStage: string | null;
  completedStages: string[];
  pendingStage: string | null;
  pendingStages: string[];       // every pending checkpoint's stage (multiple when a wave is mid-review)
  inProgressStages: string[];    // every stage currently running concurrently (the active wave, or [currentStage])
  currentSessionId: string | null;
  productArea?: string;
  strategicTheme?: string;
}

export interface WorkflowEvent {
  id: number;
  workflow_id: string;
  event_type: string;
  stage: string | null;
  summary: string;
  details: string | null;
  created_at: number;
}
