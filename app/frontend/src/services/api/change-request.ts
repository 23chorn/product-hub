import axios from 'axios';
import { API_BASE_URL, apiError } from './base';

export const changeRequestApi = {
  async createChangeRequest(workflowId: string, type: string, description: string) {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/change-request`, { type, description });
    return response.data;
  },

  async assessChangeRequest(
    crId: number,
    onChunk: (content: string) => void,
    onAssessment: (assessment: { affected_stages: string[]; summary: string }) => void,
    onComplete: () => void,
    onError: (error: string) => void,
    onReplace?: (cleanedContent: string) => void
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/change-request/${crId}/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw apiError(await response.json().catch(() => ({})), response.status);
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
  },

  async executeChangeRequest(crId: number, stages: string[]) {
    const response = await axios.post(`${API_BASE_URL}/api/change-request/${crId}/execute`, { stages });
    return response.data;
  },

  async cancelChangeRequest(crId: number) {
    const response = await axios.post(`${API_BASE_URL}/api/change-request/${crId}/cancel`);
    return response.data;
  },

  async getArtifactVersionInfo(artifactId: number): Promise<{ change_request_id: number; version: number; stage: string } | null> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/artifact/${artifactId}/version-info`);
    return response.data?.versionInfo ?? null;
  },

  async resolveCheckpoint(
    checkpointId: number,
    status: 'approved' | 'rejected' | 'revised',
    feedback?: string,
    enrichedContext?: string
  ) {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/checkpoint/resolve`, {
      checkpointId,
      status,
      feedback,
      enrichedContext,
    });
    return response.data;
  },
};
