import axios from 'axios';
import type { DecisionLogSession, MonthEntry } from '@pap/shared';
import { API_BASE_URL, readSSEStream } from './base';

export const decisionLogApi = {
  async getDecisionLogSession(): Promise<DecisionLogSession> {
    const response = await axios.get(`${API_BASE_URL}/api/decision-log/session`);
    return response.data;
  },

  async sendDecisionLogMessage(
    sessionId: string,
    message: string,
    onChunk: (content: string) => void,
    onComplete: (content?: string) => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/decision-log/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message, model }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await readSSEStream(response, onChunk, (content) => onComplete(content), onError);
  },

  async logDecision(content: string, title?: string): Promise<{ success: boolean; yearMonth: string }> {
    const response = await axios.post(`${API_BASE_URL}/api/decision-log/log-decision`, { content, title });
    return response.data;
  },

  async getDecisionLogFile(yearMonth: string): Promise<{ content: string | null }> {
    const response = await axios.get(`${API_BASE_URL}/api/decision-log/log/${yearMonth}`);
    return response.data;
  },

  async getDecisionLogMonths(): Promise<{ months: MonthEntry[] }> {
    const response = await axios.get(`${API_BASE_URL}/api/decision-log/months`);
    return response.data;
  },
};
