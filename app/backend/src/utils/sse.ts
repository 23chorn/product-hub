import type { Response } from 'express';

/**
 * Initialise a Server-Sent Events stream on an Express response: sets the
 * standard event-stream headers and flushes them so the client opens the stream
 * immediately.
 */
export function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

/** Send one SSE message as a JSON-encoded `data:` frame. */
export function sseSend(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
