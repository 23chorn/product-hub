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
  token_usage: string | null;
  artifact?: { id: number; type: string; file_path: string; created_at: number } | null;
}

export interface WorkflowRow {
  id: string;
  item_id: string;
  goal: string;
  summary: string | null;    // AI-generated brief name
  status: 'active' | 'paused_at_checkpoint' | 'complete';
  current_stage: string | null;
  stage_sequence: string;    // JSON string[]
  policy_overrides: string;  // JSON Record<string,string>
  estimated_cost: number;    // cumulative USD cost
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
  isProgress?: boolean;  // progress events replace each other in the chat
}

export interface WorkflowEvent {
  id: number;
  workflow_id: string;
  event_type: string;
  stage: string | null;
  summary: string;
  details: string | null;  // JSON blob
  created_at: number;
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

  // Pre-workflow coordinator planning phase
  planningPhase: 'idle' | 'gathering' | 'confirming' | 'launching';
  planningSessionId: string | null;
  setPlanningPhase: (phase: 'idle' | 'gathering' | 'confirming' | 'launching') => void;
  setPlanningSessionId: (id: string | null) => void;

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
  replaceLastCoordinatorMessage: (content: string | CoordinatorMessage) => void;
  clearCoordinatorMessages: () => void;

  // Streaming state
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;

  // Event tracking
  lastEventId: number;
  setLastEventId: (id: number) => void;

  // Artifact viewer
  viewingArtifactId: number | null;
  setViewingArtifactId: (id: number | null) => void;

  // Pending context diffs notification
  pendingDiffCount: number;
  setPendingDiffCount: (n: number) => void;

  // Active change request
  activeCR: { id: number; status: string; impactAssessment?: { affected_stages: string[]; summary: string } } | null;
  setActiveCR: (cr: { id: number; status: string; impactAssessment?: { affected_stages: string[]; summary: string } } | null) => void;
  clearActiveCR: () => void;

  // Update from a WorkflowStatus API response
  applyWorkflowStatus: (status: WorkflowStatus) => void;

  // Reset all workflow state
  resetWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowStoreState>((set) => ({
  isWorkflowMode: false,
  setWorkflowMode: (active) => set({ isWorkflowMode: active }),

  planningPhase: 'idle',
  planningSessionId: null,
  setPlanningPhase: (phase) => set({ planningPhase: phase }),
  setPlanningSessionId: (id) => set({ planningSessionId: id }),

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
  replaceLastCoordinatorMessage: (content) =>
    set((state) => {
      const msgs = [...state.coordinatorMessages];
      if (msgs.length === 0) return state;
      if (typeof content === 'string') {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
      } else {
        msgs[msgs.length - 1] = content;
      }
      return { coordinatorMessages: msgs };
    }),
  clearCoordinatorMessages: () => set({ coordinatorMessages: [] }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),

  lastEventId: 0,
  setLastEventId: (id) => set({ lastEventId: id }),

  viewingArtifactId: null,
  setViewingArtifactId: (id) => set({ viewingArtifactId: id }),

  pendingDiffCount: 0,
  setPendingDiffCount: (n) => set({ pendingDiffCount: n }),

  activeCR: null,
  setActiveCR: (cr) => set({ activeCR: cr }),
  clearActiveCR: () => set({ activeCR: null }),

  applyWorkflowStatus: ({ workflow, checkpoints, currentStage, completedStages, pendingStage, currentSessionId }: WorkflowStatus & { currentSessionId?: string | null }) => {
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
    localStorage.removeItem('coordinatorPlanningSessionId');
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
      planningPhase: 'idle',
      planningSessionId: null,
      lastEventId: 0,
      viewingArtifactId: null,
      activeCR: null,
    });
  },
}));
