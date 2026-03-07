import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowCheckpoint {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'revised';
  human_feedback: string | null;
  coordinator_action: string | null;
  created_at: number;
  resolved_at: number | null;
  artifact?: { id: number; type: string; file_path: string; created_at: number } | null;
}

export interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  status: 'active' | 'paused_at_checkpoint' | 'complete';
  current_stage: string | null;
  stage_sequence: string;    // JSON string[]
  policy_overrides: string;  // JSON Record<string,string>
  created_at: number;
  updated_at: number;
}

export interface WorkflowStatus {
  workflow: WorkflowRow;
  checkpoints: WorkflowCheckpoint[];
  currentStage: string | null;
  completedStages: string[];
  pendingStage: string | null;
}

export interface CoordinatorMessage {
  role: 'coordinator' | 'human';
  content: string;
  timestamp: number;
}

export type StageStatus = 'pending' | 'in-progress' | 'at-checkpoint' | 'complete' | 'skipped' | 'rejected';

export interface StageInfo {
  name: string;
  status: StageStatus;
  completedAt?: number;
  sessionId?: string | null;
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface WorkflowStoreState {
  // Whether Workflow Mode is active (vs Direct Access mode)
  isWorkflowMode: boolean;
  setWorkflowMode: (active: boolean) => void;

  // Active workflow data
  activeWorkflow: WorkflowRow | null;
  currentStage: string | null;
  currentSessionId: string | null;  // specialist session for the active stage
  stageSequence: string[];
  completedStages: string[];
  pendingStage: string | null;
  checkpoints: WorkflowCheckpoint[];

  // Coordinator chat messages
  coordinatorMessages: CoordinatorMessage[];
  addCoordinatorMessage: (msg: CoordinatorMessage) => void;
  appendToLastCoordinatorMessage: (chunk: string) => void;
  clearCoordinatorMessages: () => void;

  // Streaming state
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;

  // Pending context diffs notification
  pendingDiffCount: number;
  setPendingDiffCount: (n: number) => void;

  // Update from a WorkflowStatus API response
  applyWorkflowStatus: (status: WorkflowStatus) => void;

  // Reset all workflow state
  resetWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowStoreState>((set) => ({
  isWorkflowMode: false,
  setWorkflowMode: (active) => set({ isWorkflowMode: active }),

  activeWorkflow: null,
  currentStage: null,
  currentSessionId: null,
  stageSequence: [],
  completedStages: [],
  pendingStage: null,
  checkpoints: [],

  coordinatorMessages: [],
  addCoordinatorMessage: (msg) =>
    set((state) => ({ coordinatorMessages: [...state.coordinatorMessages, msg] })),
  appendToLastCoordinatorMessage: (chunk) =>
    set((state) => {
      const msgs = [...state.coordinatorMessages];
      if (msgs.length === 0) return state;
      msgs[msgs.length - 1] = {
        ...msgs[msgs.length - 1],
        content: msgs[msgs.length - 1].content + chunk,
      };
      return { coordinatorMessages: msgs };
    }),
  clearCoordinatorMessages: () => set({ coordinatorMessages: [] }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),

  pendingDiffCount: 0,
  setPendingDiffCount: (n) => set({ pendingDiffCount: n }),

  applyWorkflowStatus: ({ workflow, checkpoints, currentStage, completedStages, pendingStage, currentSessionId }) => {
    const stageSequence: string[] = JSON.parse(workflow.stage_sequence ?? '[]');
    localStorage.setItem('activeWorkflowId', workflow.id);
    set({
      activeWorkflow: workflow,
      currentStage,
      currentSessionId: currentSessionId ?? null,
      stageSequence,
      completedStages,
      pendingStage,
      checkpoints: checkpoints ?? [],
    });
  },

  resetWorkflow: () => {
    localStorage.removeItem('activeWorkflowId');
    set({
      activeWorkflow: null,
      currentStage: null,
      currentSessionId: null,
      stageSequence: [],
      completedStages: [],
      pendingStage: null,
      checkpoints: [],
      coordinatorMessages: [],
      isStreaming: false,
    });
  },
}));
