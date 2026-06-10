import axios from 'axios';
import type { AirtableItem, AppConfig, LocalInitiative, ModelOption, DecisionLogSession, MonthEntry } from '@pap/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface SkillVersion {
  id: number;
  skill_name: string;
  agent_type: string;
  version: string;
  owner_team: string;
  discipline: string;
  persona_prompt: string;
  output_format_template: string | null;
  stage_brief_label: string | null;
  stage_brief_format: string | null;
  development_context: string | null;
  tool_definitions: string | null;
  created_at: number;
  deprecated_at: number | null;
}

class APIClient {
  private baseURL: string;

  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // ============================================
  // Airtable
  // ============================================

  async getItemsPipelineReady(): Promise<AirtableItem[]> {
    const response = await axios.get(`${this.baseURL}/api/prd/items/pipelineReady`);
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

  async getSettings(): Promise<any> {
    const response = await axios.get(`${this.baseURL}/api/settings`);
    return response.data;
  }

  async updateSettings(settings: any): Promise<void> {
    await axios.put(`${this.baseURL}/api/settings`, settings);
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

  async deleteInitiative(id: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/initiatives/${id}`);
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

  async getDecisionLogMonths(): Promise<{ months: MonthEntry[] }> {
    const response = await axios.get(`${this.baseURL}/api/decision-log/months`);
    return response.data;
  }

  // ── Workflow ──────────────────────────────────────────────────────────────────

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
    planningSessionId?: string | null,
    kbQueries?: string[]
  ): Promise<{ workflowId: string; stage: string | null; sessionId: string | null; complete: boolean; stages: string[] }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/start`, {
      itemId, goal, enrichedContext, stageSequence, policyOverrides,
      ...(planningSessionId ? { planningSessionId } : {}),
      ...(kbQueries && kbQueries.length > 0 ? { kbQueries } : {}),
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

  async extendWorkflow(workflowId: string, stages: string[]) {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/extend`, { stages });
    return response.data;
  }

  async retryWorkflowStage(workflowId: string) {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/retry`);
    return response.data;
  }

  async pushToBoard(workflowId: string): Promise<{
    epicId: number; epicUrl: string;
    featureCount?: number; storyCount?: number;
    created?: number; updated?: number; synced?: boolean;
  }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/push-to-board`);
    return response.data;
  }

  async getAdoMappings(workflowId: string): Promise<{ hasMappings: boolean }> {
    try {
      const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/ado-mappings`);
      return response.data;
    } catch {
      return { hasMappings: false };
    }
  }

