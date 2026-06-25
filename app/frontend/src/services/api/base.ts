/**
 * Shared client foundation for the api/* domain modules: the base URL, the error
 * normalizer, and the SSE stream reader. Importing this module also applies the
 * global axios credential default (httpOnly auth cookie).
 */
import axios from 'axios';

// ?? (not ||) so an explicitly empty VITE_API_URL (same-origin prod build) isn't
// overridden by the localhost fallback — only a genuinely unset var falls back.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// Always send cookies (httpOnly auth cookie)
axios.defaults.withCredentials = true;

export function apiError(body: unknown, status: number): Error {
  const msg = body && typeof body === 'object' && 'error' in body
    ? String((body as Record<string, unknown>).error)
    : `HTTP ${status}`;
  return new Error(msg);
}

/**
 * Read a Server-Sent-Events response stream, dispatching parsed `data:` events to
 * the provided callbacks. Buffers incomplete lines across network chunks — SSE
 * events can arrive split across chunks, and without buffering the JSON parse fails
 * silently and onComplete is never called, leaving the UI stuck streaming.
 */
export async function readSSEStream(
  response: globalThis.Response,
  onChunk: (content: string) => void,
  onComplete: (content?: string) => void,
  onError: (error: string) => void,
  onReplace?: (cleanedContent: string) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  let lineBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });

      // Only process complete lines; keep the trailing incomplete fragment
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'content') {
              onChunk(data.content);
            } else if (data.type === 'replace') {
              onReplace?.(data.content);
            } else if (data.type === 'done') {
              onComplete(data.content);
            } else if (data.type === 'error') {
              onError(data.error);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
