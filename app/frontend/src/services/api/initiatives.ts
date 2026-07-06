import axios from 'axios';
import type { AirtableItem, InitiativeComment, LocalInitiative } from '@pap/shared';
import { API_BASE_URL } from './base';

export const initiativesApi = {
  async getInitiatives(includeArchived = false): Promise<(AirtableItem & { workflow?: { id: string; status: string; currentStage: string | null; summary: string | null; pendingStage?: string | null; pendingApprovals?: Array<{ stage: string; roles: string[] }>; isDemo?: boolean; updatedAt?: number } })[]> {
    const response = await axios.get(`${API_BASE_URL}/api/initiatives`, {
      params: includeArchived ? { includeArchived: 'true' } : undefined
    });
    return response.data;
  },

  async createInitiative(title: string, description?: string, productArea?: string, strategicTheme?: string): Promise<LocalInitiative> {
    const response = await axios.post(`${API_BASE_URL}/api/initiatives`, { title, description, productArea, strategicTheme });
    return response.data;
  },

  async deleteInitiative(id: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/initiatives/${id}`);
  },

  async updateItemDescription(id: string, description: string): Promise<{ success: boolean; description: string | null }> {
    const response = await axios.patch(`${API_BASE_URL}/api/initiatives/${id}/description`, { description });
    return response.data;
  },

  async archiveInitiative(id: string): Promise<{ ok: boolean }> {
    const response = await axios.post(`${API_BASE_URL}/api/initiatives/${id}/archive`);
    return response.data;
  },

  async unarchiveInitiative(id: string): Promise<{ ok: boolean }> {
    const response = await axios.post(`${API_BASE_URL}/api/initiatives/${id}/unarchive`);
    return response.data;
  },

  async getInitiativeAssignments(id: string): Promise<{ assignments: Array<{ id: number; name: string; username: string; slackUserId: string | null }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/initiatives/${id}/assignments`);
    return response.data;
  },

  async assignInitiative(id: string, userId: number): Promise<{ ok: boolean; userId: number; userName: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/initiatives/${id}/assignments`, { userId });
    return response.data;
  },

  async unassignInitiative(id: string, userId: number): Promise<{ ok: boolean }> {
    await axios.delete(`${API_BASE_URL}/api/initiatives/${id}/assignments/${userId}`);
    return { ok: true };
  },

  async getInitiativeComments(id: string): Promise<InitiativeComment[]> {
    const response = await axios.get(`${API_BASE_URL}/api/initiatives/${id}/comments`);
    return response.data;
  },

  async addInitiativeComment(id: string, comment: { body: string; type: 'note' | 'decision'; title?: string }): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/initiatives/${id}/comments`, comment);
  },

  async pauseInitiative(id: string, reason: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/initiatives/${id}/pause`, { body: reason });
  },

  async resumeInitiative(id: string, note = 'Initiative resumed.'): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/initiatives/${id}/resume`, { body: note });
  },
};
