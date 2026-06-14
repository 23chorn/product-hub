import axios from 'axios';
import { API_BASE_URL } from './base';
import type { SkillVersion } from './types';

export const skillsApi = {
  // ── Agent catalog ──
  async getPersonas(): Promise<Array<{
    name: string; displayName: string; agentType: string; skillName: string;
    content: string; frontmatter: string;
  }>> {
    const response = await axios.get(`${API_BASE_URL}/api/agents/personas`);
    return response.data;
  },

  // ── Skill registry ──
  async getSkills(discipline?: string): Promise<SkillVersion[]> {
    const params = discipline ? `?discipline=${encodeURIComponent(discipline)}` : '';
    const response = await axios.get(`${API_BASE_URL}/api/skills${params}`);
    return response.data;
  },

  async getSkill(name: string): Promise<SkillVersion> {
    const response = await axios.get(`${API_BASE_URL}/api/skills/${encodeURIComponent(name)}`);
    return response.data;
  },

  async getSkillVersions(name: string): Promise<SkillVersion[]> {
    const response = await axios.get(`${API_BASE_URL}/api/skills/${encodeURIComponent(name)}/versions`);
    return response.data;
  },

  async publishSkill(skill: {
    skill_name: string;
    agent_type?: string;
    version: string;
    owner_team?: string;
    discipline?: string;
    persona_prompt?: string;
    output_format_template?: string | null;
    development_context?: string | null;
    tool_definitions?: string | null;
  }): Promise<{ id: number; skill_name: string; version: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/skills`, skill);
    return response.data;
  },

  async deprecateSkill(name: string, version: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/skills/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
  },
};
