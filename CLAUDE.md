# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev              # Start both frontend (5173) and backend (3001) concurrently
npm run dev:backend      # Backend only — tsx watch src/server.ts
npm run dev:frontend     # Frontend only — Vite
npm run validate-env     # Check required env vars before starting
```

### Build & Type Check
```bash
npm run build            # Build all workspaces
# After editing app/shared/src/types.ts, rebuild shared before type-checking:
cd app/shared && npm run build
cd app/backend && npx tsc --noEmit
```

### Tests
```bash
npm run test:unit        # Vitest unit tests (from app/backend/)
# Integration tests (hit real APIs):
npm run test:airtable
npm run test:claude
npm run test:ado
```

## Architecture

### Monorepo layout
```
app/
  backend/   Express + TypeScript (port 3001)
  frontend/  React 18 + Vite + Tailwind (port 5173)
  shared/    Compiled TypeScript types — consumed by both via `@pap/shared`
agents/
  personas/  Agent persona .md files (coordinator, analyst, pm, architect, critic, curator)
  templates/ Output templates (research.template.md, prd.template.md, backlog.template.md)
  config.yaml  User identity and preferences
context/     Project context files loaded into every agent system prompt
db/          SQLite database (product-ops.db) + schema.sql — db file is gitignored
data/        Artifact exports — gitignored
scripts/     Setup and utility scripts
```

Frontend proxies `/api/*` to the backend via Vite config. The shared package must be built (`npm run build` in `app/shared`) before type changes are visible to the backend.

### AI provider
`utils/ai-provider.ts` routes all LLM calls to Anthropic SDK, AWS Bedrock, or Ollama based on the `AI_PROVIDER` env var. The Anthropic client (`utils/anthropic-client.ts`) uses lazy initialization — it must not be instantiated at module load time because dotenv hasn't run yet.

Switch providers by changing `AI_PROVIDER=anthropic|bedrock|ollama` in `.env`. Default models are defined in `PROVIDER_MODELS` in `ai-provider.ts`. **Model selection is done at runtime from the UI** — the user picks a model from the header dropdown and it persists to `localStorage` via `stores/modelStore.ts`.

To add models: edit `PROVIDER_MODELS` in `utils/ai-provider.ts` — the UI picks them up automatically on next server restart. Also add the model ID to `MODEL_MAX_OUTPUT_TOKENS` and `MODEL_PRICING` to enable cost logging.

The config endpoint `GET /api/config/models` returns `{ provider, models }` — the frontend calls this once on app mount.

#### Prompt caching — `SystemPrompt` type
`buildSystemPrompt()` in `bmad-agent.ts` returns `SystemPrompt = string | { stable: string; dynamic?: string }`:
- **`stable`** — the large cacheable portion: agent persona + project context + output template (per-stage). Marked `cache_control: ephemeral` for Anthropic; a `CachePointType.DEFAULT` marker is inserted for Bedrock.
- **`dynamic`** (optional) — per-session item context injected uncached, so different sessions don't bust each other's cache.
- Ollama receives both parts concatenated (no caching support).

The Critic also uses a split prompt: persona (stable/cached) + document under review (dynamic/uncached).

#### Token & cost logging
Every request logs a `[TOKENS]` line:
```
[TOKENS] model=claude-haiku-4-5-20251001 | input=12400 (uncached=800 cache_write=11200 cache_read=400) | output=320 | cost ~$0.003200 (in=$0.001600 out=$0.001600)
```
- `input` = total tokens processed (uncached + cache_write + cache_read)
- `uncached` = tokens billed at full input rate
- `cache_write` = tokens written to cache this request (1.25× rate)
- `cache_read` = tokens read from cache (0.10× rate)
- Cost estimated from `MODEL_PRICING`; blank if model not listed

#### Per-workflow cost tracking
Each provider calls an `onTokens` callback after streaming. `costTracker(workflowId)` in `workflow-router.ts` accumulates cost on the `workflows.estimated_cost` column. The frontend displays running cost in the header.

#### Retry on throttle
Both providers retry up to 3× with 15 s linear back-off:
- Anthropic: HTTP 429 → retries, then raises a user-readable error
- Bedrock: `ThrottlingException` → same pattern

### Database
Single SQLite file at `db/product-ops.db` via `better-sqlite3` (synchronous). Schema defined in `db/schema.sql` and mirrored in `app/backend/src/data/database.ts` — keep both in sync on schema changes.

Twelve tables (defined in `db/schema.sql`, mirrored in `database.ts`):

| Table | Purpose |
|-------|---------|
| `items` | Work-item registry; all sessions/workflows FK into this |
| `sessions` | One row per agent per item per sitting |
| `messages` | Full message history per session (cascade-deleted with session) |
| `artifacts` | Files produced by sessions (cascade-deleted with session) |
| `workflows` | Goal-oriented orchestration unit with `estimated_cost` tracking |
| `checkpoints` | Human review pause points within a workflow |
| `workflow_events` | Stage narration events polled by the frontend |
| `coordinator_sessions` | Coordinator planning conversation persistence |
| `context_diffs` | Proposed edits to `context/*.md` files; approved diffs are applied atomically |
| `policies` | Governance key-value rules injected into Coordinator system prompt |
| `staged_decisions` | Candidate ADR entries written by agents |
| `context_loads` | Audit trail of context files loaded per session (created, currently unused) |

### Coordinator workflow (the only mode)

There is one flow: the Coordinator-driven workflow. There is no direct-access mode.

1. User types a goal in `CoordinatorChat` — Coordinator asks 1–3 rounds of clarifying questions.
2. When ready, Coordinator emits `COORDINATOR_READY` with enriched context JSON.
3. User can toggle which stages to include (at least one required) before workflow launches.
4. `POST /api/workflow/start` creates a `workflows` row. `advanceStage()` begins the first stage.
5. Default stage sequence: `['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'curator']`.
6. For each specialist stage (analyst, pm_prd, solution_architect, pm_backlog):
   - `runAutonomousStage()` creates a session, builds a stage brief via the Coordinator, runs the specialist with its output template injected, collects the full response, saves an artifact.
   - Inline critic reviews the output. If issues found, auto-revises up to 2×. If still unresolved, pauses for human.
   - If critic passes (or after max revisions), creates a `pending` checkpoint. Workflow status → `paused_at_checkpoint`.
   - Human reviews: **Approve** → next stage; **Revise** → rerun with feedback; **Reject** → workflow ends.
7. Curator stage runs automatically, writes `context_diffs` rows, workflow completes.
8. After completion, user can **redo from any stage** with feedback — that stage and all downstream stages rerun.

#### Key files

| File | Role |
|------|------|
| `agents/coordinator-agent.ts` | `CoordinatorAgent` class. Planning sessions, stage briefs, mid-workflow chat. Split `{ stable, dynamic }` prompt. |
| `agents/critic-agent.ts` | `CriticAgent` class. Single-shot review with split prompt for caching. Parses Issues/Strengths/Verdict. |
| `agents/curator-agent.ts` | `ContextCuratorAgent` class. Fetches artifacts, reads context files, proposes diffs. |
| `agents/bmad-agent.ts` | `BmadAgent` class. Persona loading, project context injection, per-stage template injection, streaming. |
| `agents/workflow-router.ts` | Core state machine. `createWorkflow()`, `advanceStage()`, `runAutonomousStage()`, `resolveCheckpoint()`, `propagateFeedback()`, `reiterateFromStage()`, cost tracking. |
| `routes/workflow-routes.ts` | Express router at `/api/workflow`. Coordinator planning SSE, workflow start, checkpoint resolve, mid-workflow message, events, history. |
| `routes/context-diff-routes.ts` | `/api/context-diffs`. Approve/reject proposed context file changes. |
| `routes/context-file-routes.ts` | `/api/context-files`. GET/PUT for editing context files from the UI. |
| `routes/template-file-routes.ts` | `/api/template-files`. GET/PUT for editing output templates from the UI. |

#### Per-stage template injection
`STAGE_TEMPLATE_MAP` in `bmad-agent.ts` maps stage names to template files:
- `analyst` → `research.template.md`
- `pm_prd` → `prd.template.md`
- `solution_architect` → `architecture.template.md`
- `pm_backlog` → `backlog.template.md`

Only the relevant template is injected into the system prompt for each stage. Templates are read from disk each time — no caching, so UI edits take effect on the next stage run.

#### Stage output format specifications
`STAGE_OUTPUT_FORMATS` in `coordinator-agent.ts` defines inline format specs injected into `generateStageBrief()`. When adding a new stage, add entries in both `STAGE_OUTPUT_FORMATS` and `STAGE_TEMPLATE_MAP`.

#### Policies (governance)
The `policies` DB table stores key-value rules. Loaded at runtime — no restart needed. Key policies:
- `require_critic_review` — `"false"` disables inline critic after each specialist stage
- `auto_approve_critic` — `"true"` auto-resolves critic approvals without human gate

#### Context cache invalidation
`bmad-agent.ts` holds a module-level `_projectContextCache`. `invalidateContextCache()` (exported) clears it. Called by `context-diff-routes.ts` and `context-file-routes.ts` after changes so the next agent request reloads from disk.

### Agent patterns

Two agent patterns exist:

- **Pattern A (BMAD)** — specialist document-producing agents: Analyst, PM, Architect. Extend `BmadAgent`. Persona files use XML tags inside markdown (`<agent>`, `<role>`, `<identity>`, etc.). Loaded from `agents/personas/`.
- **Pattern B (plain class)** — orchestration/review agents: Coordinator, Critic, Curator. No `BmadAgent` inheritance. Load persona via `readFileSync`. May still use `streamAI()`.

### Frontend state
Zustand stores:
- `stores/workflowStore.ts` — all workflow state: `activeWorkflow` (WorkflowRow with `estimated_cost`), `stageSequence`, `currentStage`, `completedStages`, `checkpoints`, `coordinatorMessages`, `isStreaming`, `pendingDiffCount`. `applyWorkflowStatus()` syncs from API. `resetWorkflow()` clears everything.
- `stores/sessionStore.ts` — `selectedItem` for initiative selection.
- `stores/modelStore.ts` — `selectedModelId` (persisted to `localStorage`), `availableModels`.
- `stores/themeStore.ts` — dark/light preference.
- `stores/contextEditorStore.ts` — open/close state for Context Editor modal.
- `stores/templateEditorStore.ts` — open/close state for Template Editor modal.

Two-column layout in `App.tsx`: left sidebar (stage tracker or workflow history) + main chat (CoordinatorChat). Header has model selector, Context/Templates/Decision Log buttons, and theme toggle.

### Project context (`context/`)
Markdown files injected into every agent's system prompt under `## Project & Company Context`. Any `.md` file in the folder is picked up automatically. Cached in memory; cache invalidated automatically when files are saved via the UI or when context diffs are approved.

Six canonical files (see `context/README.md`):
- `company.md`, `strategy.md` — have `.example.md` templates
- `tech-stack.md`, `db-schema.md`, `process.md`, `current-state.md` — create to enable

### Output templates (`agents/templates/`)
Three template files define the structure specialists follow:
- `research.template.md` — Analyst output format
- `prd.template.md` — PRD output format
- `backlog.template.md` — Backlog output format (max 6 features/epic, max 8 stories/feature)

Editable from the UI (Templates button in header). Changes require double-confirmation. Templates are read from disk per-stage, so edits take effect on the next stage run.

### Integration providers
Configured via `app/backend/src/config/app-config.ts`:
- `ROADMAP_INTEGRATION=airtable|none` — initiative source
- `WORK_ITEMS_INTEGRATION=ado|jira|none` — backlog export target
- `KNOWLEDGE_BASE_INTEGRATION=notion|none` — external knowledge

Provider implementations in `app/backend/src/integrations/`.

### Mock data
Set `USE_MOCK_DATA=true` in `.env` to bypass Airtable and use fixture data. Useful for development without a live Airtable connection.

### Airtable formula note
Use `NOT({Field})` to test for empty URL/link fields — `{Field} = BLANK()` triggers a SERVER_ERROR from Airtable's formula engine for link-type fields.
