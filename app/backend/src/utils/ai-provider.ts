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
import {
  PROVIDER_MODELS,
  WEB_SEARCH_COST_PER_QUERY,
  ANTHROPIC_AGENT_MODELS,
  modelMaxOutputTokens,
  estimateCost,
  calculateCost,
} from './model-config';
import Logger from './logger';
import { type ToolDefinition, executeTool } from '../agents/tool-registry';

export type { ToolDefinition } from '../agents/tool-registry';

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

export { calculateCost, estimateCost, PROVIDER_MODELS, ANTHROPIC_AGENT_MODELS, WEB_SEARCH_COST_PER_QUERY } from './model-config';

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

/**
 * Stream AI responses — provider is selected via AI_PROVIDER env var.
 * Optional onTokens callback receives token usage after streaming completes.
 */
export async function* streamAI(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens = 8192,
  options: { webSearch?: boolean; onTokens?: (usage: TokenUsage) => void; tools?: ToolDefinition[] } = {}
): AsyncGenerator<string, void, unknown> {
  const provider = getActiveProvider();
  logger.info(`Streaming via provider: ${provider}, model: ${model}`);

  if (provider === 'anthropic') {
    yield* streamWithAnthropic(model, system, messages, maxTokens, options as any);
  } else if (provider === 'bedrock') {
    yield* streamWithBedrock(model, system, messages, maxTokens, options.onTokens, options.tools);
  } else {
    yield* streamWithOllama(model, toSystemString(system), messages, options.onTokens);
  }
}

// Internal content types used inside the Anthropic tool loop.
// The external messages API stays as {role, content: string}; these are used only
// internally when assembling assistant turns and tool results between iterations.
type InternalTextBlock    = { type: 'text'; text: string };
type InternalToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; _partialJson?: string };
type InternalToolResult   = { type: 'tool_result'; tool_use_id: string; content: string };
type InternalBlock        = InternalTextBlock | InternalToolUseBlock | InternalToolResult;
type InternalMsg          = { role: 'user' | 'assistant'; content: string | InternalBlock[] };

