import axios from 'axios';
import { API_BASE_URL, apiError } from './base';

export const ticketsApi = {
  async estimateTicket(
    title: string,
    description: string | undefined,
    onChunk: (content: string) => void,
    onResult: (result: { story: any; aiEstimateDevHours: number | null }) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/tickets/format-and-estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, model }),
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
            else if (data.type === 'done') onResult({ story: data.story, aiEstimateDevHours: data.aiEstimateDevHours });
            else if (data.type === 'error') onError(data.error);
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  async pushTicketToAdo(ticket: {
    title: string;
    persona?: string;
    goal?: string;
    benefit?: string;
    acceptanceCriteria?: string[];
    storyPoints?: number;
    aiEstimateDevHours?: number;
  }): Promise<{ id: number; url: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/tickets/push-to-ado`, ticket);
    return response.data;
  },
};
