import axios from 'axios';
import type { CurrentUser } from '../../stores/authStore';
import { API_BASE_URL } from './base';

export const usersApi = {
  // ── Auth ──
  async getMe(): Promise<{ user: CurrentUser | null; noAuth?: boolean }> {
    const response = await axios.get(`${API_BASE_URL}/api/auth/me`);
    return response.data;
  },

  async login(username: string, password: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/auth/login`, { username, password });
  },

  async logout(): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/auth/logout`);
  },

  // ── User management (admin) ──
  async listUsers(): Promise<{ users: CurrentUser[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/users`);
    return response.data;
  },

  async createUser(data: {
    username: string; name: string; password: string;
    email?: string | null; is_admin?: boolean; slack_user_id?: string | null; roles?: string[];
  }): Promise<{ user: CurrentUser }> {
    const response = await axios.post(`${API_BASE_URL}/api/users`, data);
    return response.data;
  },

  async updateUser(id: number, data: Partial<{
    username: string; name: string; email: string | null; password: string;
    is_admin: boolean; slack_user_id: string | null; roles: string[];
  }>): Promise<{ user: CurrentUser }> {
    const response = await axios.put(`${API_BASE_URL}/api/users/${id}`, data);
    return response.data;
  },

  async deleteUser(id: number): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/users/${id}`);
  },

  async getRoles(): Promise<{ roles: Array<{ id: number; name: string; description: string | null }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/users/roles`);
    return response.data;
  },

  async getStageRoles(): Promise<{ stageRoles: Array<{ stage: string; role_name: string }> }> {
    const response = await axios.get(`${API_BASE_URL}/api/users/stage-roles`);
    return response.data;
  },

  async setStageRole(stage: string, role_name: string): Promise<void> {
    await axios.put(`${API_BASE_URL}/api/users/stage-roles`, { stage, role_name });
  },
};
