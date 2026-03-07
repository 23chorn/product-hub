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
  // Anthropic direct
  'claude-haiku-4-5-20251001':   { input: 1.00, cacheWrite: 1.25, cacheRead: 0.10, output:  5.00 },
  'claude-sonnet-4-5-20250929':  { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
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
  output: number
): string {
  const p = MODEL_PRICING[model];
  if (!p) return '';
  const M = 1_000_000;
  const inCost    = (uncachedInput * p.input + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / M;
  const outCost   = output * p.output / M;
  const total     = inCost + outCost;
  const fmt = (n: number) => `$${n.toFixed(6)}`;
  return ` | cost ~${fmt(total)} (in=${fmt(inCost)} out=${fmt(outCost)})`;
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

/**
 * Stream AI responses — provider is selected via AI_PROVIDER env var
 */
export async function* streamAI(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens = 8192,
  options: { webSearch?: boolean } = {}
): AsyncGenerator<string, void, unknown> {
  const provider = getActiveProvider();
  logger.info(`Streaming via provider: ${provider}, model: ${model}`);

  if (provider === 'anthropic') {
    yield* streamWithAnthropic(model, system, messages, maxTokens, options);
  } else if (provider === 'bedrock') {
    yield* streamWithBedrock(model, system, messages, maxTokens);
  } else {
    yield* streamWithOllama(model, toSystemString(system), messages);
  }
}

async function* streamWithAnthropic(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  options: { webSearch?: boolean } = {}
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

  const params = {
    model,
    max_tokens: effectiveMaxTokens,
    system: systemParam,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
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
        }
      }

      // inputTokens = uncached tokens only; cache fields are reported separately.
      // Total tokens processed = uncached + cache_write + cache_read.
      const totalInput = inputTokens + cacheWriteTokens + cacheReadTokens;
      logger.info(
        `[TOKENS] model=${model}` +
        ` | input=${totalInput} (uncached=${inputTokens} cache_write=${cacheWriteTokens} cache_read=${cacheReadTokens})` +
        ` | output=${outputTokens}` +
        estimateCost(model, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens)
      );

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
  maxTokens: number
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
        }
      } catch {
        // Ignore unparseable lines
      }
    }
  }
}
