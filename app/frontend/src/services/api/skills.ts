import axios from 'axios';
import { API_BASE_URL } from './base';
import type { AgentFile, AgentFileContent } from './types';

export const skillsApi = {
  async getSkills(): Promise<AgentFile[]> {
    const response = await axios.get(`${API_BASE_URL}/api/skills`);
    return response.data;
  },

  async getSkill(key: string): Promise<AgentFileContent> {
    const response = await axios.get(`${API_BASE_URL}/api/skills/${encodeURIComponent(key)}`);
    return response.data;
  },

  async saveSkill(key: string, content: string): Promise<void> {
    await axios.put(`${API_BASE_URL}/api/skills/${encodeURIComponent(key)}`, { content });
  },
};
