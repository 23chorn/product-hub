import axios from 'axios';
import type { AirtableItem, AppConfig, AppMode, BmadAgentInfoResponse, BmadStartResponse, LocalInitiative, ModelOption, PublishBacklogResponse, QuickItem, DecisionLogSession, MonthEntry, StatusChange, ContextChangeProposal, ContextStatusResponse } from '@pap/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class APIClient {
  private baseURL: string;

  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // ============================================
  // Airtable
  // ============================================

  async getItemsNeedingPRD(): Promise<AirtableItem[]> {
    const response = await axios.get(`${this.baseURL}/api/prd/items/needingPRD`);
    return response.data;
  }

  // ============================================
  // BMAD Agent endpoints
  // ============================================

  async getAgentInfo(mode: AppMode, itemId?: string): Promise<BmadAgentInfoResponse> {
    const response = await axios.get(`${this.baseURL}/api/bmad/agent-info`, {
      params: { mode, itemId },
    });
    return response.data;
  }

  async startBmadSession(mode: AppMode, itemId?: string): Promise<BmadStartResponse & { resumed?: boolean; messages?: any[]; activeWorkflow?: string | null }> {
    const response = await axios.post(`${this.baseURL}/api/bmad/start`, {
      mode,
      itemId,
    });
    return response.data;
  }

  async resetBmadSession(sessionId: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/bmad/session/${sessionId}`);
  }

  async exportDocument(sessionId: string, content: string): Promise<{ filePath: string }> {
    const response = await axios.post(`${this.baseURL}/api/bmad/export`, { sessionId, content });
    return response.data;
  }

  async publishBacklog(sessionId: string, backlogJson: string): Promise<PublishBacklogResponse> {
    const response = await axios.post(`${this.baseURL}/api/bmad/publish-backlog`, { sessionId, backlogJson });
    return response.data;
  }

  async getModels(): Promise<{ provider: string; models: ModelOption[]; agentModels: Record<string, string> }> {
    const response = await axios.get(`${this.baseURL}/api/config/models`);
    return response.data;
  }

  async getConfig(): Promise<AppConfig> {
    const response = await axios.get(`${this.baseURL}/api/config`);
    return response.data;
  }

  // ============================================
  // Local Initiatives (roadmap=none mode)
  // ============================================

  async getInitiatives(): Promise<(AirtableItem & { workflow?: { id: string; status: string; currentStage: string | null; summary: string | null } })[]> {
    const response = await axios.get(`${this.baseURL}/api/initiatives`);
    return response.data;
  }

  async createInitiative(title: string, description?: string): Promise<LocalInitiative> {
    const response = await axios.post(`${this.baseURL}/api/initiatives`, { title, description });
    return response.data;
  }

  async updateInitiative(id: string, title: string, description?: string): Promise<LocalInitiative> {
    const response = await axios.patch(`${this.baseURL}/api/initiatives/${id}`, { title, description });
    return response.data;
  }

  async deleteInitiative(id: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/initiatives/${id}`);
  }

  // ============================================
  // Quick Sessions
  // ============================================

  async getQuickItems(): Promise<QuickItem[]> {
    const response = await axios.get(`${this.baseURL}/api/bmad/quick-items`);
    return response.data.items;
  }

  async createQuickItem(): Promise<QuickItem> {
    const response = await axios.post(`${this.baseURL}/api/bmad/quick-items`);
    return response.data;
  }

  async deleteQuickItem(itemId: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/bmad/quick-items/${itemId}`);
  }

  async selectMenuItem(
    sessionId: string,
    menuCode: string,
    onChunk: (content: string) => void,
    onComplete: () => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/bmad/menu-select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, menuCode, model }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      await this.readSSEStream(response, onChunk, onComplete, onError);
    } else {
      const data = await response.json();
      if (data.type === 'chat') {
        onComplete();
      }
    }
  }

  async sendBmadMessage(
    sessionId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (content?: string) => void,
    onError: (error: string) => void,
    skipHistory?: boolean,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/bmad/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message, skipHistory, model }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await this.readSSEStream(response, onChunk, (content) => onComplete(content), onError);
  }

  // ============================================
  // Decision Log
  // ============================================

  async getDecisionLogSession(): Promise<DecisionLogSession> {
    const response = await axios.get(`${this.baseURL}/api/decision-log/session`);
    return response.data;
  }

  async sendDecisionLogMessage(
    sessionId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (content?: string) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/decision-log/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message, model }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await this.readSSEStream(response, onChunk, (content) => onComplete(content), onError);
  }

  async logDecision(content: string, title?: string): Promise<{ success: boolean; yearMonth: string }> {
    const response = await axios.post(`${this.baseURL}/api/decision-log/log-decision`, { content, title });
    return response.data;
  }

  async getDecisionLogFile(yearMonth: string): Promise<{ content: string | null }> {
    const response = await axios.get(`${this.baseURL}/api/decision-log/log/${yearMonth}`);
    return response.data;
  }

  async getDecisionLogIndex(): Promise<{ content: string | null }> {
    const response = await axios.get(`${this.baseURL}/api/decision-log/index`);
    return response.data;
  }

  async getDecisionLogMonths(): Promise<{ months: MonthEntry[] }> {
    const response = await axios.get(`${this.baseURL}/api/decision-log/months`);
    return response.data;
  }

  // ============================================
  // Context Keeper
  // ============================================

  async getContextStatus(): Promise<ContextStatusResponse> {
    const response = await axios.get(`${this.baseURL}/api/context/status`);
    return response.data;
  }

  async checkContextChanges(): Promise<{ changes: StatusChange[]; pendingCount: number }> {
    const response = await axios.post(`${this.baseURL}/api/context/check`);
    return response.data;
  }

  async runContextReview(model?: string): Promise<{ sessionId: string; proposals: ContextChangeProposal[] }> {
    const response = await axios.post(`${this.baseURL}/api/context/review`, { model });
    return response.data;
  }

  async getContextProposals(): Promise<{ proposals: ContextChangeProposal[] }> {
    const response = await axios.get(`${this.baseURL}/api/context/proposals`);
    return response.data;
  }

  async confirmContextProposal(id: number, proposedText?: string): Promise<{ success: boolean; pendingCount: number }> {
    const response = await axios.patch(`${this.baseURL}/api/context/proposal/${id}`, {
      action: 'confirm',
      proposedText,
    });
    return response.data;
  }

  async dismissContextProposal(id: number): Promise<{ success: boolean; pendingCount: number }> {
    const response = await axios.patch(`${this.baseURL}/api/context/proposal/${id}`, {
      action: 'dismiss',
    });
    return response.data;
  }

  async seedContextTestData(): Promise<{ seeded: number }> {
    const response = await axios.post(`${this.baseURL}/api/context/seed-test-data`);
    return response.data;
  }

  // ============================================
  // Workflow (Epic 4 + 7)
  // ============================================

  // ============================================
  // Coordinator Planning (pre-workflow)
  // ============================================

  /**
   * POST /api/workflow/coordinator/open
   * Opens a planning session. Coordinator asks clarifying questions.
   * First SSE event is { type: 'session', sessionId }.
   * Done event content may contain COORDINATOR_READY marker.
   */
  async openCoordinatorPlanning(
    goal: string,
    onSessionId: (id: string) => void,
    onChunk: (content: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    model?: string,
    onReplace?: (cleanedContent: string) => void,
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/workflow/coordinator/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, model }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error ?? `HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('No response body');
    let lineBuffer = '';
    let fullContent = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'session') onSessionId(data.sessionId);
            else if (data.type === 'content') { fullContent += data.content; onChunk(data.content); }
            else if (data.type === 'replace') { fullContent = data.content; onReplace?.(data.content); }
            else if (data.type === 'done') onComplete(data.content ?? fullContent);
            else if (data.type === 'error') onError(data.error);
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async replyToCoordinator(
    sessionId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    model?: string,
    onReplace?: (cleanedContent: string) => void,
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/workflow/coordinator/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message, model }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error ?? `HTTP ${response.status}`);
    }
    await this.readSSEStream(response, onChunk, (content) => onComplete(content ?? ''), onError, onReplace);
  }

  /**
   * POST /api/workflow/start — creates workflow and advances to first stage.
   * Returns { workflowId, stage, sessionId, complete, stages }.
   */
  async startWorkflow(
    itemId: string | undefined,
    goal: string,
    enrichedContext?: string,
    stageSequence?: string[],
    policyOverrides?: Record<string, string>,
    planningSessionId?: string | null
  ): Promise<{ workflowId: string; stage: string | null; sessionId: string | null; complete: boolean; stages: string[] }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/start`, {
      itemId, goal, enrichedContext, stageSequence, policyOverrides,
      ...(planningSessionId ? { planningSessionId } : {}),
    });
    return response.data;
  }

  async getWorkflowStatus(workflowId: string) {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/status`);
    return response.data;
  }

  async getCoordinatorSession(sessionId: string): Promise<{
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    type: 'pre_workflow' | 'stage_briefing';
    nextStage: string | null;
    workflowId: string | null;
  } | null> {
    try {
      const response = await axios.get(`${this.baseURL}/api/workflow/coordinator/session/${sessionId}`);
      return response.data;
    } catch {
      return null;
    }
  }


  async getWorkflowEvents(workflowId: string, sinceId?: number): Promise<{ events: Array<{
    id: number; workflow_id: string; event_type: string; stage: string | null;
    summary: string; details: string | null; created_at: number;
  }> }> {
    const params = sinceId ? `?since=${sinceId}` : '';
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/events${params}`);
    return response.data;
  }

  async getWorkflowList(): Promise<{ workflows: Array<{
    id: string; item_id: string; goal: string; summary: string | null; status: string;
    current_stage: string | null; stage_sequence: string;
    created_at: number; updated_at: number; checkpoint_count: number;
  }> }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/list/all`);
    return response.data;
  }

  async sendWorkflowMessage(
    workflowId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/workflow/${workflowId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error ?? `HTTP ${response.status}`);
    }
    await this.readSSEStream(response, onChunk, (content) => onComplete(content ?? ''), onError);
  }

  async reiterateWorkflow(workflowId: string, fromStage: string, feedback: string) {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/reiterate`, { fromStage, feedback });
    return response.data;
  }

  async retryWorkflowStage(workflowId: string) {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/retry`);
    return response.data;
  }

  async pushToBoard(workflowId: string): Promise<{ epicId: number; epicUrl: string; featureCount: number; storyCount: number }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/push-to-board`);
    return response.data;
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/workflow/${workflowId}`);
  }

  async getWorkflowCheckpoints(workflowId: string) {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/checkpoints`);
    return response.data;
  }

  async resolveCheckpoint(
    checkpointId: number,
    status: 'approved' | 'rejected' | 'revised',
    feedback?: string,
    enrichedContext?: string
  ) {
    const response = await axios.post(`${this.baseURL}/api/workflow/checkpoint/resolve`, {
      checkpointId,
      status,
      feedback,
      enrichedContext,
    });
    return response.data;
  }

  /**
   * POST /api/workflow/complete-stage — submits the current stage for checkpoint review.
   */
  async completeStage(workflowId: string) {
    const response = await axios.post(`${this.baseURL}/api/workflow/complete-stage`, { workflowId });
    return response.data;
  }

  /**
   * GET /api/bmad/session/:sessionId — fetch existing session messages.
   */
  async getSessionMessages(sessionId: string): Promise<Array<{ role: string; content: string; sequence: number }>> {
    const response = await axios.get(`${this.baseURL}/api/bmad/session/${sessionId}`);
    // The endpoint returns { session, messages } or similar — extract messages
    return response.data.messages ?? [];
  }

  // ============================================
  // Context Diffs (Story 6.2 + 7.4)
  // ============================================

  async getArtifactContent(artifactId: number): Promise<{ content: string; type: string }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/artifact/${artifactId}/content`);
    return response.data;
  }

  async getPendingContextDiffs() {
    const response = await axios.get(`${this.baseURL}/api/context-diffs/pending`);
    return response.data as { diffs: Array<{ id: number; workflow_id: string | null; file_name: string; diff_content: string; rationale: string; status: string; created_at: number }> };
  }

  async approveContextDiff(id: number, approvedBy = 'human') {
    const response = await axios.post(`${this.baseURL}/api/context-diffs/${id}/approve`, { approvedBy });
    return response.data as { ok: boolean; fileName: string; content: string };
  }

  async rejectContextDiff(id: number) {
    const response = await axios.post(`${this.baseURL}/api/context-diffs/${id}/reject`);
    return response.data as { ok: boolean };
  }

  // ============================================
  // Context Files (editor)
  // ============================================

  async getContextFiles(): Promise<{ files: Array<{
    fileName: string; label: string; description: string;
    hasTemplate: boolean; content: string; templateContent?: string;
  }> }> {
    const response = await axios.get(`${this.baseURL}/api/context-files`);
    return response.data;
  }

  async saveContextFile(fileName: string, content: string): Promise<{ ok: boolean }> {
    const response = await axios.put(`${this.baseURL}/api/context-files/${fileName}`, { content });
    return response.data;
  }

  // ============================================
  // Template Files (editor)
  // ============================================

  async getTemplateFiles(): Promise<{ files: Array<{
    fileName: string; label: string; description: string; content: string;
  }> }> {
    const response = await axios.get(`${this.baseURL}/api/template-files`);
    return response.data;
  }

  async saveTemplateFile(fileName: string, content: string): Promise<{ ok: boolean }> {
    const response = await axios.put(`${this.baseURL}/api/template-files/${fileName}`, { content });
    return response.data;
  }

  // ============================================
  // Utility
  // ============================================

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseURL}/health`, { timeout: 5000 });
      return response.data?.status === 'healthy';
    } catch {
      return false;
    }
  }

  private async readSSEStream(
    response: globalThis.Response,
    onChunk: (content: string) => void,
    onComplete: (content?: string) => void,
    onError: (error: string) => void,
    onReplace?: (cleanedContent: string) => void,
  ): Promise<void> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    // Buffer incomplete lines across network chunks. SSE events can arrive split
    // across chunks — without buffering, the JSON parse fails silently and
    // onComplete is never called, leaving the UI stuck in the streaming state.
    let lineBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });

        // Only process complete lines; keep the trailing incomplete fragment
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'content') {
                onChunk(data.content);
              } else if (data.type === 'replace') {
                onReplace?.(data.content);
              } else if (data.type === 'done') {
                onComplete(data.content);
              } else if (data.type === 'error') {
                onError(data.error);
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const api = new APIClient();
