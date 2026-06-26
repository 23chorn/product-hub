import axios from 'axios';
import type { AirtableItem, LocalInitiative } from '@pap/shared';
import { API_BASE_URL } from './base';

export const initiativesApi = {
  async getInitiatives(): Promise<(AirtableItem & { workflow?: { id: string; status: string; currentStage: string | null; summary: string | null; pendingStage?: string | null; pendingApprovals?: Array<{ stage: string; roles: string[] }>; isDemo?: boolean; updatedAt?: number } })[]> {
    const response = await axios.get(`${API_BASE_URL}/api/initiatives`);
    return response.data;
  },

  async createInitiative(title: string, description?: string, productArea?: string, strategicTheme?: string): Promise<LocalInitiative> {
    const response = await axios.post(`${API_BASE_URL}/api/initiatives`, { title, description, productArea, strategicTheme });
    return response.data;
  },

  async deleteInitiative(id: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/initiatives/${id}`);
  },
};
