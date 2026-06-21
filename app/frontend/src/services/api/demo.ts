import axios from 'axios';
import { API_BASE_URL } from './base';

export const demoApi = {
  async triggerDemoWebhook(forceIndex?: number): Promise<{ workflowId: string; itemId: string; initiative: string; stages: string[] }> {
    const response = await axios.post(`${API_BASE_URL}/api/demo/webhook/trigger`, forceIndex !== undefined ? { forceIndex } : {});
    return response.data;
  },
};
