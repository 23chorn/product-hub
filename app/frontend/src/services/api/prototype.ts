import axios from 'axios';
import { API_BASE_URL } from './base';

async function parsePrototypeRaw(workflowId: string, raw: string): Promise<any | null> {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/workflow/${workflowId}/prototype/parse`, { raw });
    return response.data;
  } catch {
    return null;
  }
}

export const prototypeApi = {
  async getDesignSystem(): Promise<{ tokens: string; utilities: string; tailwindConfig: string } | null> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/prototype/design-system`);
      return response.data;
    } catch {
      return null;
    }
  },

  async getPrototype(workflowId: string): Promise<{
    title: string; description: string; screens: string[];
    entryScreen: string; files: Record<string, string>; platform?: 'web' | 'mobile';
  } | null> {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/workflow/${workflowId}/prototype`);
      // Unwrap { platform, web?, mobile? } — prefer web, fall back to mobile.
      // The unwrapped object carries its own `.platform` field (stamped server-side),
      // which is what the preview frame actually keys off — the wrapper's top-level
      // `platform` can be 'both' and isn't what we want here.
      type PrototypeVariant = { title: string; description: string; screens: string[]; entryScreen: string; files: Record<string, string>; platform?: 'web' | 'mobile' };
      const raw = response.data as { platform: string; web?: PrototypeVariant; mobile?: PrototypeVariant };
      if (raw && (raw.web || raw.mobile)) {
        return raw.web ?? raw.mobile ?? null;
      }
      return response.data;
    } catch {
      return null;
    }
  },

  /**
   * Revise a prototype with feedback. Same SSE pattern as generatePrototype.
   */
  async revisePrototype(
    workflowId: string,
    prototype: any,
    feedback: string,
    callbacks: {
      onContent: (text: string) => void;
      onPrototype: (prototype: any) => void;
      onError: (error: string) => void;
      onDone: () => void;
    }
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/workflow/${workflowId}/prototype/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prototype, feedback }),
      credentials: 'include',
    });

    if (!response.ok || !response.body) {
      callbacks.onError('Failed to start prototype revision');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawAccumulator = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'content') {
              rawAccumulator += event.content;
              callbacks.onContent(event.content);
            } else if (event.type === 'prototype') {
              callbacks.onPrototype(event.prototype);
            } else if (event.type === 'parse_failed') {
              try {
                const repaired = await parsePrototypeRaw(workflowId, rawAccumulator);
                if (repaired) callbacks.onPrototype(repaired);
              } catch { /* repair failed */ }
            } else if (event.type === 'error') {
              callbacks.onError(event.error);
            } else if (event.type === 'done') {
              callbacks.onDone();
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  parsePrototypeRaw,
};
