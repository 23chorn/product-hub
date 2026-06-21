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
  discovery:          'claude-sonnet-4-5-20250929',
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

