import axios from 'axios';
import type { DiscoverySource, DiscoverySourceType, DiscoveryOpportunity, DiscoveryOpportunityStatus } from '@pap/shared';
import { API_BASE_URL } from './base';

export const discoveryApi = {
  async getDiscoverySources(): Promise<DiscoverySource[]> {
    const response = await axios.get(`${API_BASE_URL}/api/discovery/sources`);
    return response.data.sources;
  },

  async createDiscoverySource(sourceType: DiscoverySourceType, title: string, content: string): Promise<DiscoverySource> {
    const response = await axios.post(`${API_BASE_URL}/api/discovery/sources`, { sourceType, title, content });
    return response.data.source;
  },

  async deleteDiscoverySource(id: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/discovery/sources/${id}`);
  },

  async runDiscovery(sourceIds: string[]): Promise<{ runId: string; opportunities: DiscoveryOpportunity[] }> {
    const response = await axios.post(`${API_BASE_URL}/api/discovery/run`, { sourceIds });
    return response.data;
  },

  async getDiscoveryOpportunities(status?: DiscoveryOpportunityStatus): Promise<DiscoveryOpportunity[]> {
    const response = await axios.get(`${API_BASE_URL}/api/discovery/opportunities`, { params: status ? { status } : undefined });
    return response.data.opportunities;
  },

  async dismissOpportunity(id: number): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/discovery/opportunities/${id}/dismiss`);
  },

  async promoteOpportunity(id: number): Promise<{ itemId: string; airtableId: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/discovery/opportunities/${id}/promote`);
    return response.data;
  },
};
