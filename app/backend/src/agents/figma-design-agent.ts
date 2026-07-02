/**
 * Figma Design stage helpers — MCP-based frame fetching used by the api_spec
 * context builder to read actual Figma screen content.
 *
 * Deliberately separate from prototype-agent.ts, which owns the prototype wireframe
 * flow and Figma design-system loading. This module owns the per-screen frame fetch
 * used for API contract derivation.
 */

import Logger from '../utils/logger';
import { extractFigmaFileKey, resolveFigmaDevMcpBin } from './prototype-agent';

const logger = new Logger('FIGMA-DESIGN-AGENT');

/** Extract a Figma node ID from a ?node-id= query parameter. Normalises separator to colon. */
export function extractFigmaNodeId(url: string): string | null {
  const match = url.match(/node-id=([0-9]+)[:\-]([0-9]+)/);
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * Fetch a specific Figma frame or section by URL via the Figma Developer MCP.
 *
 * Accepts a standard Figma URL with a ?node-id= parameter. If the node is a
 * Section containing multiple child frames (e.g. all states of one screen),
 * get_figma_data returns the full subtree — so one URL covers all states.
 *
 * Returns empty string if MCP is unconfigured, the URL lacks a node-id, or the
 * call fails — callers fall back to Bora's text brief in that case.
 */
export async function loadFigmaFrameData(frameUrl: string): Promise<string> {
  const fileKey = extractFigmaFileKey(frameUrl);
  const nodeId = extractFigmaNodeId(frameUrl);
  const token = process.env.FIGMA_API_KEY ?? process.env.FIGMA_ACCESS_TOKEN;
  if (!fileKey || !nodeId || !token) return '';

  let Client: any;
  let StdioClientTransport: any;
  try {
    ({ Client } = require('@modelcontextprotocol/sdk/client') as typeof import('@modelcontextprotocol/sdk/client/index.js'));
    ({ StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js') as typeof import('@modelcontextprotocol/sdk/client/stdio.js'));
  } catch {
    logger.warn('MCP SDK not installed — Figma frame fetch unavailable');
    return '';
  }

  const { command, args } = resolveFigmaDevMcpBin();
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...(process.env as Record<string, string>), FIGMA_API_KEY: token },
  });
  const client = new Client({ name: 'product-hub', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport, { timeout: 8_000 });
    const result = await client.callTool({
      name: 'get_figma_data',
      arguments: { fileKey, nodeId },
    }, undefined, { timeout: 30_000 });

    const content = Array.isArray(result.content)
      ? result.content.map((c: { type: string; text?: string }) => c.text ?? '').join('\n')
      : String(result.content);

    logger.info(`Fetched Figma node ${nodeId} from file ${fileKey} (${content.length} chars)`);
    return content;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not fetch Figma node ${nodeId}: ${msg}`);
    return '';
  } finally {
    try { await transport.close(); } catch { /* ignore */ }
  }
}
