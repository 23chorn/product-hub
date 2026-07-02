import axios from 'axios';
import { API_BASE_URL, apiError } from './base';

export interface QuickStory {
  title: string;
  persona: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string[];
  storyPoints: number;
}

export interface QuickFR {
  id: string;
  title: string;
  stories: QuickStory[];
}

export interface QuickFeatureResult {
  feature: { title: string; description: string };
  functionalRequirements: QuickFR[];
}

export interface QuickFeaturePushResult {
  featureId: number;
  featureUrl: string;
  stories: Array<{ id: number; url: string; title: string }>;
}

export const quickFeatureApi = {
  async generateQuickFeature(
    title: string,
    description: string | undefined,
    onChunk: (content: string) => void,
    onResult: (result: QuickFeatureResult | null) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/quick-feature/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, model }),
      credentials: 'include',
    });

    if (!response.ok) {
      throw apiError(await response.json().catch(() => ({})), response.status);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('No response body');

    let lineBuffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content') onChunk(data.content);
            else if (data.type === 'done') onResult(data.result);
            else if (data.type === 'error') onError(data.error);
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  async pushQuickFeature(result: QuickFeatureResult): Promise<QuickFeaturePushResult> {
    const response = await axios.post(`${API_BASE_URL}/api/quick-feature/push`, { result });
    return response.data;
  },
};
