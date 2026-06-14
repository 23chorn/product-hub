import type { ModelOption } from '@pap/shared';
import type { AIProvider } from './ai-provider';

/**
 * Selectable models per provider — drives the UI model selector.
 * Add entries here to expand the list; order determines display order.
 *
 * For Ollama: add the exact model tag as installed via `ollama pull <model>`.
 * Example: { id: 'llama3.2', label: 'Llama 3.2', description: 'Local · Meta' }
 *
 * Bedrock: global.* cross-region inference profiles are required for me-central-1 (UAE).
 * us.* / eu.* regional profiles are not accessible from that endpoint.
 * Note: global.* routes across all commercial regions, so prompt cache hits are
 * opportunistic (same region must be selected twice). Cache is still attempted.
 */
export const PROVIDER_MODELS: Record<AIProvider, ModelOption[]> = {
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fast · Low cost' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', description: 'Main'},
    { id: 'claude-opus-4-6', label: 'Opus 4.6', description: 'Highest capability' },
  ],
  bedrock: [
    { id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Haiku 4.5 (Bedrock)', description: 'Fast · Low cost' },
    { id: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Sonnet 4.5 (Bedrock)', description: 'Main · Med. cost' },
    { id: 'global.anthropic.claude-opus-4-6-v1', label: 'Opus 4.6 (Bedrock)', description: 'Highest capability' },
  ],
  // ── Ollama (local) ──────────────────────────────────────────────────────────
  // Each `id` must exactly match the model tag returned by `ollama list`.
  ollama: [
    { id: 'llama3.2:1b', label: 'Llama 3.2 1B', description: 'Local · Fast · Free' },
  ],
};

/** Cost per Anthropic web search query (USD, as of 2025). */
export const WEB_SEARCH_COST_PER_QUERY = 0.01;

/**
 * Per-agent model assignments for Anthropic.
 * Other providers use their single default model for all agents.
 */
export const ANTHROPIC_AGENT_MODELS: Record<string, string> = {
  coordinator:        'claude-haiku-4-5-20251001',
  analyst:            'claude-opus-4-6',
  pm_prd:             'claude-sonnet-4-5-20250929',
  solution_architect: 'claude-sonnet-4-5-20250929',
  story_decomposition:'claude-haiku-4-5-20251001',
  critic:             'claude-haiku-4-5-20251001',
  curator:            'claude-haiku-4-5-20251001',
};

/**
 * Hard output-token ceilings per model.
 * Passing max_tokens above a model's actual limit causes an API error, so we
 * cap the requested value here. Models not listed fall back to 8192.
 * All Claude 4.x models support 64k output tokens.
 */
export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  // Anthropic direct
  'claude-haiku-4-5-20251001':  64_000,
  'claude-sonnet-4-5-20250929': 64_000,
  'claude-opus-4-6':            64_000,
  // Bedrock (global.* cross-region inference profiles)
  'global.anthropic.claude-haiku-4-5-20251001-v1:0': 64_000,
  'global.anthropic.claude-sonnet-4-5-20250929-v1:0': 64_000,
  'global.anthropic.claude-opus-4-6-v1':              64_000,
  // Ollama (local)
  'llama3.2:1b': 2_048,
};

export function modelMaxOutputTokens(model: string): number {
  return MODEL_MAX_OUTPUT_TOKENS[model] ?? 8_192;
}

/**
 * Pricing per million tokens (USD). Source: platform.claude.com/docs/en/about-claude/pricing
 * cache_write = 5-minute ephemeral cache write rate (1.25x base input).
 * cache_read  = cache hit/refresh rate (0.1x base input).
 * Bedrock models use Anthropic-direct rates as an approximation — check
 * aws.amazon.com/bedrock/pricing for exact Bedrock rates.
 */
export interface ModelPricing {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic direct — source: platform.claude.com/docs/en/about-claude/pricing
  // Haiku 4.5: $1.00/$5.00 per 1M in/out
  'claude-haiku-4-5-20251001':   { input: 1.00, cacheWrite: 1.25, cacheRead: 0.10, output:  5.00 },
  // Sonnet 4.5 / 4.6: $3.00/$15.00 per 1M in/out
  'claude-sonnet-4-5-20250929':  { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
  'claude-sonnet-4-6':           { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
  // Opus 4.6: $5.00/$25.00 per 1M in/out
  'claude-opus-4-6':             { input: 5.00, cacheWrite: 6.25, cacheRead: 0.50, output: 25.00 },
  // Bedrock global.* cross-region profiles (approximate — check aws.amazon.com/bedrock/pricing for exact rates)
  'global.anthropic.claude-haiku-4-5-20251001-v1:0':  { input: 1.00, cacheWrite: 1.25, cacheRead: 0.10, output:  5.00 },
  'global.anthropic.claude-sonnet-4-5-20250929-v1:0': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
  'global.anthropic.claude-opus-4-6-v1':              { input: 5.00, cacheWrite: 6.25, cacheRead: 0.50, output: 25.00 },
};

/** Returns a cost breakdown string, or '' if the model isn't in the pricing table. */
export function estimateCost(
  model: string,
  uncachedInput: number,
  cacheWrite: number,
  cacheRead: number,
  output: number,
  searchCount = 0
): string {
  const p = MODEL_PRICING[model];
  if (!p && searchCount === 0) return '';
  const M = 1_000_000;
  const inCost    = p ? (uncachedInput * p.input + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / M : 0;
  const outCost   = p ? output * p.output / M : 0;
  const searchCost = searchCount * WEB_SEARCH_COST_PER_QUERY;
  const total     = inCost + outCost + searchCost;
  const fmt = (n: number) => `$${n.toFixed(6)}`;
  const searchNote = searchCount > 0 ? ` searches=${searchCount}(${fmt(searchCost)})` : '';
  return ` | cost ~${fmt(total)} (in=${fmt(inCost)} out=${fmt(outCost)}${searchNote})`;
}

/** Calculate estimated cost in USD from token counts. Returns 0 if model not in pricing table. */
export function calculateCost(
  model: string,
  uncachedInput: number,
  cacheWrite: number,
  cacheRead: number,
  output: number,
  searchCount = 0
): number {
  const p = MODEL_PRICING[model];
  if (!p && searchCount === 0) return 0;
  const M = 1_000_000;
  const tokenCost = p
    ? (uncachedInput * p.input + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / M
      + output * p.output / M
    : 0;
  return tokenCost + searchCount * WEB_SEARCH_COST_PER_QUERY;
}