  async pushToTestPlans(workflowId: string): Promise<{
    planId: number; planUrl: string;
    created: number; updated: number; testCaseCount: number;
  }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/push-to-test-plans`);
    return response.data;
  }

  async getQATestPlanMappings(workflowId: string): Promise<{ hasMappings: boolean }> {
    try {
      const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/qa-test-plan-mappings`);
      return response.data;
    } catch {
      return { hasMappings: false };
    }
  }

  async syncToWiki(workflowId: string, stages?: string[]): Promise<{
    synced: number;
    results: Array<{ stage: string; pageName: string; url: string }>;
  }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/sync-to-wiki`, { stages });
    return response.data;
  }

  async getWorkflowArtifacts(workflowId: string): Promise<{
    artifacts: Array<{ id: number; type: string; stage: string | null; created_at: number }>;
  }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/artifacts`);
    return response.data;
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/workflow/${workflowId}`);
  }

  // ============================================
  // Change Requests
  // ============================================

  async createChangeRequest(workflowId: string, type: string, description: string) {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/change-request`, { type, description });
    return response.data;
  }

  async assessChangeRequest(
    crId: number,
    onChunk: (content: string) => void,
    onAssessment: (assessment: { affected_stages: string[]; summary: string }) => void,
    onComplete: () => void,
    onError: (error: string) => void,
    onReplace?: (cleanedContent: string) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/change-request/${crId}/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error ?? `HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('No response body');
    let lineBuffer = '';
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
            if (data.type === 'content') onChunk(data.content);
            else if (data.type === 'replace') onReplace?.(data.content);
            else if (data.type === 'assessment') onAssessment(data.assessment);
            else if (data.type === 'done') onComplete();
            else if (data.type === 'error') onError(data.error);
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async executeChangeRequest(crId: number, stages: string[]) {
    const response = await axios.post(`${this.baseURL}/api/change-request/${crId}/execute`, { stages });
    return response.data;
  }

  async cancelChangeRequest(crId: number) {
    const response = await axios.post(`${this.baseURL}/api/change-request/${crId}/cancel`);
    return response.data;
  }

  async getArtifactVersionInfo(artifactId: number): Promise<{ change_request_id: number; version: number; stage: string } | null> {
    const response = await axios.get(`${this.baseURL}/api/workflow/artifact/${artifactId}/version-info`);
    return response.data?.versionInfo ?? null;
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

  // ── Context Diffs ─────────────────────────────────────────────────────────────

  async getArtifactContent(artifactId: number): Promise<{ content: string; type: string }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/artifact/${artifactId}/content`);
    return response.data;
  }

  async saveArtifactContent(
    artifactId: number,
    content: string,
    checkpointId?: number
  ): Promise<{ ok: boolean; workflowStatus?: any; warning?: string }> {
    const response = await axios.put(
      `${this.baseURL}/api/workflow/artifact/${artifactId}/content`,
      { content, checkpointId }
    );
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

  async createContextFile(label: string, description: string, content: string): Promise<{ ok: boolean; fileName: string; label: string }> {
    const response = await axios.post(`${this.baseURL}/api/context-files`, { label, description, content });
    return response.data;
  }

  async saveContextFile(fileName: string, content: string): Promise<{ ok: boolean }> {
    const response = await axios.put(`${this.baseURL}/api/context-files/${fileName}`, { content });
    return response.data;
  }

  async getContextFileVersions(fileName: string): Promise<{ versions: Array<{ id: number; file_name: string; content: string; created_at: number }> }> {
    const response = await axios.get(`${this.baseURL}/api/context-files/${encodeURIComponent(fileName)}/versions`);
    return response.data;
  }

  // ============================================
  // Skill Registry
  // ============================================

  async getSkills(discipline?: string): Promise<SkillVersion[]> {
    const params = discipline ? `?discipline=${encodeURIComponent(discipline)}` : '';
    const response = await axios.get(`${this.baseURL}/api/skills${params}`);
    return response.data;
  }

  async getSkill(name: string): Promise<SkillVersion> {
    const response = await axios.get(`${this.baseURL}/api/skills/${encodeURIComponent(name)}`);
    return response.data;
  }

  async getSkillVersions(name: string): Promise<SkillVersion[]> {
    const response = await axios.get(`${this.baseURL}/api/skills/${encodeURIComponent(name)}/versions`);
    return response.data;
  }

  async publishSkill(skill: {
    skill_name: string;
    agent_type?: string;
    version: string;
    owner_team?: string;
    discipline?: string;
    persona_prompt?: string;
    output_format_template?: string | null;
    development_context?: string | null;
    tool_definitions?: string | null;
  }): Promise<{ id: number; skill_name: string; version: string }> {
    const response = await axios.post(`${this.baseURL}/api/skills`, skill);
    return response.data;
  }

  async deprecateSkill(name: string, version: string): Promise<void> {
    await axios.delete(`${this.baseURL}/api/skills/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
  }

  // ============================================
  // Agent Personas (file-based)
  // ============================================

  async getPersonas(): Promise<Array<{
    name: string; displayName: string; agentType: string;
    content: string; frontmatter: string;
  }>> {
    const response = await axios.get(`${this.baseURL}/api/agents/personas`);
    return response.data;
  }

  async savePersona(name: string, content: string): Promise<{ ok: boolean }> {
    const response = await axios.put(`${this.baseURL}/api/agents/personas/${encodeURIComponent(name)}`, { content });
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
  // ============================================
  // Prototypes
  // ============================================

  async getDesignSystem(): Promise<{ tokens: string; utilities: string; tailwindConfig: string } | null> {
    try {
      const response = await axios.get(`${this.baseURL}/api/prototype/design-system`);
      return response.data;
    } catch {
      return null;
    }
  }

  async getPrototype(workflowId: string): Promise<{
    title: string; description: string; screens: string[];
    entryScreen: string; files: Record<string, string>;
  } | null> {
    try {
      const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/prototype`);
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Generate a prototype via SSE stream.
   * Accumulates raw text and attempts client-side recovery if server parsing fails.
   */
  async generatePrototype(
    workflowId: string,
    scope: string | undefined,
    callbacks: {
      onContent: (text: string) => void;
      onPrototype: (prototype: any) => void;
      onError: (error: string) => void;
      onDone: () => void;
    }
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/workflow/${workflowId}/prototype/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });

    if (!response.ok || !response.body) {
      callbacks.onError('Failed to start prototype generation');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawAccumulator = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content') {
              rawAccumulator += event.content;
              callbacks.onContent(event.content);
            } else if (event.type === 'prototype') {
              callbacks.onPrototype(event.prototype);
            } else if (event.type === 'parse_failed') {
              try {
                const repaired = await this.parsePrototypeRaw(workflowId, rawAccumulator);
                if (repaired) callbacks.onPrototype(repaired);
              } catch { /* repair failed */ }
            } else if (event.type === 'error') {
              callbacks.onError(event.error);
            } else if (event.type === 'done') {
              callbacks.onDone();
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Revise a prototype with feedback. Same SSE pattern as generatePrototype.
   */
  async revisePrototype(
    workflowId: string,
    prototype: any,
    feedback: string,
    callbacks: {
      onContent: (text: string) => void;
      onPrototype: (prototype: any) => void;
      onError: (error: string) => void;
      onDone: () => void;
    }
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/workflow/${workflowId}/prototype/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prototype, feedback }),
    });

    if (!response.ok || !response.body) {
      callbacks.onError('Failed to start prototype revision');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawAccumulator = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content') {
              rawAccumulator += event.content;
              callbacks.onContent(event.content);
            } else if (event.type === 'prototype') {
              callbacks.onPrototype(event.prototype);
            } else if (event.type === 'parse_failed') {
              try {
                const repaired = await this.parsePrototypeRaw(workflowId, rawAccumulator);
                if (repaired) callbacks.onPrototype(repaired);
              } catch { /* repair failed */ }
            } else if (event.type === 'error') {
              callbacks.onError(event.error);
            } else if (event.type === 'done') {
              callbacks.onDone();
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async parsePrototypeRaw(workflowId: string, raw: string): Promise<any | null> {
    try {
      const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/prototype/parse`, { raw });
      return response.data;
    } catch {
      return null;
    }
  }

  // ============================================
  // Quick Ticket
  // ============================================

  async estimateTicket(
    title: string,
    description: string | undefined,
    onChunk: (content: string) => void,
    onResult: (result: { story: any; aiEstimateDevHours: number | null }) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/tickets/format-and-estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, model }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('No response body');

    let lineBuffer = '';
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
            if (data.type === 'content') onChunk(data.content);
            else if (data.type === 'done') onResult({ story: data.story, aiEstimateDevHours: data.aiEstimateDevHours });
            else if (data.type === 'error') onError(data.error);
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async triggerAiCoding(workflowId: string): Promise<{
    epicId: number; epicUrl: string; taggedCount: number; pipelineRunId?: number; pipelineUrl?: string; demo?: boolean;
  }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/trigger-ai-coding`);
    return response.data;
  }

  async getPipelineRun(workflowId: string): Promise<{
    id: number; workflow_id: string; stage: string; status: string;
    pr_url: string | null; branch: string | null; pipeline_id: string | null;
    test_results: string | null; created_at: number; updated_at: number;
  } | null> {
    try {
      const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/pipeline-runs`);
      return response.data.run;
    } catch { return null; }
  }

  async getTicketContext(workflowId: string, workItemId?: number): Promise<{ prompt: string; title: string }> {
    const params = workItemId ? `?workItemId=${workItemId}` : '';
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/ticket-context${params}`);
    return response.data;
  }

  async getAiCodingStatus(workflowId: string): Promise<{
    triggered: boolean; triggeredAt?: number; epicId?: number; epicUrl?: string; pipelineRunId?: number; demo?: boolean;
  } | null> {
    try {
      const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/ai-coding/status`);
      return response.data;
    } catch { return null; }
  }

  async getPipelineDemoData(workflowId: string): Promise<{ summary: string; testCases: any[] }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/pipeline-demo`);
    return response.data;
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    await axios.post(`${this.baseURL}/api/workflow/${workflowId}/cancel`);
  }

  async restartWorkflow(workflowId: string): Promise<any> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/restart`);
    return response.data;
  }

  async getPipelineMedia(workflowId: string): Promise<Array<{ type: 'video' | 'screenshot'; url: string; name: string }>> {
    try {
      const response = await axios.get(`${this.baseURL}/api/pipeline-media/${workflowId}`);
      return response.data ?? [];
    } catch { return []; }
  }

  async triggerDemoWebhook(forceIndex?: number): Promise<{ workflowId: string; itemId: string; initiative: string; stages: string[] }> {
    const response = await axios.post(`${this.baseURL}/api/demo/webhook/trigger`, forceIndex !== undefined ? { forceIndex } : {});
    return response.data;
  }

  // ============================================
  // Demo Project
  // ============================================

  async generateDemoProject(workflowId: string): Promise<{ ok: boolean }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/demo-project/generate`);
    return response.data;
  }

  async getDemoProjectStatus(workflowId: string): Promise<{ phase: string; message: string; projectPath?: string; error?: string }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/demo-project/status`);
    return response.data;
  }

  async getDemoProjectFiles(workflowId: string): Promise<{ files: string[]; projectDir?: string }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/demo-project/files`);
    return response.data;
  }

  async getDemoProjectFile(workflowId: string, filePath: string): Promise<{ content: string; path: string }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/demo-project/file`, {
      params: { path: filePath },
    });
    return response.data;
  }

  async quickTestDemoProject(feature?: string): Promise<{ workflowId: string; phase: string; projectPath: string }> {
    const response = await axios.post(`${this.baseURL}/api/demo-project/quick-test`, { feature });
    return response.data;
  }

  async triggerDemoRun(workflowId: string): Promise<{ ok: boolean }> {
    const response = await axios.post(`${this.baseURL}/api/workflow/${workflowId}/demo-project/run`);
    return response.data;
  }

  async getDemoRunStatus(workflowId: string): Promise<{
    status: 'idle' | 'running' | 'passed' | 'failed';
    lines: Array<{ type: string; text: string; ts: number }>;
    exitCode?: number;
    startedAt?: number;
    finishedAt?: number;
    configured: boolean;
  }> {
    const response = await axios.get(`${this.baseURL}/api/workflow/${workflowId}/demo-project/run/status`);
    return response.data;
  }

  async pushTicketToAdo(ticket: {
    title: string;
    persona?: string;
    goal?: string;
    benefit?: string;
    acceptanceCriteria?: string[];
    storyPoints?: number;
    aiEstimateDevHours?: number;
  }): Promise<{ id: number; url: string }> {
    const response = await axios.post(`${this.baseURL}/api/tickets/push-to-ado`, ticket);
    return response.data;
  }

}

export const api = new APIClient();
