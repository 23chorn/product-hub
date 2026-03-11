import {
  ConverseStreamCommand,
  CachePointType,
  CacheTTL,
  type Message,
  type ContentBlock,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import bedrockClient from './bedrock-client';
import { getAnthropicClient } from './anthropic-client';
import type { ModelOption } from '@pap/shared';
import Logger from './logger';

const logger = new Logger('AI-PROVIDER');

export type AIProvider = 'anthropic' | 'bedrock' | 'ollama';

export function getActiveProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (provider !== 'anthropic' && provider !== 'bedrock' && provider !== 'ollama') {
    logger.warn(`Unknown AI_PROVIDER "${provider}", defaulting to "anthropic"`);
    return 'anthropic';
  }
  return provider as AIProvider;
}

/**
 * Default model IDs per provider when MODEL_* env vars are not set
 */
const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  bedrock:   'global.anthropic.claude-opus-4-6-v1',
  ollama:    'llama3.2:1b',
};

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
const WEB_SEARCH_COST_PER_QUERY = 0.01;

export function getAvailableModels(): ModelOption[] {
  return PROVIDER_MODELS[getActiveProvider()] ?? [];
}

export function isValidModelId(modelId: string): boolean {
  return getAvailableModels().some(m => m.id === modelId);
}

export function resolveModelId(modelEnvValue: string | undefined): string {
  if (modelEnvValue) return modelEnvValue;
  return DEFAULT_MODELS[getActiveProvider()];
}

/**
 * Per-agent model assignments for Anthropic.
 * Other providers use their single default model for all agents.
 */
export const ANTHROPIC_AGENT_MODELS: Record<string, string> = {
  coordinator:        'claude-haiku-4-5-20251001',
  analyst:            'claude-opus-4-6',
  pm_prd:             'claude-sonnet-4-5-20250929',
  solution_architect: 'claude-sonnet-4-5-20250929',
  pm_backlog:         'claude-haiku-4-5-20251001',
  critic:             'claude-haiku-4-5-20251001',
  curator:            'claude-haiku-4-5-20251001',
};

/** Returns the model ID to use for a given agent, respecting the active provider. */
export function resolveAgentModel(agent: string): string {
  if (getActiveProvider() === 'anthropic') {
    return ANTHROPIC_AGENT_MODELS[agent] ?? DEFAULT_MODELS.anthropic;
  }
  return resolveModelId(undefined);
}

/** Returns a short human-readable label for a model ID. */
export function modelShortLabel(modelId: string): string {
  if (modelId.includes('opus')) return 'Opus';
  if (modelId.includes('sonnet')) return 'Sonnet';
  if (modelId.includes('haiku')) return 'Haiku';
  return modelId.split('/').pop()?.split(':')[0] ?? modelId;
}

