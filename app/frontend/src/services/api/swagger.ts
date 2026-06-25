import axios from 'axios';
import { API_BASE_URL } from './base';
import type { SwaggerApiDoc } from '@pap/shared';

export const swaggerApi = {
  // ── Swagger/OpenAPI docs (Settings → API Docs — admin only for writes) ──
  async listSwaggerDocs(): Promise<{ docs: SwaggerApiDoc[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/swagger-docs`);
    return response.data;
  },

  async createSwaggerDoc(label: string, docUrl: string): Promise<{ doc: SwaggerApiDoc; syncWarning?: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/swagger-docs`, { label, docUrl });
    return response.data;
  },

  async updateSwaggerDoc(id: number, updates: { label?: string; active?: boolean }): Promise<{ doc: SwaggerApiDoc }> {
    const response = await axios.patch(`${API_BASE_URL}/api/swagger-docs/${id}`, updates);
    return response.data;
  },

  async deleteSwaggerDoc(id: number): Promise<{ ok: boolean }> {
    const response = await axios.delete(`${API_BASE_URL}/api/swagger-docs/${id}`);
    return response.data;
  },

  async syncSwaggerDoc(id: number): Promise<{ doc: SwaggerApiDoc }> {
    const response = await axios.post(`${API_BASE_URL}/api/swagger-docs/${id}/sync`);
    return response.data;
  },
};
