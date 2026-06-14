import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { initSSE, sseSend } from '../../app/backend/src/utils/sse';

/** Minimal Express Response stub capturing headers and writes. */
function fakeRes() {
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  const res = {
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { writes.push(chunk); return true; }),
  } as unknown as Response;
  return { res, headers, writes };
}

describe('initSSE', () => {
  it('sets the SSE headers and flushes', () => {
    const { res, headers } = fakeRes();
    initSSE(res);
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['Connection']).toBe('keep-alive');
    expect(res.flushHeaders).toHaveBeenCalledOnce();
  });

  it('tolerates a response without flushHeaders', () => {
    const res = { setHeader: vi.fn(), write: vi.fn() } as unknown as Response;
    expect(() => initSSE(res)).not.toThrow();
  });
});

describe('sseSend', () => {
  it('writes a JSON data frame terminated by a blank line', () => {
    const { res, writes } = fakeRes();
    sseSend(res, { type: 'content', content: 'hi' });
    expect(writes).toEqual(['data: {"type":"content","content":"hi"}\n\n']);
  });

  it('serialises arbitrary payloads', () => {
    const { res, writes } = fakeRes();
    sseSend(res, { type: 'done' });
    expect(writes[0]).toBe('data: {"type":"done"}\n\n');
  });
});
