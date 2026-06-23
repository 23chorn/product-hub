import type { ModelOption } from '@pap/shared';
import type { AIProvider } from './ai-provider';

/**
 * Selectable models per provider — drives the UI model selector.
 * Add entries here to expand the list; order determines display order.
 *
 * For Ollama: add the exact model tag as installed via `ollama pull <model>`.
 * Example: { id: 'llama3.2', label: 'Llama 3.2', description: 'Local · Meta' }
 *
 * Bedrock: model ID format depends on account/region setup. Claude 4.x models on
 * Bedrock are on-demand only via a cross-region inference profile — the bare
 * `anthropic.<model>` id throws "on-demand throughput isn't supported" — so the
 * id must carry a profile prefix (`global.anthropic.<model>`, or a regional one
 * like `us.anthropic.<model>` where your account has that profile). Verified
 * against this account: `global.*` is invokable from AWS_REGION=us-east-1 but
 * returns ResourceNotFoundException from AWS_REGION=me-central-1 — the global
 * profile isn't reachable as a source from every Bedrock region. Use whatever ID
 * the Bedrock console shows for your account/region. global.* routes across all
 * commercial regions, so prompt cache hits are opportunistic there (same region
 * must be selected twice) — direct regional ids cache normally.
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
  ],
  // ── Ollama (local) ──────────────────────────────────────────────────────────
  // Each `id` must exactly match the model tag returned by `ollama list`.
  ollama: [
    { id: 'llama3.2:1b', label: 'Llama 3.2 1B', description: 'Local · Fast · Free' },
  ],
};

/**
 * Per-agent model assignments, keyed by provider. Each provider tiers stages
 * independently since available model ids (and which stages are worth the higher
 * tier) can differ per provider. Ollama has only one local model, so it always
 * uses DEFAULT_MODELS.ollama regardless of agent.
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
  doc_review:         'claude-haiku-4-5-20251001',
};

/**
 * Bedrock per-stage tiering: Sonnet for the stages that draft a core pipeline
 * artifact a human reviews and everything downstream depends on (research,
 * PRD, epic/feature breakdown, architecture); Haiku for orchestration/review/
 * extraction stages (coordinator, critic, curator) and for the narrower,
 * more mechanical specialist stages — prototype wireframes are deliberately
 * low-fidelity/generic-component-only, and the Figma design stage produces a
 * structured brief for a human designer to act on, not a polished deliverable.
 */
export const BEDROCK_AGENT_MODELS: Record<string, string> = {
  coordinator:          'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  critic:               'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  curator:              'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  prototype:            'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  figma_design:         'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  doc_review:           'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  analyst:              'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  pm_prd:               'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  epic_feature_planner: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  solution_architect:   'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  discovery:            'global.anthropic.claude-sonnet-4-5-20250929-v1:0',

  // Multi-agent refinement participants (story_decomposition_F* + their _qa siblings),
  // keyed by persona agentType rather than stage — every participant runs under the
  // same persona across all features and all three Draft/Refine/Refine phases, so one
  // tier per agentType is the natural grain (see multi-agent-refinement.ts PARTICIPANTS
  // and feature-stage-runner.ts's surgical revision specs).
  'story-decomposition': 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',              // Shard — owns the final story artifact pushed to ADO
  'qa-engineer':          'global.anthropic.claude-haiku-4-5-20251001-v1:0', // Vera — output is gated by the strict QA JSON validator
  'backend-engineer':     'global.anthropic.claude-haiku-4-5-20251001-v1:0', // Finn/Remi/Cole/Dex contribute technical notes that
  'web-engineer':         'global.anthropic.claude-haiku-4-5-20251001-v1:0', // Shard distills into the final stories — not the
  'ios-engineer':         'global.anthropic.claude-haiku-4-5-20251001-v1:0', // artifact of record themselves
  'android-engineer':     'global.anthropic.claude-haiku-4-5-20251001-v1:0',
};

const AGENT_MODELS_BY_PROVIDER: Partial<Record<AIProvider, Record<string, string>>> = {
  anthropic: ANTHROPIC_AGENT_MODELS,
  bedrock: BEDROCK_AGENT_MODELS,
};

/**
 * Resolve a per-agent model override for the given provider. Matches dynamic
 * per-feature stage names (e.g. "story_decomposition_F1", "story_decomposition_F1_qa")
 * against their base stage key the same way specialist-agent.ts's stageMatches() does,
 * so a future per-stage entry doesn't need one literal key per feature index.
 */
export function lookupAgentModel(provider: AIProvider, agent: string): string | undefined {
  const map = AGENT_MODELS_BY_PROVIDER[provider];
  if (!map) return undefined;
  if (map[agent]) return map[agent];
  const baseKey = Object.keys(map).find(key => agent.startsWith(key + '_'));
  return baseKey ? map[baseKey] : undefined;
}

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
  // Bedrock
  'global.anthropic.claude-haiku-4-5-20251001-v1:0':  64_000,
  'global.anthropic.claude-sonnet-4-5-20250929-v1:0': 64_000,
  // Ollama (local)
  'llama3.2:1b': 2_048,
};

export function modelMaxOutputTokens(model: string): number {
  return MODEL_MAX_OUTPUT_TOKENS[model] ?? 8_192;
}

