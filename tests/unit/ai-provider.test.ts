import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getActiveProvider,
  getAvailableModels,
  isValidModelId,
  resolveModelId,
  resolveAgentModel,
  modelShortLabel,
  getAgentModelLabels,
  extractValidatorFallback,
} from '../../app/backend/src/utils/ai-provider';
import {
  PROVIDER_MODELS,
  ANTHROPIC_AGENT_MODELS,
  BEDROCK_AGENT_MODELS,
} from '../../app/backend/src/utils/model-config';

// getActiveProvider() reads process.env.AI_PROVIDER at call time, so each test
// can drive the resolution functions by setting it. Restore the original after.
const ORIGINAL_PROVIDER = process.env.AI_PROVIDER;
afterEach(() => {
  if (ORIGINAL_PROVIDER === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = ORIGINAL_PROVIDER;
  vi.restoreAllMocks();
});

describe('getActiveProvider', () => {
  it('defaults to anthropic when AI_PROVIDER is unset', () => {
    delete process.env.AI_PROVIDER;
    expect(getActiveProvider()).toBe('anthropic');
  });

  it('reads each known provider, case-insensitively', () => {
    process.env.AI_PROVIDER = 'bedrock';
    expect(getActiveProvider()).toBe('bedrock');
    process.env.AI_PROVIDER = 'OLLAMA';
    expect(getActiveProvider()).toBe('ollama');
    process.env.AI_PROVIDER = 'Anthropic';
    expect(getActiveProvider()).toBe('anthropic');
  });

  it('falls back to anthropic on an unknown value', () => {
    process.env.AI_PROVIDER = 'gpt-9';
    expect(getActiveProvider()).toBe('anthropic');
  });
});

describe('getAvailableModels / isValidModelId', () => {
  it('returns the model list for the active provider', () => {
    process.env.AI_PROVIDER = 'bedrock';
    expect(getAvailableModels()).toEqual(PROVIDER_MODELS.bedrock);
    process.env.AI_PROVIDER = 'anthropic';
    expect(getAvailableModels()).toEqual(PROVIDER_MODELS.anthropic);
  });

  it('validates ids only against the active provider', () => {
    process.env.AI_PROVIDER = 'anthropic';
    const anthropicId = PROVIDER_MODELS.anthropic[0].id;
    const bedrockId = PROVIDER_MODELS.bedrock[0].id;
    expect(isValidModelId(anthropicId)).toBe(true);
    // A valid Bedrock id is not valid while anthropic is active.
    expect(isValidModelId(bedrockId)).toBe(false);
    expect(isValidModelId('made-up-model')).toBe(false);
  });
});

describe('resolveModelId', () => {
  it('returns the explicit env value when one is provided', () => {
    process.env.AI_PROVIDER = 'anthropic';
    expect(resolveModelId('some-pinned-model')).toBe('some-pinned-model');
  });

  it('falls back to a valid default model for the active provider', () => {
    for (const provider of ['anthropic', 'bedrock', 'ollama'] as const) {
      process.env.AI_PROVIDER = provider;
      const resolved = resolveModelId(undefined);
      // The per-provider default must itself be a selectable model.
      expect(isValidModelId(resolved)).toBe(true);
    }
  });
});

describe('resolveAgentModel', () => {
  it('returns the per-agent override for the active provider', () => {
    process.env.AI_PROVIDER = 'anthropic';
    expect(resolveAgentModel('analyst')).toBe(ANTHROPIC_AGENT_MODELS.analyst);
    process.env.AI_PROVIDER = 'bedrock';
    expect(resolveAgentModel('analyst')).toBe(BEDROCK_AGENT_MODELS.analyst);
  });

  it('matches dynamic per-feature stage names against their base key', () => {
    process.env.AI_PROVIDER = 'bedrock';
    // "story-decomposition" is a base key; per-feature variants must resolve to it.
    expect(resolveAgentModel('story-decomposition_F1')).toBe(
      BEDROCK_AGENT_MODELS['story-decomposition'],
    );
    expect(resolveAgentModel('qa-engineer_F3')).toBe(
      BEDROCK_AGENT_MODELS['qa-engineer'],
    );
  });

  it('falls back to the provider default for an unknown agent', () => {
    process.env.AI_PROVIDER = 'anthropic';
    const resolved = resolveAgentModel('totally-unknown-agent');
    expect(isValidModelId(resolved)).toBe(true);
  });

  it('always uses the ollama default since ollama has no per-agent map', () => {
    process.env.AI_PROVIDER = 'ollama';
    expect(resolveAgentModel('analyst')).toBe('llama3.2:1b');
    expect(resolveAgentModel('coordinator')).toBe('llama3.2:1b');
  });
});

describe('modelShortLabel', () => {
  it('detects the Claude tier regardless of provider id shape', () => {
    expect(modelShortLabel('claude-opus-4-6')).toBe('Opus');
    expect(modelShortLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet');
    expect(modelShortLabel('claude-haiku-4-5-20251001')).toBe('Haiku');
    expect(modelShortLabel('global.anthropic.claude-opus-4-6-v1')).toBe('Opus');
  });

  it('strips path and version suffixes for non-Claude ids', () => {
    expect(modelShortLabel('meta/llama3.2:1b')).toBe('llama3.2');
    expect(modelShortLabel('mistral')).toBe('mistral');
  });
});

describe('extractValidatorFallback', () => {
  // Anthropic-shaped blocks: { type: 'text', text } / { type: 'tool_use', name, input }
  const anthropicGetText = (b: any) => (b.type === 'text' ? b.text : null);
  const anthropicGetToolUse = (b: any) => (b.type === 'tool_use' ? b : null);
  // Bedrock-shaped blocks: { text } / { toolUse: { name, input } }
  const bedrockGetText = (b: any) => b.text ?? null;
  const bedrockGetToolUse = (b: any) => b.toolUse ?? null;

  const bigJson = JSON.stringify({ title: 'x'.repeat(200) });

  it('returns the validator JSON when no text was streamed (Anthropic shape)', () => {
    const messages = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'validate_backlog_json', input: { json: bigJson } }] },
    ];
    expect(extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse)).toBe(bigJson);
  });

  it('returns the validator JSON when it dwarfs a short give-up message (Bedrock shape)', () => {
    const messages = [
      { role: 'assistant', content: [
        { toolUse: { name: 'validate_backlog_json', input: { json: bigJson } } },
        { text: 'Validation kept failing, giving up.' },
      ] },
    ];
    expect(extractValidatorFallback('BEDROCK', messages, bedrockGetText, bedrockGetToolUse)).toBe(bigJson);
  });

  it('returns null when the streamed text stands on its own', () => {
    const longText = 'a'.repeat(500);
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', name: 'validate_backlog_json', input: { json: '{"a":1}' } },
        { type: 'text', text: longText },
      ] },
    ];
    expect(extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse)).toBeNull();
  });

  it('ignores non-validator tool calls entirely', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', name: 'search_web', input: { json: bigJson } }] },
    ];
    expect(extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse)).toBeNull();
  });

  it('finds a validator call in an earlier turn when the last turn has only unrelated tools', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', name: 'validate_qa_tests_json', input: { json: bigJson } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'issues' }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'search_web', input: { query: 'x' } }] },
    ];
    expect(extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse)).toBe(bigJson);
  });

  it('prefers the most recent validator call when several turns have one', () => {
    const firstJson = JSON.stringify({ draft: 1, pad: 'x'.repeat(100) });
    const secondJson = JSON.stringify({ draft: 2, pad: 'y'.repeat(100) });
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', name: 'validate_backlog_json', input: { json: firstJson } }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'validate_backlog_json', input: { json: secondJson } }] },
    ];
    expect(extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse)).toBe(secondJson);
  });

  it('repairs a truncated inner JSON string before returning it', () => {
    const truncated = '{"title": "long draft that got cut off mid-str';
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', name: 'validate_backlog_json', input: { json: truncated } }] },
    ];
    const result = extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse);
    expect(result).not.toBeNull();
    expect(() => JSON.parse(result!)).not.toThrow();
  });

  it('returns null when there is neither text nor a validator call', () => {
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: '   ' }] }];
    expect(extractValidatorFallback('ANTHROPIC', messages, anthropicGetText, anthropicGetToolUse)).toBeNull();
  });
});

describe('getAgentModelLabels', () => {
  it('returns a short label for every known pipeline agent', () => {
    process.env.AI_PROVIDER = 'anthropic';
    const labels = getAgentModelLabels();
    const agents = ['coordinator', 'analyst', 'pm_prd', 'solution_architect', 'story_decomposition', 'critic', 'curator'];
    for (const agent of agents) {
      expect(labels[agent]).toMatch(/^(Opus|Sonnet|Haiku)$/);
    }
    // analyst is the Opus-tier stage on anthropic.
    expect(labels.analyst).toBe('Opus');
  });
});
