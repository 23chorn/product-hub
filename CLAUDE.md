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

### Integration Tests (run individually, they hit real APIs)
```bash
npm run test:airtable
npm run test:claude
npm run test:gitbook
npm run test:ado
```

## Architecture

### Monorepo layout
```
app/
  backend/   Express + TypeScript (port 3001)
  frontend/  React 18 + Vite + Tailwind (port 5173)
  shared/    Compiled TypeScript types — consumed by both via `@pap/shared`
_bmad/       BMAD agent framework: persona .md files, workflow .md files, task .xml files
context/     Project context files loaded into every agent system prompt (cached in memory)
db/          SQLite database (product-ops.db) + schema.sql — db file is gitignored
data/        Conversation markdown logs + artifact exports — gitignored
```

Frontend proxies `/api/*` to the backend via Vite config. The shared package must be built (`npm run build` in `app/shared`) before type changes are visible to the backend.

### AI provider
`utils/ai-provider.ts` routes all LLM calls to Anthropic SDK, AWS Bedrock, or Ollama based on the `AI_PROVIDER` env var. The Anthropic client (`utils/anthropic-client.ts`) uses lazy initialization — it must not be instantiated at module load time because dotenv hasn't run yet.

Switch providers by changing `AI_PROVIDER=anthropic|bedrock|ollama` in `.env`. Default models are defined in `PROVIDER_MODELS` in `ai-provider.ts`. **Model selection is done at runtime from the UI** — the user picks a model from the header dropdown and it persists to `localStorage` via `stores/modelStore.ts`. The selected model is passed as an optional `model` field on every `/api/bmad/message` and `/api/bmad/menu-select` request.

To add models: edit `PROVIDER_MODELS` in `utils/ai-provider.ts` — the UI picks them up automatically on next server restart. Also add the model ID to `MODEL_MAX_OUTPUT_TOKENS` (all Claude 4.x models support 64,000) and `MODEL_PRICING` to enable cost logging.

The startup log line `🤖 AI provider: <provider> | models: <list>` confirms which provider and models are active on boot.

The config endpoint `GET /api/config/models` returns `{ provider, models }` — the frontend calls this once on app mount.

#### Prompt caching — `SystemPrompt` type
`buildSystemPrompt()` in `bmad-agent.ts` returns `SystemPrompt = string | { stable: string; dynamic?: string }`:
- **`stable`** — the large cacheable portion: agent persona + project context + workflow step files. Marked `cache_control: ephemeral` for Anthropic; a `CachePointType.DEFAULT` marker is inserted for Bedrock. Cache hits pay ~10% of normal input-token cost.
- **`dynamic`** (optional) — per-session item context injected uncached, so different sessions on the same workflow don't bust each other's cache.
- Ollama receives both parts concatenated (no caching support).

#### Token & cost logging
Every request logs a `[TOKENS]` line:
```
[TOKENS] model=claude-haiku-4-5-20251001 | input=12400 (uncached=800 cache_write=11200 cache_read=400) | output=320 | cost ~$0.003200 (in=$0.001600 out=$0.001600)
```
- `input` = total tokens processed (uncached + cache_write + cache_read)
- `uncached` = tokens billed at full input rate
- `cache_write` = tokens written to cache this request (1.25× rate, first request in a session)
- `cache_read` = tokens read from cache (0.10× rate, subsequent requests)
- Cost estimated from `MODEL_PRICING` in `ai-provider.ts`; blank if model not listed

#### Retry on throttle
Both providers retry up to 3× with 15 s linear back-off:
- Anthropic: HTTP 429 → retries, then raises a user-readable error
- Bedrock: `ThrottlingException` → same pattern

### Database
Single SQLite file at `db/product-ops.db` via `better-sqlite3` (synchronous). Schema defined in `db/schema.sql` and mirrored in `app/backend/src/data/database.ts` — keep both in sync on schema changes.

Ten tables (defined in `db/schema.sql`, mirrored in `database.ts`):

| Table | Purpose |
|-------|---------|
| `items` | Work-item registry; all sessions/workflows FK into this |
| `sessions` | One row per agent per item per sitting |
| `messages` | Full message history per session (cascade-deleted with session) |
| `artifacts` | Files produced by sessions (cascade-deleted with session) |
| `staged_decisions` | Candidate ADR entries written by agents; promoted by Decision Log agent |
| `context_loads` | Audit trail of context files loaded per session (created, currently unused) |
| `workflows` | Goal-oriented orchestration unit spanning multiple agent sessions |
| `checkpoints` | Human review pause points within a workflow |
| `context_diffs` | Proposed edits to `context/*.md` files; approved diffs are applied atomically |
| `policies` | Governance key-value rules injected into Coordinator system prompt |

