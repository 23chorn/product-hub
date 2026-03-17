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
npm run test:bedrock
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
  config.example.yaml  Template for user config (tracked)
  config.yaml  User identity and preferences (gitignored)
context/     Project context files loaded into every agent system prompt
db/          SQLite database (product-ops.db) + schema.sql — db file is gitignored
data/        Artifact exports — gitignored
scripts/     Setup and utility scripts
```

Frontend proxies `/api/*` to the backend via Vite config. The shared package must be built (`npm run build` in `app/shared`) before type changes are visible to the backend.

### AI provider
`utils/ai-provider.ts` routes all LLM calls to Anthropic SDK, AWS Bedrock, or Ollama based on the `AI_PROVIDER` env var. The Anthropic client (`utils/anthropic-client.ts`) uses lazy initialization — it must not be instantiated at module load time because dotenv hasn't run yet.

Switch providers by changing `AI_PROVIDER=anthropic|bedrock|ollama` in `.env`. Default models are defined in `PROVIDER_MODELS` in `utils/model-config.ts`. **Model selection is done at runtime from the UI** — the user picks a model from the header dropdown and it persists to `localStorage` via `stores/modelStore.ts`.

To add models: edit `PROVIDER_MODELS` in `utils/model-config.ts` — the UI picks them up automatically on next server restart. Also add the model ID to `MODEL_MAX_OUTPUT_TOKENS` and `MODEL_PRICING` in the same file to enable cost logging. Model config (pricing, token limits, per-agent assignments) is centralised in `utils/model-config.ts`; `ai-provider.ts` re-exports the key symbols for backwards compatibility.

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

Fifteen tables (defined in `db/schema.sql`, mirrored in `database.ts`):

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
| `change_requests` | Post-completion change requests with impact assessment and status tracking |
| `cr_artifact_versions` | Links CRs to new artifact versions and their parents |
| `ado_work_item_map` | Maps local backlog keys to ADO work item IDs for sync |

### Coordinator workflow (the only mode)

There is one flow: the Coordinator-driven workflow. There is no direct-access mode.

1. User types a goal in `CoordinatorChat` — Coordinator reads `company.md`, `strategy.md`, and `current-state.md` from `context/` before asking any questions, and skips topics already covered there. It emits `COORDINATOR_READY` as soon as it can state: (1) what problem is being solved, (2) who the target user is, (3) the scope boundary (MVP vs deferred), and (4) any hard constraints. No more than 3 message rounds regardless of remaining ambiguity.
2. When ready, Coordinator emits `COORDINATOR_READY` with enriched context JSON.
3. User can toggle which stages to include (at least one required) before workflow launches.
4. `POST /api/workflow/start` creates a `workflows` row. `advanceStage()` begins the first stage.
5. Default stage sequence: `['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'curator']`.
6. For each specialist stage (analyst, pm_prd, solution_architect, pm_backlog):
   - `runAutonomousStage()` creates a session, builds a stage brief via the Coordinator, runs the specialist with its output template injected, collects the full response, saves an artifact.
   - Inline critic reviews the output. If issues found, auto-revises **up to 2×** using conversation threading: the prior draft is injected as the assistant turn in a 3-message array `[user: brief, assistant: prior draft, user: revision directive]`, causing targeted edits rather than a full regeneration. If still unresolved after 2 revisions, pauses for human.
   - If critic passes (or after max revisions), creates a `pending` checkpoint. Workflow status → `paused_at_checkpoint`.
   - Human reviews: **Approve** → next stage; **Revise** → rerun with feedback; **Reject** → workflow ends.
   - Human feedback is classified before routing: **output correction** → routed to specialist for revision (using the same conversation threading: `[user: brief, assistant: prior draft, user: revision directive]`); **scope change** → workflow stops and confirms with human before proceeding; **upstream gap** → flags the earlier stage and offers to redo from there.
7. Curator stage runs automatically, writes `context_diffs` rows, workflow completes.
8. After completion, user can **redo from any stage** with feedback — that stage and all downstream stages rerun (critic skipped).

#### Key files

| File | Role |
|------|------|
| `agents/coordinator-agent.ts` | `CoordinatorAgent` class. Planning sessions, stage briefs, mid-workflow chat. Split `{ stable, dynamic }` prompt. |
| `agents/critic-agent.ts` | `CriticAgent` class. Single-shot review with split prompt for caching. Parses Issues/Strengths/Verdict. Uses **stage-specific review criteria**: `buildStageInstructions(stage)` injects enforcement reminders per stage (analyst, pm_prd, solution_architect, pm_backlog), each with specific CRITICAL/MAJOR/MINOR rules for that artifact type. Full rules live in `agents/personas/critic.md` under `## Stage-Specific Checks`. |
| `agents/curator-agent.ts` | `ContextCuratorAgent` class. Fetches artifacts, reads context files, proposes diffs. |
| `agents/bmad-agent.ts` | `BmadAgent` class. Persona loading, project context injection, per-stage template injection, streaming. |
| `agents/workflow-router.ts` | Core state machine. `createWorkflow()`, `advanceStage()`, `runAutonomousStage()`, `resolveCheckpoint()`, `propagateFeedback()`, `reiterateFromStage()`, cost tracking. |
| `agents/stage-metadata.ts` | Stage constants: `STAGE_SESSION_MAP`, `STAGE_MAX_OUTPUT_TOKENS`, `STAGE_ARTIFACT_TYPE`, `STAGE_ARTIFACT_LABEL`, `STAGE_LABELS_INTERNAL`, `STAGE_LABELS_BRIEF`, `stageGoal()`, `stageNotDecide()`. Shared by workflow-router and coordinator-agent. |
| `agents/artifact-helpers.ts` | DB/filesystem helpers for loading and saving artifacts: `saveCriticArtifact()`, `loadLatestArtifactForItem()`, `loadLatestArtifactForStage()`, `loadFullArtifact()`, `getLatestArchitectureArtifactPath()`, `getLatestArtifactPathByType()`. |
| `agents/sprint-estimation.ts` | `loadSprintConfig()` reads `agents/config.yaml`; `injectSprintEstimates(parsed)` mutates a backlog JSON object with sprint metadata. Called from `runAutonomousStage()`. |
| `agents/workflow-lifecycle.ts` | `deleteWorkflow()`, `recoverStaleWorkflows()`, `startStaleRecoveryTimer()`. Re-exported from workflow-router for backwards compatibility. |
| `agents/change-request.ts` | CR lifecycle: create, assess impact (streamed), execute targeted stages, link artifact versions. |
| `routes/change-request-routes.ts` | REST endpoints for CRs: CRUD, assess (SSE), execute, version-info, ADO mappings. |
| `utils/model-config.ts` | All model/pricing config: `PROVIDER_MODELS`, `ANTHROPIC_AGENT_MODELS`, `MODEL_MAX_OUTPUT_TOKENS`, `MODEL_PRICING`, `estimateCost()`, `calculateCost()`. |
| `utils/revision-diff.ts` | `computeRevisionDiff()` — pure LCS-based line diff used for revision artifacts. |
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
`STAGE_OUTPUT_FORMATS` in `coordinator-agent.ts` defines inline format specs injected into `generateStageBrief()`. `generateStageBrief()` now produces a **structured 8-field brief schema** rather than flat sections. The fields are: Goal, Original request, Constraints, Prior stage outputs available, Key decisions already made, Human preferences expressed, Output required, What this specialist must NOT decide. The parameter previously named `previousOutputSummary` has been renamed to `additionalContext` (used for critic feedback on the auto-revise path). When adding a new stage, add entries in `STAGE_OUTPUT_FORMATS`, `STAGE_TEMPLATE_MAP`, and the stage metadata maps in `agents/stage-metadata.ts` (`STAGE_SESSION_MAP`, `STAGE_ARTIFACT_TYPE`, `STAGE_ARTIFACT_LABEL`, `STAGE_LABELS_BRIEF`, `stageGoal()`, `stageNotDecide()`).

#### Policies (governance)
The `policies` DB table stores key-value rules. Loaded at runtime — no restart needed. Key policies:
- `require_critic_review` — `"false"` disables inline critic after each specialist stage
- `auto_approve_critic` — `"true"` auto-resolves critic approvals without human gate

#### Context cache invalidation
`bmad-agent.ts` holds a module-level `_projectContextCache`. `invalidateContextCache()` (exported) clears it. Called by `context-diff-routes.ts` and `context-file-routes.ts` after changes so the next agent request reloads from disk.

### Change Request system

After a workflow completes, targeted changes can be made without full-stage reruns via **Change Requests (CRs)**.

#### Flow
1. User clicks "Change Request" in the completion section → fills type + description
2. `POST /api/workflow/:id/change-request` creates a `change_requests` row
3. `POST /api/change-request/:crId/assess` streams a Coordinator impact assessment (SSE) → determines `affected_stages`
4. User confirms which stages to update → `POST /api/change-request/:crId/execute`
5. Only confirmed stages run (not all downstream). Each stage uses conversation threading (prior draft as assistant turn) via `reiterateFromStage()`. Checkpoints created for review.
6. On completion → CR status → `complete`, original stage sequence restored.

#### Key files
| File | Role |
|------|------|
| `agents/change-request.ts` | CR lifecycle: `createChangeRequest()`, `assessImpact()`, `executeChangeRequest()`, `linkCRArtifactVersion()` |
| `routes/change-request-routes.ts` | REST endpoints: create, list, assess (SSE), execute, cancel, version-info, ado-mappings |
| `coordinator-agent.ts` | `generateCRBrief()` — builds CR-specific revision briefs |

#### DB tables
- `change_requests` — one row per CR with type, description, impact_assessment (JSON), status
- `cr_artifact_versions` — links CR → new artifact → parent artifact with version number
- `ado_work_item_map` — maps local backlog keys (F1, F1.S1) to ADO work item IDs for sync

#### CR events
`cr_created`, `cr_assessed`, `cr_stage_started`, `cr_stage_completed`, `cr_complete` — emitted via existing `insertEvent()`.

### ADO sync

`POST /api/workflow/:id/push-to-board` is now sync-aware:
- First push: creates items and persists `ado_work_item_map` rows
- Subsequent pushes: diff-based update via `AzureDevOpsClient.updateBacklog()` — updates changed items, creates new ones
- Response includes `{ synced: true, created: N, updated: N }` when updating
- Frontend shows "Sync to Board" button when mappings exist

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

Two-column layout in `App.tsx`: left sidebar (stage tracker, workflow history, or initiative list) + main chat (CoordinatorChat). Header has model selector, Context/Templates/Decision Log buttons, and theme toggle.

#### Shared frontend modules
- `constants/stage-labels.ts` — `STAGE_LABELS`, `TOGGLEABLE_STAGES`, `STAGE_SHORT_LABELS`. Shared across `CoordinatorChat`, `ArtifactViewer`, `WorkflowStageTracker`, `WorkflowHistory`.
- `utils/coordinator-helpers.ts` — `stripReadyMarker()`, `extractReadyPayload()`, `parseCriticData()`, `criticSummaryLine()`. Used by `CoordinatorChat` and `InlineCheckpointActions`.
- `utils/backlog-helpers.ts` — Backlog JSON types (`BacklogData`, `BacklogStory`, `BacklogFeature`) and utilities (`tryParseBacklog()`, `getAllStories()`, etc.). Used by `ArtifactViewer`, `BacklogView`, `PersonaPanel`.
- `components/InlineCheckpointActions.tsx` — extracted from `CoordinatorChat`; handles approve/revise/reject for inline checkpoints.

#### Artifact viewer
`ArtifactViewer.tsx` renders specialist outputs in a right-side drawer panel:
- **Fullscreen toggle** — expands panel to fill screen; content constrained to `max-w-4xl` for readability
- **Backlog preview** — `BacklogView.tsx` renders structured view with epic header (sprint estimate), features (per-feature sprint estimate), expandable stories with AC formatting (Given/When/Then on separate lines, keywords bolded). Types and utilities in `utils/backlog-helpers.ts`.
- **Persona panel** — `PersonaPanel.tsx` renders fullscreen-only sidebar showing unique personas with story counts, expandable to see which stories reference each persona
- **Push to Board** — shown only when workflow is complete and backlog approved; pushes to ADO/Jira
- Supports both flat stories (`epic.stories`) and feature-wrapped stories (`features[].stories`)

#### Initiative list
`AirtableItemList.tsx` shows local initiatives (always) and Airtable roadmap items (when configured):
- Workflow status badges (active/paused/done) on both local and roadmap items
- Selecting an initiative with an existing workflow restores full workflow state
- AI-generated workflow summary shown as the initiative display name

#### Workflow history
`WorkflowHistory.tsx` shows past workflows with:
- Status badges (done/paused/active)
- Stage badges showing which agent steps were enabled (Research, PRD, Arch, Backlog)

### Project context (`context/`)
Markdown files injected into every agent's system prompt under `## Project & Company Context`. Any `.md` file in the folder is picked up automatically. Cached in memory; cache invalidated automatically when files are saved via the UI or when context diffs are approved.

Six canonical files (see `context/README.md`):
- `company.md`, `strategy.md` — have `.example.md` templates
- `tech-stack.md`, `db-schema.md`, `process.md`, `current-state.md` — create to enable

### Output templates (`agents/templates/`)
Four template files define the structure specialists follow:
- `research.template.md` — Analyst output format
- `prd.template.md` — PRD output format
- `architecture.template.md` — Architecture output format
- `backlog.template.md` — Backlog output format. Right-sizes output based on scope: single story (no feature wrapper), small feature (2–5 stories flat on epic), or multi-feature epic (max 6 features, max 12 stories/feature)

Editable from the UI (Templates button in header). Changes require double-confirmation. Templates are read from disk per-stage, so edits take effect on the next stage run.

#### Sprint estimation
After the backlog specialist produces output, `agents/sprint-estimation.ts` parses the JSON and injects sprint estimates:
- Reads `sprint_velocity` and `capacity_factor` from `agents/config.yaml`
- `effectiveVelocity = sprintVelocity × capacityFactor`
- `sprintsRequired = totalEffort / effectiveVelocity` (rounded to 1 decimal)
- Sprint estimates are calculated at both **epic level** (total) and displayed per **feature** in the UI
- The frontend uses `Math.ceil()` for stakeholder-facing display, raw decimals for internal comparison

### Integration providers
Configured via `app/backend/src/config/app-config.ts`:
- `ROADMAP_INTEGRATION=airtable|none` — initiative source
- `WORK_ITEMS_INTEGRATION=ado|jira|none` — backlog export target
- `KNOWLEDGE_BASE_INTEGRATION=notion|none` — external knowledge

Provider implementations in `app/backend/src/integrations/`.

#### Azure DevOps integration
`integrations/azure-devops.ts` pushes approved backlogs to ADO:
- Creates Epic → Feature → Story hierarchy using JSON Patch operations
- Story descriptions use `As a / I want / So that` format in HTML
- Acceptance criteria use `Given/When/Then` format with bolded keywords and line breaks
- Story point estimates mapped to `Microsoft.VSTS.Scheduling.Effort`
- Story type configurable via `AZURE_DEVOPS_STORY_TYPE` env var (default: "User Story"; Scrum template uses "Product Backlog Item")
- Flat backlog structure (no features) is normalised into a single feature before pushing
- Phase 2+ features are grouped into **separate epics** per phase (e.g. "Phase 2 — [Epic Title]"), but only when MVP features also exist alongside them. If all features are in the same phase, a single epic is created.

### Mock data
Set `USE_MOCK_DATA=true` in `.env` to bypass Airtable and use fixture data. Useful for development without a live Airtable connection.

### Airtable formula note
Use `NOT({Field})` to test for empty URL/link fields — `{Field} = BLANK()` triggers a SERVER_ERROR from Airtable's formula engine for link-type fields.
