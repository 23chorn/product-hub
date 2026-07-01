import * as https from 'https';
import * as http from 'http';
import type { ManifestResponse, PayloadResponse, StateUpdateResponse } from './types';

export async function fetchManifest(
  apiUrl: string, seqNum: number, stream: string, phase: string, apiKey?: string
): Promise<ManifestResponse> {
  return get<ManifestResponse>(
    `${apiUrl}/api/dev/initiatives/${seqNum}/manifest?stream=${encodeURIComponent(stream)}&phase=${encodeURIComponent(phase)}`,
    apiKey
  );
}

export async function fetchPayload(
  apiUrl: string, seqNum: number, localKeys: string[], apiKey?: string
): Promise<PayloadResponse> {
  const ids = localKeys.map(encodeURIComponent).join(',');
  return get<PayloadResponse>(
    `${apiUrl}/api/dev/initiatives/${seqNum}/tickets/payload?ids=${ids}`,
    apiKey
  );
}

export async function updateTicketState(
  apiUrl: string, seqNum: number, adoIds: number[], state: string, apiKey?: string
): Promise<StateUpdateResponse> {
  return patch<StateUpdateResponse>(
    `${apiUrl}/api/dev/initiatives/${seqNum}/tickets/state`,
    { adoIds, state },
    apiKey
  );
}

function get<T>(url: string, apiKey?: string): Promise<T> {
  return request<T>(url, 'GET', undefined, apiKey);
}

function patch<T>(url: string, body: unknown, apiKey?: string): Promise<T> {
  return request<T>(url, 'PATCH', body, apiKey);
}

function request<T>(url: string, method: string, body?: unknown, apiKey?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = lib.request(options, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 400) {
          let msg = `HTTP ${res.statusCode}`;
          try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch {}
          reject(new Error(msg));
          return;
        }
        try {
          resolve(JSON.parse(text) as T);
        } catch {
          reject(new Error(`Invalid JSON from ${method} ${url}: ${text.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