/** Returns short model labels per agent — used by the frontend to show which model each stage uses. */
export function getAgentModelLabels(): Record<string, string> {
  const agents = ['coordinator', 'analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'critic', 'curator'];
  return Object.fromEntries(agents.map(a => [a, modelShortLabel(resolveAgentModel(a))]));
}

/**
 * Hard output-token ceilings per model.
 * Passing max_tokens above a model's actual limit causes an API error, so we
 * cap the requested value here. Models not listed fall back to 8192.
 * All Claude 4.x models support 64k output tokens.
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
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

function modelMaxOutputTokens(model: string): number {
  return MODEL_MAX_OUTPUT_TOKENS[model] ?? 8_192;
}

/**
 * Pricing per million tokens (USD). Source: platform.claude.com/docs/en/about-claude/pricing
 * cache_write = 5-minute ephemeral cache write rate (1.25x base input).
 * cache_read  = cache hit/refresh rate (0.1x base input).
 * Bedrock models use Anthropic-direct rates as an approximation — check
 * aws.amazon.com/bedrock/pricing for exact Bedrock rates.
 */
interface ModelPricing {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
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
function estimateCost(
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

/**
 * A system prompt passed to streamAI.
 *
 * Pass a plain string when caching is not needed.
 * Pass { stable, dynamic } to enable prompt caching:
 *   - `stable` is the large cacheable portion (persona + context + workflow steps).
 *     Anthropic marks it cache_control:ephemeral; Bedrock inserts a cachePoint marker.
 *     Cache hits pay ~10% of normal input-token cost.
 *   - `dynamic` (optional) is appended uncached — used for per-request content
 *     such as item/initiative context that changes across sessions.
 *
 * Ollama does not support prompt caching; both parts are concatenated into a
 * single string for that provider.
 */
export type SystemPrompt = string | { stable: string; dynamic?: string };

/** Collapse a SystemPrompt to a plain string (for non-Anthropic providers). */
function toSystemString(system: SystemPrompt): string {
  if (typeof system === 'string') return system;
  return system.dynamic ? `${system.stable}\n\n${system.dynamic}` : system.stable;
}

/** Token usage metadata returned via the onTokens callback. */
export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  searchCount: number;   // web search queries made (Anthropic only; 0 for other providers)
  estimatedCost: number; // USD (includes search cost)
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

/**
 * Stream AI responses — provider is selected via AI_PROVIDER env var.
 * Optional onTokens callback receives token usage after streaming completes.
 */
export async function* streamAI(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens = 8192,
  options: { webSearch?: boolean; onTokens?: (usage: TokenUsage) => void } = {}
): AsyncGenerator<string, void, unknown> {
  const provider = getActiveProvider();
  logger.info(`Streaming via provider: ${provider}, model: ${model}`);

  if (provider === 'anthropic') {
    yield* streamWithAnthropic(model, system, messages, maxTokens, options);
  } else if (provider === 'bedrock') {
    yield* streamWithBedrock(model, system, messages, maxTokens, options.onTokens);
  } else {
    yield* streamWithOllama(model, toSystemString(system), messages, options.onTokens);
  }
}

async function* streamWithAnthropic(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  options: { webSearch?: boolean; onTokens?: (usage: TokenUsage) => void } = {}
): AsyncGenerator<string, void, unknown> {
  const tools = options.webSearch
    ? [{ type: 'web_search_20250305' as const, name: 'web_search' as const }]
    : undefined;

  const effectiveMaxTokens = Math.min(maxTokens, modelMaxOutputTokens(model));

  // Build the system parameter. When system is split into stable/dynamic parts,
  // mark the stable block with cache_control so Anthropic caches its KV prefix.
  // Cache hits pay 10% of normal input-token cost for the cached portion.
  const systemParam: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> =
    typeof system === 'string'
      ? system
      : [
          { type: 'text' as const, text: system.stable, cache_control: { type: 'ephemeral' as const } },
          ...(system.dynamic ? [{ type: 'text' as const, text: system.dynamic }] : []),
        ];

  // Multi-turn message caching: mark the second-to-last message with cache_control
  // so the entire conversation history up to that point is served from cache on
  // subsequent turns. Cache hits pay 10% of normal cost for those tokens.
  // Only applied when there are 2+ messages (single-shot calls skip this).
  type MsgBlock = { type: 'text'; text: string; cache_control: { type: 'ephemeral' } };
  type PreparedMsg = { role: 'user' | 'assistant'; content: string | MsgBlock[] };
  const preparedMessages: PreparedMsg[] = messages.map((m, i) => {
    if (messages.length >= 2 && i === messages.length - 2) {
      return {
        role: m.role,
        content: [{ type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const } }],
      };
    }
    return { role: m.role, content: m.content };
  });

  const params = {
    model,
    max_tokens: effectiveMaxTokens,
    system: systemParam,
    messages: preparedMessages,
    ...(tools && { tools }),
    stream: true as const,
  };

  // Retry up to 3 times on 429 rate-limit errors with linear back-off.
  // The rate-limit is checked at connection time, before any tokens are streamed,
  // so retrying never duplicates output already sent to the client.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 15_000; // 15 s per attempt (rate limit window is 60 s)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stream = await getAnthropicClient().messages.create(params);

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let searchQueryCount = 0;

      // Track web search URLs for citation verification
      const searchUrls: Array<{ url: string; title: string }> = [];

      for await (const event of stream) {
        if (event.type === 'message_start') {
          const usage = event.message.usage as {
            input_tokens: number;
            output_tokens: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
          inputTokens       = usage.input_tokens;
          cacheReadTokens   = usage.cache_read_input_tokens   ?? 0;
          cacheWriteTokens  = usage.cache_creation_input_tokens ?? 0;
        } else if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens;
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        } else if (event.type === 'content_block_start') {
          const block = event.content_block as any;
          // Count each search query (each server_tool_use = one $0.01 query)
          if (block?.type === 'server_tool_use' && block.name === 'web_search') {
            searchQueryCount++;
          }
          // Capture web search result URLs for citation verification
          if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const result of block.content) {
              if (result.type === 'web_search_result' && result.url) {
                searchUrls.push({ url: result.url, title: result.title ?? '' });
              }
            }
          }
        }
      }

      if (searchQueryCount > 0) {
        logger.info(`[WEB SEARCH] ${searchQueryCount} search quer${searchQueryCount === 1 ? 'y' : 'ies'} (${searchUrls.length} result(s) total)`);
      } else if (searchUrls.length > 0) {
        logger.info(`[WEB SEARCH] ${searchUrls.length} source(s): ${searchUrls.map(s => s.url).join(', ')}`);
      }

      // inputTokens = uncached tokens only; cache fields are reported separately.
      // Total tokens processed = uncached + cache_write + cache_read.
      const totalInput = inputTokens + cacheWriteTokens + cacheReadTokens;
      logger.info(
        `[TOKENS] model=${model}` +
        ` | input=${totalInput} (uncached=${inputTokens} cache_write=${cacheWriteTokens} cache_read=${cacheReadTokens})` +
        ` | output=${outputTokens}` +
        estimateCost(model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, searchQueryCount)
      );

      options.onTokens?.({
        model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
        searchCount: searchQueryCount,
        estimatedCost: calculateCost(model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, searchQueryCount),
      });

      return; // success — exit retry loop

    } catch (err: any) {
      if (err?.status === 429 && attempt < MAX_RETRIES) {
        const waitMs = RETRY_DELAY_MS * (attempt + 1);
        logger.warn(`Rate limit hit — waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(res => setTimeout(res, waitMs));
        continue;
      }

      // Re-wrap 429 exhaustion with a user-readable message
      if (err?.status === 429) {
        throw new Error(
          'Rate limit reached after retries. Your organisation\'s input token quota is full — ' +
          'wait a minute then try again, or switch to a different model.'
        );
      }

      throw err;
    }
  }
}

async function* streamWithBedrock(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  onTokens?: (usage: TokenUsage) => void
): AsyncGenerator<string, void, unknown> {
  const bedrockMessages: Message[] = messages.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: [{ text: msg.content }] as ContentBlock[],
  }));

  // When a stable/dynamic split is provided, place a cache point after the stable block
  // so Bedrock caches the large workflow/persona portion across requests.
  // ONE_HOUR TTL keeps the cache alive for the full working session (vs 5-min default).
  const systemBlocks: SystemContentBlock[] =
    typeof system === 'string'
      ? [{ text: system }]
      : [
          { text: system.stable },
          { cachePoint: { type: CachePointType.DEFAULT, ttl: CacheTTL.ONE_HOUR } },
          ...(system.dynamic ? [{ text: system.dynamic }] : []),
        ];

  const command = new ConverseStreamCommand({
    modelId: model,
    system: systemBlocks,
    messages: bedrockMessages,
    inferenceConfig: { maxTokens: Math.min(maxTokens, modelMaxOutputTokens(model)) },
  });

  // Retry up to 3 times on ThrottlingException with linear back-off.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 15_000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await bedrockClient.send(command);

      if (response.stream) {
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;

        for await (const event of response.stream) {
          if (event.contentBlockDelta?.delta?.text) {
            yield event.contentBlockDelta.delta.text;
          } else if (event.metadata?.usage) {
            inputTokens      = event.metadata.usage.inputTokens      ?? 0;
            outputTokens     = event.metadata.usage.outputTokens     ?? 0;
            cacheReadTokens  = event.metadata.usage.cacheReadInputTokens  ?? 0;
            cacheWriteTokens = event.metadata.usage.cacheWriteInputTokens ?? 0;
          }
        }

        const totalInput = inputTokens + cacheWriteTokens + cacheReadTokens;
        logger.info(
          `[TOKENS] model=${model}` +
          ` | input=${totalInput} (uncached=${inputTokens} cache_write=${cacheWriteTokens} cache_read=${cacheReadTokens})` +
          ` | output=${outputTokens}` +
          estimateCost(model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens)
        );

        onTokens?.({
          model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
          searchCount: 0,
          estimatedCost: calculateCost(model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens),
        });
      }

      return; // success — exit retry loop

    } catch (err: any) {
      const isThrottle = err?.name === 'ThrottlingException' || err?.__type === 'ThrottlingException';

      if (isThrottle && attempt < MAX_RETRIES) {
        const waitMs = RETRY_DELAY_MS * (attempt + 1);
        logger.warn(`Bedrock throttled — waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(res => setTimeout(res, waitMs));
        continue;
      }

      if (isThrottle) {
        throw new Error(
          'Bedrock request throttled after retries. Wait a moment then try again, or switch to a different model.'
        );
      }

      throw err;
    }
  }
}

/**
 * Ollama local inference via its /api/chat endpoint.
 * Base URL defaults to http://localhost:11434 — override with OLLAMA_BASE_URL in .env.
 * Streams newline-delimited JSON; each line has { message: { content }, done }.
 */
async function* streamWithOllama(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onTokens?: (usage: TokenUsage) => void,
): AsyncGenerator<string, void, unknown> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const text = parsed?.message?.content;
        if (text) yield text;
        if (parsed?.done) {
          const inputTokens  = parsed.prompt_eval_count ?? 0;
          const outputTokens = parsed.eval_count        ?? 0;
          logger.info(
            `[TOKENS] model=${model}` +
            ` | input=${inputTokens}` +
            ` | output=${outputTokens}` +
            estimateCost(model, inputTokens, 0, 0, outputTokens)
          );
          onTokens?.({
            model, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0,
            searchCount: 0,
            estimatedCost: calculateCost(model, inputTokens, 0, 0, outputTokens),
          });
        }
      } catch {
        // Ignore unparseable lines
      }
    }
  }
}