async function* streamWithAnthropic(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  options: { webSearch?: boolean; onTokens?: (usage: TokenUsage) => void; tools?: ToolDefinition[] } = {}
): AsyncGenerator<string, void, unknown> {
  const effectiveMaxTokens = Math.min(maxTokens, modelMaxOutputTokens(model));

  // Build tools array: webSearch built-in + skill-defined client tools
  const toolsParam: any[] = [];
  if (options.webSearch) {
    toolsParam.push({ type: 'web_search_20250305' as const, name: 'web_search' as const });
  }
  if (options.tools?.length) {
    for (const t of options.tools) {
      toolsParam.push({ type: 'custom' as const, name: t.name, description: t.description, input_schema: t.input_schema });
    }
  }

  const systemParam: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> =
    typeof system === 'string'
      ? system
      : [
          { type: 'text' as const, text: system.stable, cache_control: { type: 'ephemeral' as const } },
          ...(system.dynamic ? [{ type: 'text' as const, text: system.dynamic }] : []),
        ];

  // Multi-turn message caching on the initial messages (before any tool turns)
  type MsgBlock = { type: 'text'; text: string; cache_control: { type: 'ephemeral' } };
  type PreparedMsg = { role: 'user' | 'assistant'; content: string | MsgBlock[] };
  const initialMessages: PreparedMsg[] = messages.map((m, i) => {
    if (messages.length >= 2 && i === messages.length - 2) {
      return {
        role: m.role,
        content: [{ type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const } }],
      };
    }
    return { role: m.role, content: m.content };
  });

  // Internal message history — grows when tool turns are added
  let internalMessages: InternalMsg[] = initialMessages as InternalMsg[];

  // Aggregate token counts across all tool-loop iterations
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalSearchCount = 0;
  const allSearchUrls: Array<{ url: string; title: string }> = [];

  const MAX_TOOL_ITERATIONS = 5;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 15_000;

  for (let toolIteration = 0; toolIteration < MAX_TOOL_ITERATIONS; toolIteration++) {
    const params = {
      model,
      max_tokens: effectiveMaxTokens,
      system: systemParam,
      messages: internalMessages as any,
      ...(toolsParam.length > 0 && { tools: toolsParam }),
      stream: true as const,
    };

    let stopReason = 'end_turn';
    const builtBlocks: InternalBlock[] = [];
    let currentBlock: any = null;

    // Retry loop (rate limiting) wraps each streaming iteration
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const stream = await getAnthropicClient().messages.create(params);

        for await (const event of stream) {
          if (event.type === 'message_start') {
            const usage = event.message.usage as any;
            totalInputTokens  += usage.input_tokens ?? 0;
            totalCacheRead    += usage.cache_read_input_tokens   ?? 0;
            totalCacheWrite   += usage.cache_creation_input_tokens ?? 0;
          } else if (event.type === 'message_delta') {
            if (event.usage) totalOutputTokens += event.usage.output_tokens ?? 0;
            if ((event.delta as any).stop_reason) stopReason = (event.delta as any).stop_reason;
          } else if (event.type === 'content_block_start') {
            const block = event.content_block as any;
            if (block?.type === 'text') {
              currentBlock = { type: 'text' as const, text: '' };
              builtBlocks.push(currentBlock);
            } else if (block?.type === 'tool_use') {
              currentBlock = { type: 'tool_use' as const, id: block.id, name: block.name, input: {}, _partialJson: '' };
              builtBlocks.push(currentBlock);
            }
            // web search built-in blocks
            if (block?.type === 'server_tool_use' && block.name === 'web_search') {
              totalSearchCount++;
            }
            if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
              for (const result of block.content) {
                if (result.type === 'web_search_result' && result.url) {
                  allSearchUrls.push({ url: result.url, title: result.title ?? '' });
                }
              }
            }
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta as any;
            if (delta.type === 'text_delta' && currentBlock?.type === 'text') {
              yield delta.text;
              currentBlock.text += delta.text;
            } else if (delta.type === 'input_json_delta' && currentBlock?.type === 'tool_use') {
              currentBlock._partialJson += delta.partial_json ?? '';
            }
          } else if (event.type === 'content_block_stop') {
            // Finalise tool_use input by parsing accumulated JSON
            if (currentBlock?.type === 'tool_use') {
              try {
                currentBlock.input = JSON.parse(currentBlock._partialJson || '{}');
              } catch {
                currentBlock.input = {};
              }
              delete currentBlock._partialJson;
            }
            currentBlock = null;
          }
        }

        break; // streaming succeeded — exit retry loop

      } catch (err: any) {
        if (err?.status === 429 && attempt < MAX_RETRIES) {
          const waitMs = RETRY_DELAY_MS * (attempt + 1);
          logger.warn(`Rate limit hit — waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        if (err?.status === 429) {
          throw new Error(
            'Rate limit reached after retries. Your organisation\'s input token quota is full — ' +
            'wait a minute then try again, or switch to a different model.'
          );
        }
        throw err;
      }
    }

    // If the model stopped for a reason other than tool_use, we are done
    if (stopReason !== 'tool_use') break;

    // Execute all tool_use blocks and build tool results
    const toolUseBlocks = builtBlocks.filter((b): b is InternalToolUseBlock => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const toolResults: InternalToolResult[] = [];
    for (const block of toolUseBlocks) {
      let result: string;
      try {
        result = await executeTool(block.name, block.input);
      } catch (err: any) {
        result = `Tool execution failed: ${err.message}`;
        logger.warn(`[TOOL] ${block.name} failed: ${err.message}`);
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    // Append assistant turn + tool results and loop
    internalMessages = [
      ...internalMessages,
      { role: 'assistant' as const, content: builtBlocks },
      { role: 'user' as const, content: toolResults },
    ];
  }

  // Log search activity
  if (totalSearchCount > 0) {
    logger.info(`[WEB SEARCH] ${totalSearchCount} search quer${totalSearchCount === 1 ? 'y' : 'ies'} (${allSearchUrls.length} result(s) total)`);
  }

  const totalInput = totalInputTokens + totalCacheWrite + totalCacheRead;
  logger.info(
    `[TOKENS] model=${model}` +
    ` | input=${totalInput} (uncached=${totalInputTokens} cache_write=${totalCacheWrite} cache_read=${totalCacheRead})` +
    ` | output=${totalOutputTokens}` +
    estimateCost(model, totalInputTokens, totalCacheWrite, totalCacheRead, totalOutputTokens, totalSearchCount)
  );

  options.onTokens?.({
    model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
    searchCount: totalSearchCount,
    estimatedCost: calculateCost(model, totalInputTokens, totalCacheWrite, totalCacheRead, totalOutputTokens, totalSearchCount),
  });
}

async function* streamWithBedrock(
  model: string,
  system: SystemPrompt,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  onTokens?: (usage: TokenUsage) => void,
  tools?: ToolDefinition[]
): AsyncGenerator<string, void, unknown> {
  // Build initial Bedrock messages (grows as tool turns are added)
  let bedrockMessages: Message[] = messages.map(msg => ({
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

  // Build toolConfig from ToolDefinition array if provided
  const toolConfig = tools?.length
    ? {
        tools: tools.map(t => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.input_schema as unknown as Record<string, unknown> },
          },
        })),
      }
    : undefined;

  const MAX_TOOL_ITERATIONS = 5;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 15_000;

  // Aggregate token counts across tool-loop iterations
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (let toolIteration = 0; toolIteration < MAX_TOOL_ITERATIONS; toolIteration++) {
    const command = new ConverseStreamCommand({
      modelId: model,
      system: systemBlocks,
      messages: bedrockMessages,
      inferenceConfig: { maxTokens: Math.min(maxTokens, modelMaxOutputTokens(model)) },
      ...(toolConfig && { toolConfig: toolConfig as any }),
    });

    let stopReason = 'end_turn';
    // Collect assistant content blocks for tool-loop continuation
    const assistantBlocks: ContentBlock[] = [];
    let currentToolUse: { toolUseId: string; name: string; inputJson: string } | null = null;
    let currentText = '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await bedrockClient.send(command);

        if (response.stream) {
          for await (const event of response.stream) {
            if (event.contentBlockStart?.start) {
              const start = event.contentBlockStart.start as any;
              if (start.toolUse) {
                // Flush accumulated text before starting a tool block
                if (currentText) {
                  assistantBlocks.push({ text: currentText });
                  currentText = '';
                }
                currentToolUse = { toolUseId: start.toolUse.toolUseId, name: start.toolUse.name, inputJson: '' };
              }
            } else if (event.contentBlockDelta?.delta) {
              const delta = event.contentBlockDelta.delta as any;
              if (delta.text) {
                yield delta.text;
                currentText += delta.text;
              } else if (delta.toolUse?.input) {
                if (currentToolUse) currentToolUse.inputJson += delta.toolUse.input;
              }
            } else if (event.contentBlockStop !== undefined) {
              if (currentToolUse) {
                let input: Record<string, unknown> = {};
                try { input = JSON.parse(currentToolUse.inputJson || '{}'); } catch {}
                assistantBlocks.push({ toolUse: { toolUseId: currentToolUse.toolUseId, name: currentToolUse.name, input } } as any);
                currentToolUse = null;
              }
            } else if ((event as any).messageStop) {
              stopReason = (event as any).messageStop.stopReason ?? 'end_turn';
            } else if (event.metadata?.usage) {
              totalInputTokens  += event.metadata.usage.inputTokens      ?? 0;
              totalOutputTokens += event.metadata.usage.outputTokens     ?? 0;
              totalCacheRead    += event.metadata.usage.cacheReadInputTokens  ?? 0;
              totalCacheWrite   += event.metadata.usage.cacheWriteInputTokens ?? 0;
            }
          }
        }

        break; // streaming succeeded — exit retry loop

      } catch (err: any) {
        const isThrottle = err?.name === 'ThrottlingException' || err?.__type === 'ThrottlingException';
        if (isThrottle && attempt < MAX_RETRIES) {
          const waitMs = RETRY_DELAY_MS * (attempt + 1);
          logger.warn(`Bedrock throttled — waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
          await new Promise(res => setTimeout(res, waitMs));
          continue;
        }
        if (isThrottle) {
          throw new Error('Bedrock request throttled after retries. Wait a moment then try again, or switch to a different model.');
        }
        throw err;
      }
    }

    // Flush any remaining text block
    if (currentText) assistantBlocks.push({ text: currentText });

    // If no tool use was requested, we are done
    if (stopReason !== 'tool_use') break;

    const toolUseBlocks = assistantBlocks.filter(b => (b as any).toolUse) as Array<{ toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }>;
    if (toolUseBlocks.length === 0) break;

    // Execute tools and build tool result blocks
    const toolResultBlocks: ContentBlock[] = [];
    for (const block of toolUseBlocks) {
      let resultText: string;
      try {
        resultText = await executeTool(block.toolUse.name, block.toolUse.input);
      } catch (err: any) {
        resultText = `Tool error: ${err.message}`;
        logger.warn(`[TOOL/BEDROCK] ${block.toolUse.name} failed: ${err.message}`);
      }
      toolResultBlocks.push({
        toolResult: { toolUseId: block.toolUse.toolUseId, content: [{ text: resultText }], status: 'success' },
      } as any);
    }

    // Append assistant turn + tool results and loop
    bedrockMessages = [
      ...bedrockMessages,
      { role: 'assistant', content: assistantBlocks },
      { role: 'user', content: toolResultBlocks },
    ];
  }

  const totalInput = totalInputTokens + totalCacheWrite + totalCacheRead;
  logger.info(
    `[TOKENS] model=${model}` +
    ` | input=${totalInput} (uncached=${totalInputTokens} cache_write=${totalCacheWrite} cache_read=${totalCacheRead})` +
    ` | output=${totalOutputTokens}` +
    estimateCost(model, totalInputTokens, totalCacheWrite, totalCacheRead, totalOutputTokens)
  );

  onTokens?.({
    model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
    searchCount: 0,
    estimatedCost: calculateCost(model, totalInputTokens, totalCacheWrite, totalCacheRead, totalOutputTokens),
  });
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
