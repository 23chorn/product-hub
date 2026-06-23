import axios from 'axios';
import { API_BASE_URL } from './base';
import type { KbRepo, KbFileListItem, KbFile, KbComment, KbFileCommit } from '@pap/shared';

export const kbApi = {
  // ── Repos (Knowledge Studio → Settings → Knowledge Repos) ──
  async listKbRepos(): Promise<{ repos: KbRepo[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/kb/repos`);
    return response.data;
  },

  async createKbRepo(label: string, repository: string, branch?: string, project?: string): Promise<{ repo: KbRepo; syncWarning?: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/kb/repos`, { label, repository, branch, project });
    return response.data;
  },

  async updateKbRepo(id: number, updates: { label?: string; branch?: string; project?: string }): Promise<{ repo: KbRepo }> {
    const response = await axios.patch(`${API_BASE_URL}/api/kb/repos/${id}`, updates);
    return response.data;
  },

  async deleteKbRepo(id: number): Promise<{ ok: boolean }> {
    const response = await axios.delete(`${API_BASE_URL}/api/kb/repos/${id}`);
    return response.data;
  },

  async syncKbRepo(id: number): Promise<{ added: number; updated: number; removed: number; invalidFrontmatterCount: number }> {
    const response = await axios.post(`${API_BASE_URL}/api/kb/repos/${id}/sync`);
    return response.data;
  },

  // ── Files (Knowledge Studio → Documentation Review) ──
  async listKbFiles(filters: { repoId?: number; owner?: string; status?: string; invalidFrontmatterOnly?: boolean } = {}): Promise<{ files: KbFileListItem[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/kb/files`, { params: filters });
    return response.data;
  },

  async getKbFile(id: number): Promise<{ file: KbFile; comments: KbComment[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/kb/files/${id}`);
    return response.data;
  },

  async reviewKbFileWithAI(id: number): Promise<{ comments: KbComment[] }> {
    const response = await axios.post(`${API_BASE_URL}/api/kb/files/${id}/review`);
    return response.data;
  },

  async getKbFileHistory(id: number): Promise<{ commits: KbFileCommit[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/kb/files/${id}/history`);
    return response.data;
  },

  async getKbFileVersion(id: number, commitId: string): Promise<{ content: string; commitId: string }> {
    const response = await axios.get(`${API_BASE_URL}/api/kb/files/${id}/version/${commitId}`);
    return response.data;
  },

  // ── Comments ──
  async addKbComment(fileId: number, body: string, quote?: string): Promise<KbComment> {
    const response = await axios.post(`${API_BASE_URL}/api/kb/files/${fileId}/comments`, { body, quote });
    return response.data;
  },

  async setKbCommentStatus(commentId: number, status: 'open' | 'resolved'): Promise<KbComment> {
    const response = await axios.patch(`${API_BASE_URL}/api/kb/comments/${commentId}`, { status });
    return response.data;
  },
};
