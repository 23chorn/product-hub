import axios from 'axios';
import type { CompletedInitiativeSummary, CompletedInitiativeDetail } from '@pap/shared';
import { API_BASE_URL } from './base';

export const completedInitiativesApi = {
  async getCompletedInitiatives(): Promise<CompletedInitiativeSummary[]> {
    const response = await axios.get(`${API_BASE_URL}/api/completed-initiatives`);
    return response.data;
  },

  async getCompletedInitiative(itemId: string): Promise<CompletedInitiativeDetail> {
    const response = await axios.get(`${API_BASE_URL}/api/completed-initiatives/${itemId}`);
    return response.data;
  },

  async refreshCompletedInitiative(itemId: string): Promise<CompletedInitiativeDetail & { refreshed: number; notFound: number }> {
    const response = await axios.post(`${API_BASE_URL}/api/completed-initiatives/${itemId}/refresh`);
    return response.data;
  },
};
