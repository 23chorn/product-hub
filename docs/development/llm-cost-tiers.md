# LLM Cost Tiers for Development

## Tier 0 — Pipeline testing (default)
Provider: Ollama | Model: llama3.2:1b
Use for: All development work. Verifying E2E flow, checkpoint logic,
         DB writes, SSE streaming, frontend state. Output quality irrelevant.
Cost: Free. Runs locally, no API calls.
Switch: AI_PROVIDER=ollama in .env (default)

## Tier 1 — Output quality testing
Provider: Anthropic | Model: claude-haiku-4-5-20251001
Use for: Checking that agent prompts and templates produce usable output.
         Run after completing STORY-2.4 (template audit).
Cost: ~$0.001 per full pipeline run.
Switch: AI_PROVIDER=anthropic + ANTHROPIC_API_KEY in .env

## Tier 2 — Acceptance testing
Provider: Anthropic | Model: claude-sonnet-4-6 or claude-opus-4-6
Use for: Final validation before shipping. Confirming output meets
         the quality bar for real PM use.
Cost: ~$0.05–0.20 per full pipeline run.
Switch: AI_PROVIDER=anthropic, select model from UI header dropdown
