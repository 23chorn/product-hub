import axios from 'axios';
import { API_BASE_URL, apiError, readSSEStream } from './base';

export const workflowApi = {
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
    const response = await fetch(`${API_BASE_URL}/api/workflow/coordinator/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, model }),
    });
    if (!response.ok) {
      throw apiError(await response.json().catch(() => ({})), response.status);
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
  },

  async replyToCoordinator(
    sessionId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    model?: string,
    onReplace?: (cleanedContent: string) => void,
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/workflow/coordinator/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message, model }),
    });
    if (!response.ok) {
      throw apiError(await response.json().catch(() => ({})), response.status);
    }
    await readSSEStream(response, onChunk, (content) => onComplete(content ?? ''), onError, onReplace);
  },

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
    planningSessionId?: string | null,
    kbQueries?: string[]
  ): Promise<{ workflowId: string; stage: string | null; sessionId: string | null; complete: boolean; stages: string[] }> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/start`, {
      itemId, goal, enrichedContext, stageSequence, policyOverrides,
      ...(planningSessionId ? { planningSessionId } : {}),
      ...(kbQueries && kbQueries.length > 0 ? { kbQueries } : {}),
    });
    return response.data;
  },

  async getWorkflowStatus(workflowId: string) {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/status`);
    return response.data;
  },

  async getCoordinatorSession(sessionId: string): Promise<{
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    type: 'pre_workflow' | 'stage_briefing';
    nextStage: string | null;
    workflowId: string | null;
  } | null> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/workflow/coordinator/session/${sessionId}`);
      return response.data;
    } catch {
      return null;
    }
  },

  async getWorkflowEvents(workflowId: string, sinceId?: number): Promise<{ events: Array<{
    id: number; workflow_id: string; event_type: string; stage: string | null;
    summary: string; details: string | null; created_at: number;
  }> }> {
    const params = sinceId ? `?since=${sinceId}` : '';
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/events${params}`);
    return response.data;
  },

  async getWorkflowList(): Promise<{ workflows: Array<{
    id: string; item_id: string; goal: string; summary: string | null; status: string;
    current_stage: string | null; stage_sequence: string;
    created_at: number; updated_at: number; checkpoint_count: number;
  }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/list/all`);
    return response.data;
  },

  async sendWorkflowMessage(
    workflowId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/workflow/${workflowId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model }),
    });
    if (!response.ok) {
      throw apiError(await response.json().catch(() => ({})), response.status);
    }
    await readSSEStream(response, onChunk, (content) => onComplete(content ?? ''), onError);
  },

  async retryWorkflowStage(workflowId: string) {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/retry`);
    return response.data;
  },

  async pushToBoard(workflowId: string): Promise<{
    epicId: number; epicUrl: string;
    featureCount?: number; storyCount?: number;
    created?: number; updated?: number; synced?: boolean;
  }> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/push-to-board`);
    return response.data;
  },

  async getAdoMappings(workflowId: string): Promise<{ hasMappings: boolean }> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/ado-mappings`);
      return response.data;
    } catch {
      return { hasMappings: false };
    }
  },

  async pushToTestPlans(workflowId: string): Promise<{
    planId: number; planUrl: string;
    created: number; updated: number; testCaseCount: number;
  }> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/push-to-test-plans`);
    return response.data;
  },

  async getQATestPlanMappings(workflowId: string): Promise<{ hasMappings: boolean }> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/qa-test-plan-mappings`);
      return response.data;
    } catch {
      return { hasMappings: false };
    }
  },

  async syncToWiki(workflowId: string, stages?: string[]): Promise<{
    synced: number;
    results: Array<{ stage: string; pageName: string; url: string }>;
  }> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/sync-to-wiki`, { stages });
    return response.data;
  },

  async getWorkflowArtifacts(workflowId: string): Promise<{
    artifacts: Array<{ id: number; type: string; stage: string | null; created_at: number }>;
  }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/artifacts`);
    return response.data;
  },

  async deleteWorkflow(workflowId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/workflow/${workflowId}`);
  },

  async getPipelineRun(workflowId: string): Promise<{
    id: number; workflow_id: string; stage: string; status: string;
    pr_url: string | null; branch: string | null; pipeline_id: string | null;
    test_results: string | null; created_at: number; updated_at: number;
  } | null> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/pipeline-runs`);
      return response.data.run;
    } catch { return null; }
  },

  async getTicketContext(workflowId: string, workItemId?: number): Promise<{ prompt: string; title: string }> {
    const params = workItemId ? `?workItemId=${workItemId}` : '';
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/ticket-context${params}`);
    return response.data;
  },

  async getPipelineDemoData(workflowId: string): Promise<{ summary: string; testCases: any[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/pipeline-demo`);
    return response.data;
  },

  async cancelWorkflow(workflowId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/cancel`);
  },

  async restartWorkflow(workflowId: string): Promise<any> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/restart`);
    return response.data;
  },

  async getPipelineMedia(workflowId: string): Promise<Array<{ type: 'video' | 'screenshot'; url: string; name: string }>> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/pipeline-media/${workflowId}`);
      return response.data ?? [];
    } catch { return []; }
  },

  async getWorkflowAudit(workflowId: string): Promise<{ audit: Array<{
    id: number; checkpoint_id: number; stage: string;
    user_name: string; user_email: string; action: string;
    notes: string | null; created_at: number;
  }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/audit`);
    return response.data;
  },

  async getMyPendingCount(): Promise<{ count: number }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/my-pending-count`);
    return response.data;
  },

  async getWorkflowListFiltered(needsApproval?: boolean): Promise<{ workflows: any[] }> {
    const params = needsApproval ? '?needs_approval=true' : '';
    const response = await axios.get(`${API_BASE_URL}/api/workflow/list/all${params}`);
    return response.data;
  },
};
