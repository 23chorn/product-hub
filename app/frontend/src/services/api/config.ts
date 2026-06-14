import axios from 'axios';
import type { AirtableItem, AppConfig, ModelOption } from '@pap/shared';
import { API_BASE_URL } from './base';

export const configApi = {
  async getItemsPipelineReady(): Promise<AirtableItem[]> {
    const response = await axios.get(`${API_BASE_URL}/api/prd/items/pipelineReady`);
    return response.data;
  },

  async getModels(): Promise<{ provider: string; models: ModelOption[]; agentModels: Record<string, string> }> {
    const response = await axios.get(`${API_BASE_URL}/api/config/models`);
    return response.data;
  },

  async getConfig(): Promise<AppConfig> {
    const response = await axios.get(`${API_BASE_URL}/api/config`);
    return response.data;
  },

  async getSettings(): Promise<any> {
    const response = await axios.get(`${API_BASE_URL}/api/settings`);
    return response.data;
  },

  async updateSettings(settings: any): Promise<void> {
    await axios.put(`${API_BASE_URL}/api/settings`, settings);
  },

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
      return response.data?.status === 'healthy';
    } catch {
      return false;
    }
  },
};