Key data shape: `sessions.agent_id` uses combined strings (`'pm-prd'`, `'pm-backlog'`, `'analyst'`). `sessions.workflow_context` is a JSON blob storing `{activeWorkflow, workflowPrompt, conversationPath}`.

The `items` table is a work-item registry that sessions FK into. Ad-hoc (quick) sessions are stored as rows with `source='quick_add'`, created via the Quick Sessions sidebar UI and not tied to any Airtable initiative.

### Session & agent flow

There are two independent flows: **Coordinator flow** (the primary mode) and **Direct-access flow** (legacy, kept for reference).

#### Coordinator flow (workflow mode)
1. User selects an initiative from `AirtableItemList` or creates a local initiative.
2. User types a goal in `CoordinatorChat` → `POST /api/workflow/start` (SSE).
3. Backend streams the Coordinator's goal decomposition. The Coordinator emits a ` ```stages ` JSON array block; `extractStageSequence()` in `workflow-routes.ts` parses and validates it. If invalid or missing, falls back to `['analyst', 'pm_prd', 'pm_backlog', 'critic', 'curator']`.
4. `createWorkflow()` inserts a `workflows` row. `advanceStage()` begins processing the first stage.
5. For each regular stage (analyst, pm_prd, pm_backlog): a specialist BMAD session is created, a `checkpoints` row is inserted with `status='pending'`, and the workflow status is set to `paused_at_checkpoint`. The frontend's `CheckpointPanel` appears in the right column.
6. Human reviews the checkpoint: **Approve** → `advanceStage()` moves to next stage; **Revise** → `propagateFeedback()` appends a new stage brief to the specialist session and reruns the stage; **Reject** → `markWorkflowComplete()` ends the workflow.
7. The `critic` stage runs `CriticAgent.review()` automatically, stores the verdict in `checkpoint.coordinator_action` as JSON, and pauses at a checkpoint (human decides to approve/reject based on the verdict).
8. The `curator` stage runs `ContextCuratorAgent.runCuration()` automatically, writes `context_diffs` rows, auto-approves its own checkpoint, and throws `WORKFLOW_COMPLETE`.
9. On completion, the frontend's `CoordinatorChat` polls for pending context diffs and shows an amber badge. The user can approve or reject each diff in `ContextDiffPanel`; approved diffs are applied to `context/*.md` files atomically and the in-memory context cache is invalidated.

#### Direct-access flow (legacy reference)
1. Frontend calls `GET /api/bmad/agent-info?mode=&itemId=` — returns persona, menu (filtered by mode + ad-hoc flag), and any existing session to resume.
2. User picks a menu item or sends a message → `POST /api/bmad/start` → session created in SQLite.
3. SSE streaming on `POST /api/bmad/menu-select` and `POST /api/bmad/message`. Both filter messages to `user|assistant` before passing to the AI.
4. Conversation written to `data/sessions/{itemId}/{mode}/conversation.md` by `conversation-writer.ts` (append-only).
5. Artifacts saved to `data/sessions/{itemId}/{mode}/artifacts/` with metadata in SQLite.

#### Token cost controls (applied in `bmad-routes.ts`)
| Control | Setting | Purpose |
|---------|---------|---------|
| Rolling message window | 20 messages | Caps history sent per request for all agents |
| Artifact injection window | First 12 messages | PRD/analyst artifacts injected early only; removed after to cut input size |
| Step-file trimming | After 12 messages | Workflow step files dropped from system prompt mid-conversation |
| Brief response instruction | Always active | Agents keep mid-conversation replies short; full output only at export |

Export calls (`skipHistory: true`) bypass the message window and use full history.

### BMAD agents & workflows
Agents are loaded from `_bmad/bmm/agents/{pm|analyst}.md` — XML tags inside markdown define persona attributes (`<name>`, `<role>`, `<identity>`, `<menu>`, etc.). Workflows are markdown files under `_bmad/` loaded at menu-select time and injected into the system prompt.

