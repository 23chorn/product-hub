# LLM Provider Setup

The agent supports three LLM providers selectable via the `AI_PROVIDER` environment variable.

## Providers

### Ollama (default for development)

Runs models locally. Zero cost, no internet required after the model is pulled.

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434   # optional, this is the default
```

**Setup:**
1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull the default model: `ollama pull llama3.2:1b`
3. Start Ollama: `ollama serve` (or it starts automatically on macOS)

The default Ollama model is `llama3.2:1b` — fast and small, suitable for development. For better quality at the cost of speed and memory, try `llama3.2:3b` or `llama3.1:8b`.

To add a model, pull it with `ollama pull <name>`, then add it to `PROVIDER_MODELS.ollama` in `app/backend/src/utils/ai-provider.ts`.

---

### Anthropic Claude (recommended for production)

Uses the Anthropic API. Requires an API key and incurs per-token cost.

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

**Setup:**
1. Create an account at [anthropic.com](https://www.anthropic.com)
2. Go to **API Keys** in the console and create a key
3. Set `ANTHROPIC_API_KEY` in `.env`

**Available models** (selected from the UI header dropdown):

| Model | Speed | Cost |
|-------|-------|------|
| claude-haiku-4-5-20251001 | Fast | Low (~$0.001/run) |
| claude-sonnet-4-5-20250929 | Balanced | Medium (~$0.01/run) |
| claude-opus-4-6 | Slow | High (~$0.10/run) |

Prompt caching is enabled automatically for Anthropic — repeated system prompts (agent persona + project context) are cached, cutting input-token cost by ~90% after the first request in a session.

---

### AWS Bedrock

Uses Anthropic models via AWS Bedrock. Requires AWS credentials and Bedrock model access.

```env
AI_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Or use IAM roles / instance profiles — no key vars needed if role is attached
```

**Setup:**
1. Enable Bedrock model access in the [AWS console](https://console.aws.amazon.com/bedrock/home#/modelaccess) for the Claude models you need
2. Ensure your IAM role/user has `bedrock:InvokeModel` permission
3. Set `AWS_REGION` to the region where you enabled model access

Prompt caching works on Bedrock using `CachePointType.DEFAULT` markers. Token logging includes cache read/write costs.

---

## Switching providers

Change `AI_PROVIDER` in `.env` and restart the server. The startup log confirms the active provider and available models:

```
🤖 AI provider: anthropic | models: claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929, claude-opus-4-6
```

The model dropdown in the UI header always reflects the current provider's model list.

## Adding models

Edit `PROVIDER_MODELS` in `app/backend/src/utils/ai-provider.ts`. Also add the model ID to:
- `MODEL_MAX_OUTPUT_TOKENS` — max tokens for that model
- `MODEL_PRICING` — cost per million tokens (enables the `[TOKENS]` cost log line)
