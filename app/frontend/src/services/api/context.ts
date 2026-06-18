import axios from 'axios';
import { API_BASE_URL } from './base';
import type { ContextStatusResponse, StatusChange, ContextChangeProposal } from '@pap/shared';

export const contextApi = {
  // ── Airtable status sync (Context Keeper) ──
  async getContextKeeperStatus(): Promise<ContextStatusResponse> {
    const response = await axios.get(`${API_BASE_URL}/api/context/status`);
    return response.data;
  },

  async checkAirtableStatusChanges(): Promise<{ changes: StatusChange[]; pendingCount: number }> {
    const response = await axios.post(`${API_BASE_URL}/api/context/check`);
    return response.data;
  },

  async runContextKeeperReview(model?: string): Promise<{ sessionId: string; proposals: ContextChangeProposal[] }> {
    const response = await axios.post(`${API_BASE_URL}/api/context/review`, { model });
    return response.data;
  },

  async updateContextKeeperProposal(
    id: number,
    action: 'confirm' | 'dismiss',
    proposedText?: string
  ): Promise<{ success: boolean; pendingCount: number }> {
    const response = await axios.patch(`${API_BASE_URL}/api/context/proposal/${id}`, { action, proposedText });
    return response.data;
  },

  // ── Artifacts ──
  async getArtifactContent(artifactId: number): Promise<{ content: string; type: string }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/artifact/${artifactId}/content`);
    return response.data;
  },

  async saveArtifactContent(
    artifactId: number,
    content: string,
    checkpointId?: number
  ): Promise<{ ok: boolean; workflowStatus?: any; warning?: string }> {
    const response = await axios.put(
      `${API_BASE_URL}/api/workflow/artifact/${artifactId}/content`,
      { content, checkpointId }
    );
    return response.data;
  },

  // ── Context diffs ──
  async getPendingContextDiffs() {
    const response = await axios.get(`${API_BASE_URL}/api/context-diffs/pending`);
    return response.data as { diffs: Array<{ id: number; workflow_id: string | null; file_name: string; diff_content: string; rationale: string; status: string; created_at: number }> };
  },

  async approveContextDiff(id: number, approvedBy = 'human') {
    const response = await axios.post(`${API_BASE_URL}/api/context-diffs/${id}/approve`, { approvedBy });
    return response.data as { ok: boolean; fileName: string; content: string };
  },

  async rejectContextDiff(id: number) {
    const response = await axios.post(`${API_BASE_URL}/api/context-diffs/${id}/reject`);
    return response.data as { ok: boolean };
  },

  // ── Context files (editor) ──
  async getContextFiles(): Promise<{ files: Array<{
    fileName: string; label: string; description: string;
    hasTemplate: boolean; content: string; templateContent?: string;
    stages: string[] | null; editRoles: string[] | null;
  }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/context-files`);
    return response.data;
  },

  async createContextFile(label: string, description: string, content: string): Promise<{ ok: boolean; fileName: string; label: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/context-files`, { label, description, content });
    return response.data;
  },

  async saveContextFile(fileName: string, content: string): Promise<{ ok: boolean }> {
    const response = await axios.put(`${API_BASE_URL}/api/context-files/${fileName}`, { content });
    return response.data;
  },

  async getContextFileVersions(fileName: string): Promise<{ versions: Array<{ id: number; file_name: string; content: string; created_at: number }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/context-files/${encodeURIComponent(fileName)}/versions`);
    return response.data;
  },
};
