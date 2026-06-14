import axios from 'axios';
import { API_BASE_URL } from './base';

export const demoApi = {
  async triggerDemoWebhook(forceIndex?: number): Promise<{ workflowId: string; itemId: string; initiative: string; stages: string[] }> {
    const response = await axios.post(`${API_BASE_URL}/api/demo/webhook/trigger`, forceIndex !== undefined ? { forceIndex } : {});
    return response.data;
  },

  async generateDemoProject(workflowId: string): Promise<{ ok: boolean }> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/demo-project/generate`);
    return response.data;
  },

  async getDemoProjectStatus(workflowId: string): Promise<{ phase: string; message: string; projectPath?: string; error?: string }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/demo-project/status`);
    return response.data;
  },

  async getDemoProjectFiles(workflowId: string): Promise<{ files: string[]; projectDir?: string }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/demo-project/files`);
    return response.data;
  },

  async getDemoProjectFile(workflowId: string, filePath: string): Promise<{ content: string; path: string }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/demo-project/file`, {
      params: { path: filePath },
    });
    return response.data;
  },

  async quickTestDemoProject(feature?: string): Promise<{ workflowId: string; phase: string; projectPath: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/demo-project/quick-test`, { feature });
    return response.data;
  },

  async triggerDemoRun(workflowId: string): Promise<{ ok: boolean }> {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/demo-project/run`);
    return response.data;
  },

  async getDemoRunStatus(workflowId: string): Promise<{
    status: 'idle' | 'running' | 'passed' | 'failed';
    lines: Array<{ type: string; text: string; ts: number }>;
    exitCode?: number;
    startedAt?: number;
    finishedAt?: number;
    configured: boolean;
  }> {
    const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/demo-project/run/status`);
    return response.data;
  },
};
