import { create } from 'zustand';

const COORDINATOR_MESSAGES_KEY_PREFIX = 'workflow-coordinator-messages:';
const LAST_EVENT_ID_KEY_PREFIX = 'workflow-last-event-id:';

function loadStoredMessages(workflowId: string): CoordinatorMessage[] {
  try {
    const raw = localStorage.getItem(`${COORDINATOR_MESSAGES_KEY_PREFIX}${workflowId}`);
    return raw ? JSON.parse(raw) as CoordinatorMessage[] : [];
  } catch {
    return [];
  }
}

function saveStoredMessages(workflowId: string, messages: CoordinatorMessage[]): void {
  try {
    localStorage.setItem(`${COORDINATOR_MESSAGES_KEY_PREFIX}${workflowId}`, JSON.stringify(messages));
  } catch { /* ignore */ }
}

function loadStoredLastEventId(workflowId: string): number {
  try {
    const raw = localStorage.getItem(`${LAST_EVENT_ID_KEY_PREFIX}${workflowId}`);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveStoredLastEventId(workflowId: string, id: number): void {
  try {
    localStorage.setItem(`${LAST_EVENT_ID_KEY_PREFIX}${workflowId}`, String(id));
  } catch { /* ignore */ }
}

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
  required_role: string | null;
  resolved_by_user_id: number | null;
  resolved_by_name: string | null;
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
  created_at: number;
  updated_at: number;
}

export interface WorkflowStatus {
  workflow: WorkflowRow;
  checkpoints: WorkflowCheckpoint[];
  currentStage: string | null;
  completedStages: string[];
  pendingStage: string | null;
  productArea?: string;
  strategicTheme?: string;
}

export interface CoordinatorMessage {
  role: 'coordinator' | 'human';
  content: string;
  timestamp: number;
  isProgress?: boolean;  // progress events replace each other in the chat
  eventType?: string;    // original workflow event type for styled rendering
  stage?: string;        // stage the event belongs to
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
  productArea: string | null;
  strategicTheme: string | null;

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

  // Claude Code Studio — persist terminal output per workflow so it survives navigation
  studioOutput: Record<string, string[]>;
  appendStudioLines: (workflowId: string, lines: string[]) => void;
  clearStudioOutput: (workflowId: string) => void;

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
  productArea: null,
  strategicTheme: null,

  coordinatorMessages: [],
  addCoordinatorMessage: (msg) =>
    set((state) => {
      const coordinatorMessages = [...state.coordinatorMessages, msg];
      const workflowId = state.activeWorkflow?.id;
      if (workflowId) saveStoredMessages(workflowId, coordinatorMessages);
      return { coordinatorMessages };
    }),
  appendToLastCoordinatorMessage: (chunk) =>
    set((state) => {
      const msgs = [...state.coordinatorMessages];
      if (msgs.length === 0) return state;
      msgs[msgs.length - 1] = {
        ...msgs[msgs.length - 1],
        content: msgs[msgs.length - 1].content + chunk,
      };
      const workflowId = state.activeWorkflow?.id;
      if (workflowId) saveStoredMessages(workflowId, msgs);
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
      const workflowId = state.activeWorkflow?.id;
      if (workflowId) saveStoredMessages(workflowId, msgs);
      return { coordinatorMessages: msgs };
    }),
  clearCoordinatorMessages: () =>
    set((state) => {
      const workflowId = state.activeWorkflow?.id;
      if (workflowId) saveStoredMessages(workflowId, []);
      return { coordinatorMessages: [] };
    }),

  isStreaming: false,
  setIsStreaming: (v) => set({ isStreaming: v }),

  lastEventId: 0,
  setLastEventId: (id) =>
    set((state) => {
      const workflowId = state.activeWorkflow?.id;
      if (workflowId) saveStoredLastEventId(workflowId, id);
      return { lastEventId: id };
    }),

  viewingArtifactId: null,
  setViewingArtifactId: (id) => set({ viewingArtifactId: id }),

  pendingDiffCount: 0,
  setPendingDiffCount: (n) => set({ pendingDiffCount: n }),

  activeCR: null,
  setActiveCR: (cr) => set({ activeCR: cr }),
  clearActiveCR: () => set({ activeCR: null }),

  studioOutput: {},
  appendStudioLines: (workflowId, lines) =>
    set((s) => ({
      studioOutput: {
        ...s.studioOutput,
        [workflowId]: [...(s.studioOutput[workflowId] ?? []), ...lines],
      },
    })),
  clearStudioOutput: (workflowId) =>
    set((s) => {
      const next = { ...s.studioOutput };
      delete next[workflowId];
      return { studioOutput: next };
    }),

  applyWorkflowStatus: ({ workflow, checkpoints, currentStage, completedStages, pendingStage, currentSessionId, productArea, strategicTheme }: WorkflowStatus & { currentSessionId?: string | null }) => {
    if (!workflow) {
      console.error('[workflowStore] applyWorkflowStatus called with undefined workflow');
      return;
    }
    const stageSequence: string[] = JSON.parse(workflow.stage_sequence ?? '[]');
    localStorage.setItem('activeWorkflowId', workflow.id);
    const cachedMessages = loadStoredMessages(workflow.id);
    const cachedLastEventId = loadStoredLastEventId(workflow.id);
    set({
      activeWorkflow: workflow,
      currentStage,
      currentSessionId: currentSessionId ?? null,
      stageSequence,
      completedStages,
      pendingStage,
      checkpoints: checkpoints ?? [],
      productArea: productArea ?? null,
      strategicTheme: strategicTheme ?? null,
      coordinatorMessages: cachedMessages,
      lastEventId: cachedLastEventId,
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
      productArea: null,
      strategicTheme: null,
      isStreaming: false,
      planningPhase: 'idle',
      planningSessionId: null,
      viewingArtifactId: null,
      activeCR: null,
    });
  },
}));