`BmadAgent` in `agents/bmad-agent.ts` handles:
- Persona parsing and menu generation (filtered by mode and ad-hoc flag — quick sessions in backlog mode show only `QT` and `CH`)
- Workflow loading with all step files pre-loaded inline (BMAD's "Just-In-Time Loading" assumes file tools the LLM doesn't have in API-only mode, so `loadWorkflowPrompt()` inlines all steps from the workflow's `steps/` directory and adjacent `templates/` directory)
- User config variable substitution — `{user_name}`, `{communication_language}` etc. are resolved from `_bmad/bmm/config.yaml`; path variables like `{planning_artifacts}` are intentionally left unresolved
- Project context injection from `context/` — all `.md` files concatenated, cached in memory after first load (restart to refresh)
- Streaming via `streamAI()`

See `_bmad/README.md` for active agents, workflow steps, and template outputs.

### Project context (`context/`)
Markdown files injected into every agent's system prompt under `## Project & Company Context`. Any `.md` file in the folder is picked up automatically — no code changes needed. Files are read once on first message after server start and cached; restart the server to pick up edits.

Currently active files:
- `company.md` — company overview, team, customers, business model
- `strategy.md` — north star, OKRs, roadmap themes

Recommended additional files (create to enable):
- `tech-stack.md` — frontend/backend/infra of the product being built
- `db-schema.md` — database schema of the product being built
- `process.md` — development lifecycle, definition of ready/done, release process
- `current-state.md` — where things stand today, active work, known debt

See `context/README.md` for detailed guidelines on each file.

### Coordinator & Workflow System

The Coordinator is an LLM-driven orchestrator that decomposes a product goal into a sequence of specialist agent stages and manages the state machine that drives them. It is separate from the BMAD agent system — it does not inherit from `BmadAgent` and uses its own persona file and prompt structure.

#### Key files

| File | Role |
|------|------|
| `app/backend/src/agents/coordinator-agent.ts` | `CoordinatorAgent` class. `streamGoalDecomposition()` streams goal analysis and emits a ` ```stages ` JSON block. `generateStageBrief()` builds the handoff brief injected as the first user message of each specialist session. `buildSystemPrompt()` returns a split `{ stable, dynamic }` prompt using governance policies and current workflow state. |
| `app/backend/src/agents/critic-agent.ts` | `CriticAgent` class. `review(artifactContent, artifactType)` runs a single-shot LLM call, parses Issues/Strengths/Verdict sections, and returns a `CriticReview` object. Verdict is forced to `revise` if any CRITICAL issue is found. |
| `app/backend/src/agents/curator-agent.ts` | `ContextCuratorAgent` class. `runCuration(workflowId)` fetches all artifacts for the workflow, reads current `context/*.md` files, buffers a single LLM call, parses the JSON diff array, validates file names against known context files, and writes each diff as a `context_diffs` row. |
| `app/backend/src/agents/workflow-router.ts` | Core state machine. `createWorkflow()`, `advanceStage()` (async), `resolveCheckpoint()`, `propagateFeedback()`, `getWorkflowStatus()`, `markWorkflowComplete()`. No HTTP — pure DB + LLM orchestration logic. |
| `app/backend/src/routes/workflow-routes.ts` | Express router mounted at `/api/workflow`. Handles `POST /start` (SSE), `POST /checkpoint/resolve`, `GET /:id/status`, `GET /:id/checkpoints`. Contains `extractStageSequence()` and `validateStageSequence()` which parse/validate the Coordinator's output. |
| `app/backend/src/routes/context-diff-routes.ts` | Express router at `/api/context-diffs`. `GET /pending`, `POST /:id/approve` (applies diff atomically via temp-rename, invalidates context cache), `POST /:id/reject`. |
| `agents/personas/coordinator.md` | Coordinator persona in plain markdown (no BMAD XML). Loaded once at construction. |
| `agents/personas/critic.md` | Critic persona. Defines severity taxonomy: `[CRITICAL]`, `[MAJOR]`, `[MINOR]`. |
| `agents/personas/curator.md` | Curator persona. Evidence-only rule: only propose changes grounded in workflow artifacts. |

#### Stage sequence and validation
The Coordinator is asked to emit a ` ```stages ` JSON array block. `validateStageSequence()` rejects the candidate if it contains duplicates, unknown stage names, or is empty — falling back to the hardcoded default `['analyst', 'pm_prd', 'pm_backlog', 'critic', 'curator']`. This is important for small/local models (e.g. Ollama) that may produce garbled output.

Known stages: `analyst`, `pm_prd`, `pm_backlog`, `critic`, `curator`.
Stage → BMAD session mapping is defined in `STAGE_SESSION_MAP` in `workflow-router.ts`.

#### Stage output format specifications
`STAGE_OUTPUT_FORMATS` in `coordinator-agent.ts` defines the exact output format each specialist is briefed to produce. It is injected into `generateStageBrief()`. When adding a new stage, add an entry here so the specialist knows what format to output.

#### Policies (governance)
The `policies` DB table stores key-value rules scoped to `global`, `workflow_type`, or `agent`. Policies are loaded at runtime — no server restart required. Current built-in policy keys:
- `require_critic_review` — `"false"` removes the critic stage at workflow creation time
- `auto_approve_<stage>_output` — e.g. `auto_approve_analyst_output=true` skips the human checkpoint for that stage

#### Context cache invalidation
`bmad-agent.ts` holds a module-level `_projectContextCache: string | null`. `invalidateContextCache()` (exported) clears it. Called by `context-diff-routes.ts` after every approved diff so the next agent request loads the updated files from disk.

#### Token cost notes for coordinator agents
- `CoordinatorAgent` uses a split system prompt (`stable` = persona + policies, `dynamic` = current workflow state). The stable portion is cacheable across calls.
- `CriticAgent` and `ContextCuratorAgent` make single-shot non-streaming calls (the response is buffered, not streamed). Their prompts include artifact content which can be large — monitor token logs.
- `generateStageBrief()` warns at ~800 tokens; keep `previousOutputSummary` short.

### Frontend state
Four Zustand stores:
- `stores/sessionStore.ts` — direct-access session state: `sessionId`, `messages`, `agentInfo`, `agentMenu`, `selectedItem`, `selectedQuickItem`, `prdContent`, `backlogContent`. `clearSession()` resets chat state. `setSelectedQuickItem()` atomically sets the quick item AND forces mode to `'backlog'`.
- `stores/themeStore.ts` — dark/light preference, persisted to `localStorage('theme')`.
- `stores/modelStore.ts` — `selectedModelId` (persisted to `localStorage('selectedModel')`) and `availableModels` (loaded from `GET /api/config/models` on mount). Cleared automatically if the saved model is no longer in the provider's list.
- `stores/workflowStore.ts` — coordinator workflow state: `activeWorkflow` (WorkflowRow), `stageSequence`, `currentStage`, `completedStages`, `pendingStage`, `checkpoints`, `coordinatorMessages`, `isStreaming`, `pendingDiffCount`. `applyWorkflowStatus()` is the single function that syncs all workflow state from an API response. `resetWorkflow()` clears state and removes the `activeWorkflowId` localStorage key. On app mount, if `localStorage.activeWorkflowId` exists, the workflow is restored by fetching `GET /api/workflow/:id/status`.

Three-column resizable layout in `App.tsx` with column widths persisted to localStorage. Workflow mode is always active (the feature flag `ENABLE_WORKFLOW_MODE` defaults to `true`; set to `false` in `.env` to disable the workflow system at the API and UI level).

### Quick sessions
Quick sessions are ad-hoc sessions not tied to any Airtable initiative. They use `source='quick_add'` items in the DB. Key behaviours:
- Selecting a quick item forces `backlog` mode and disables the PRD/Analyst tabs in the header
- Backlog mode for quick sessions shows only the `QT` (Quick Tickets) and `CH` (Chat) menu items — the full `CE` (Create Epics) workflow that requires a PRD is hidden
- Deleting a quick item removes all sessions from the DB and deletes `data/sessions/{itemId}/` from disk

### Export flow
Pressing `e` in chat triggers `handleExport()` in `ChatInterface.tsx`.

**PRD / Analyst modes** — captures the last substantial assistant message (>500 chars) directly from chat history without making an API call. The captured text is passed through `cleanDocumentDraft()` which:
- Strips preamble: any text before the first `#` heading
- Strips postamble: trailing conversational lines matching patterns like "type 'e' to export", "ready for export", "let me know", "feel free", etc.

The cleaned content is pushed to the preview store then saved via `POST /api/bmad/export`. A single completion message is added to the chat (not streamed).

**Backlog mode** — full API call with `skipHistory: true`; neither the export prompt nor the response is saved to DB or conversation log. The returned JSON has code fences stripped before saving.

**Fallback** — if no substantial draft is found in PRD/analyst mode, falls back to the API-based path with a toast notification.

### Mock data
Set `USE_MOCK_DATA=true` in `.env` to bypass Airtable and use local fixture data from `app/backend/src/tests/mock-airtable-data.ts`. Useful for frontend development without a live Airtable connection.

### Airtable formula note
Use `NOT({Field})` to test for empty URL/link fields — `{Field} = BLANK()` triggers a SERVER_ERROR from Airtable's formula engine for link-type fields.
