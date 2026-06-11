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
  personas/  Agent persona .md files (coordinator, analyst, pm, architect, critic, curator, qa-engineer, prototype-builder, android-engineer, ios-engineer, backend-engineer)
  templates/ Output templates (research.template.md, prd.template.md, backlog.template.md, qa-tests.template.md, architecture.template.md, prototype.template.md)
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
`buildSystemPrompt()` in `specialist-agent.ts` returns `SystemPrompt = string | { stable: string; dynamic?: string }`:
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
5. **New default pipeline** (feature-by-feature mode): `['analyst', 'pm_prd', 'epic_feature_planner', 'story_decomposition_F1', 'story_decomposition_F2', 'story_decomposition_F3', 'curator']`
   - **Epic Feature Planner** creates high-level epic + features (no stories) and pushes epic + feature shells to Azure DevOps
   - **Story Decomposition (per-feature)** runs 7-agent collaborative refinement for each feature:
     - Product (Shard) breaks feature into user stories with acceptance criteria
     - QA (Vera) generates test cases for each story (embedded in story JSON)
     - Platform engineers (Finn=Backend, Remi=iOS, Cole=Android) add technical acceptance criteria and platform tags
     - Stories are accumulated across features and pushed incrementally to existing ADO features
     - Test cases extracted and pushed to ADO Test Plans with links to parent stories
6. For each specialist stage (analyst, pm_prd, epic_feature_planner):
   - `runAutonomousStage()` creates a session, builds a stage brief via the Coordinator, runs the specialist with its output template injected, collects the full response, saves an artifact.
   - Inline critic reviews the output. If issues found, auto-revises **up to 2×** using conversation threading: the prior draft is injected as the assistant turn in a 3-message array `[user: brief, assistant: prior draft, user: revision directive]`, causing targeted edits rather than a full regeneration. If still unresolved after 2 revisions, pauses for human.
   - If critic passes (or after max revisions), creates a `pending` checkpoint. Workflow status → `paused_at_checkpoint`.
   - Human reviews: **Approve** → next stage; **Revise** → rerun with feedback; **Reject** → workflow ends.
   - Human feedback is classified before routing: **output correction** → routed to specialist for revision (using the same conversation threading: `[user: brief, assistant: prior draft, user: revision directive]`); **scope change** → workflow stops and confirms with human before proceeding; **upstream gap** → flags the earlier stage and offers to redo from there.
7. For each multi-agent refinement stage (story_decomposition_F1/F2/F3):
   - `runMultiAgentRefinement()` loads the feature from demo fixture (or runs real agents)
   - Stories are accumulated: F1 initializes backlog, F2/F3 append to existing backlog
   - `pushFeatureToADO()` adds stories to the existing feature (created by epic_feature_planner), with platform tags as ADO tags and technical details in description/acceptance criteria
   - Test cases extracted from each story and pushed to ADO Test Plans with `TestedBy` links
   - Checkpoint created with two URLs: Feature URL and Test Plan URL
   - Duplicate prevention: if stories already exist for this feature, skip creation
8. Curator stage runs automatically, writes `context_diffs` rows, workflow completes.
9. After completion, user can **redo from any stage** with feedback — that stage and all downstream stages rerun (critic skipped).

#### Key files

| File | Role |
|------|------|
| `agents/coordinator-agent.ts` | `CoordinatorAgent` class. Planning sessions, stage briefs, mid-workflow chat. Split `{ stable, dynamic }` prompt. |
| `agents/critic-agent.ts` | `CriticAgent` class. Single-shot review with split prompt for caching. Parses Issues/Strengths/Verdict. Uses **stage-specific review criteria**: `buildStageInstructions(stage)` injects enforcement reminders per stage (analyst, pm_prd, solution_architect, pm_backlog), each with specific CRITICAL/MAJOR/MINOR rules for that artifact type. Full rules live in `agents/personas/critic.md` under `## Stage-Specific Checks`. |
| `agents/curator-agent.ts` | `ContextCuratorAgent` class. Fetches artifacts, reads context files, proposes diffs. |
| `agents/specialist-agent.ts` | `SpecialistAgent` class. Persona loading, project context injection, per-stage template injection, streaming. |
| `agents/workflow-router.ts` | Core state machine entry point. `createWorkflow()`, `advanceStage()`, checkpoint management (`completeStage`, `resolveCheckpoint`, `pauseAtCheckpoint`, `markWorkflowComplete`), `getWorkflowStatus()`. Re-exports from sub-modules for backward compatibility. |
| `agents/workflow-db.ts` | Shared workflow infrastructure: types (`WorkflowRow`, `CheckpointRow`, `WorkflowStatus`, `WorkflowEvent`, `StageTokenData`), prepared statements, helpers (`insertEvent`, `costTracker`, `addWorkflowCost`), and `workflowOps` late-binding registry for circular dep resolution. |
| `agents/workflow-stage-runner.ts` | `runAutonomousStage()` — fire-and-forget background task: builds per-stage context, streams specialist LLM output, saves artifacts, runs inline critic review, creates checkpoints. Handles multi-agent refinement stages (`story_decomposition_F*`) by calling `runMultiAgentRefinement()`, accumulating features, and pushing to ADO. Also exports lazy singletons (`getCoordinator`, `getCritic`, `getCurator`) and `SILENT_STAGES`. |
| `agents/multi-agent-refinement.ts` | 7-agent collaborative refinement orchestrator for feature decomposition. In demo mode, loads fixture; in real mode, coordinates Product (Shard), QA (Vera), and platform engineers (Finn, Remi, Cole) to produce enriched stories with test cases. |
| `agents/feature-decomposition.ts` | Feature-by-feature ADO push logic: `pushEpicAndFeaturesToADO()` creates epic + feature shells after epic_feature_planner; `pushFeatureToADO()` adds stories to existing features with platform tags, technical ACs, and test plan creation. Prevents duplicate story creation. |
| `agents/ado-stage-push.ts` | ADO auto-push helpers for stage completion: `pushBacklogToAdo()` for full backlog (legacy pm_backlog stage), `pushTestPlanToAdo()` for QA test suites. |
| `agents/workflow-mutations.ts` | Post-completion workflow modifications: `propagateFeedback()`, `reiterateFromStage()`, `extendWorkflow()`, `retryCurrentStage()`. |
| `agents/stage-metadata.ts` | Stage constants: `STAGE_SESSION_MAP`, `STAGE_MAX_OUTPUT_TOKENS`, `STAGE_ARTIFACT_TYPE`, `STAGE_ARTIFACT_LABEL`, `STAGE_LABELS_INTERNAL`, `STAGE_LABELS_BRIEF`, `STAGE_OUTPUT_FORMATS`, `stageGoal()`, `stageNotDecide()`. Shared by workflow modules and coordinator-agent. |
| `agents/artifact-helpers.ts` | DB/filesystem helpers for loading and saving artifacts: `saveCriticArtifact()`, `loadLatestArtifactForItem()`, `loadLatestArtifactForStage()`, `loadFullArtifact()`, `getLatestArchitectureArtifactPath()`, `getLatestArtifactPathByType()`. |
| `agents/sprint-estimation.ts` | `loadSprintConfig()` reads `agents/config.yaml`; `injectSprintEstimates(parsed)` mutates a backlog JSON object with sprint metadata. Called from `runAutonomousStage()`. |
| `agents/workflow-lifecycle.ts` | `deleteWorkflow()`, `recoverStaleWorkflows()`, `startStaleRecoveryTimer()`. Re-exported from workflow-router for backwards compatibility. |
| `agents/change-request.ts` | CR lifecycle: create, assess impact (streamed), execute targeted stages, link artifact versions. |
| `routes/change-request-routes.ts` | REST endpoints for CRs: CRUD, assess (SSE), execute, version-info, ADO mappings. |
| `agents/prototype-agent.ts` | Prototype generation: loads workflow artifacts + design system tokens, streams React prototype JSON via AI. Saves as artifact. |
| `routes/prototype-routes.ts` | REST endpoints: `POST /api/workflow/:id/prototype/generate` (SSE), `GET /api/workflow/:id/prototype`. |
| `utils/model-config.ts` | All model/pricing config: `PROVIDER_MODELS`, `ANTHROPIC_AGENT_MODELS`, `MODEL_MAX_OUTPUT_TOKENS`, `MODEL_PRICING`, `estimateCost()`, `calculateCost()`. |
| `utils/revision-diff.ts` | `computeRevisionDiff()` — pure LCS-based line diff used for revision artifacts. |
| `routes/workflow-routes.ts` | Express router at `/api/workflow`. Coordinator planning SSE, workflow start, checkpoint resolve, mid-workflow message, events, history. |
| `routes/context-diff-routes.ts` | `/api/context-diffs`. Approve/reject proposed context file changes. |
| `routes/context-file-routes.ts` | `/api/context-files`. GET/PUT for editing context files from the UI. |
| `routes/template-file-routes.ts` | `/api/template-files`. GET/PUT for editing output templates from the UI. |
| `routes/demo-webhook-routes.ts` | `POST /api/demo/webhook/trigger` — creates an initiative and launches a full workflow pipeline autonomously (no coordinator planning), cycling through 4 sample initiatives. Default stages include `qa_engineer` and `tech_refinement`. |
| `routes/persona-routes.ts` | REST endpoints for reading agent persona files and templates. |
| `demo/ws-ai-coding-handler.ts` | WebSocket handler at `/ws/ai-coding`. Loads workflow context (goal, backlog artifact, ADO tickets) and spawns a local `claude --print` CLI session, streaming output line-by-line. Falls back to mock stream if CLI not found. |
| `demo/ws-demo-handler.ts` | WebSocket handler at `/ws/demo` for demo workflow narration events. |
| `components/HomeScreen.tsx` | Initiative cards grid with workflow status badges. Polls `loadLocalItems` every 4s when any workflow is active. Header buttons: New Initiative + Simulate webhook. |
| `components/ClaudeCodeStudio.tsx` | Full-screen overlay for Claude Code Studio. Left pane: ticket context (feature title, ADO tickets, backlog stories). Right pane: streaming terminal from the WS connection. Output persisted in `workflowStore.studioOutput[workflowId]`. |
| `components/workflow/PipelineTerminalView.tsx` | Split-pane workflow terminal. Left: stage list with progress bar. Right: live event log grouped by stage, with inline checkpoint actions. Used when `activeWorkflow` is set. |

#### Per-stage template injection
`STAGE_TEMPLATE_MAP` in `specialist-agent.ts` maps stage names to template files:
- `analyst` → `research.template.md`
- `pm_prd` → `prd.template.md`
- `solution_architect` → `architecture.template.md`
- `pm_backlog` → `backlog.template.md`

Only the relevant template is injected into the system prompt for each stage. Templates are read from disk each time — no caching, so UI edits take effect on the next stage run.

#### Stage output format specifications
`STAGE_OUTPUT_FORMATS` in `stage-metadata.ts` defines inline format specs injected into `generateStageBrief()`. `generateStageBrief()` now produces a **structured 8-field brief schema** rather than flat sections. The fields are: Goal, Original request, Constraints, Prior stage outputs available, Key decisions already made, Human preferences expressed, Output required, What this specialist must NOT decide. The parameter previously named `previousOutputSummary` has been renamed to `additionalContext` (used for critic feedback on the auto-revise path).

**When adding a new stage:**
1. Create persona file in `agents/personas/<stage-name>.md`
2. Create output template in `agents/templates/<stage-name>.template.md`
3. Add demo fixture in `app/backend/src/demo/fixtures/<stage-name>.<ext>` (system auto-falls back to base if theme-specific missing)
4. Update `stage-metadata.ts`: add entries in `STAGE_OUTPUT_FORMATS`, `STAGE_SESSION_MAP`, `STAGE_ARTIFACT_TYPE`, `STAGE_ARTIFACT_LABEL`, `STAGE_LABELS_BRIEF`, `stageGoal()`, `stageNotDecide()`
5. Update `specialist-agent.ts`: add entry in `STAGE_TEMPLATE_MAP`
6. Update `workflow-stage-runner.ts`: add stage to `specialistStages` set (line ~697), add stage label to ternary chain (line ~685), add to `adoBackedStages` if it creates ADO tickets (line ~688)
7. Update frontend `constants/stage-labels.ts`: add entry in `STAGE_LABELS` and optionally `STAGE_SHORT_LABELS`
8. Update `demo-mode.ts`: add entry in `DEMO_FIXTURE_FILES` and `DEMO_STAGE_DELAY_MS`

#### Policies (governance)
The `policies` DB table stores key-value rules. Loaded at runtime — no restart needed. Key policies:
- `require_critic_review` — `"false"` disables inline critic after each specialist stage
- `auto_approve_critic` — `"true"` auto-resolves critic approvals without human gate

#### Context cache invalidation
`specialist-agent.ts` holds a module-level `_projectContextCache`. `invalidateContextCache()` (exported) clears it. Called by `context-diff-routes.ts` and `context-file-routes.ts` after changes so the next agent request reloads from disk.

### Multi-agent story format

The new feature-by-feature workflow produces stories in a richer format than the legacy single-stage backlog:

```json
{
  "story_id": "F1.S1",
  "title": "Browse and join a public channel",
  "as_a": "Alex — Active Self-Directed Trader",
  "i_want": "find and join a channel dedicated to a stock I'm watching",
  "so_that": "I can follow live discussions about that ticker without leaving TradeEasy",
  "acceptance_criteria": [
    "Given I open the Chat tab, When the channel list loads, Then I see public channels sorted by recent activity"
  ],
  "technical_acceptance_criteria": [
    "Backend: POST /api/channels/:id/join is idempotent and returns 200 if already a member",
    "iOS: Join action updates local cache and shows channel immediately without refresh"
  ],
  "platform": ["backend", "web", "ios", "android"],
  "estimated_points": 3,
  "depends_on": [],
  "test_cases": [
    {
      "id": "TC-F1.S1-001",
      "scenario": {
        "given": ["User is not a member of any channels"],
        "when": ["User opens the Chat tab"],
        "then": ["Channel list displays all public channels"]
      },
      "type": "happy_path",
      "priority": "critical",
      "prd_ref": "FR-01",
      "story_ref": "F1.S1"
    }
  ]
}
```

**Field mapping (old → new):**
- `persona` → `as_a`
- `goal` → `i_want`
- `benefit` → `so_that`
- `acceptanceCriteria` → `acceptance_criteria`
- `effort` / `storyPoints` → `estimated_points`

Both formats are supported throughout the codebase for backward compatibility. The frontend (`BacklogView.tsx`) checks both field names; ADO push (`pushFeatureToADO`) checks both; the type definitions (`backlog-helpers.ts`) include both.

### Inline artifact editing

During human review, users can directly edit specialist outputs (research, PRD, architecture, backlog JSON) without triggering a full agent re-run.

#### Flow
1. User clicks the **pencil icon** in the artifact viewer header → content switches to a monospace textarea.
2. User makes edits. **Cmd/Ctrl+S** saves without approving.
3. **Save & Approve** (green button, shown when a pending checkpoint exists) overwrites the file on disk, auto-resolves the checkpoint as approved, and advances the workflow to the next stage.
4. **Save** (blue button, shown for already-approved artifacts) overwrites the file only — no checkpoint resolution.
5. JSON artifacts (backlog, prototype) are validated before save; malformed JSON is rejected with an error.

#### Agent awareness
- **File overwrite**: downstream stages load artifacts by reading `file_path` from the DB, so they automatically pick up the edited version.
- **Workflow event**: a `human_edit` event is logged so the Coordinator can reference the edit when briefing the next specialist.

#### Key endpoint
`PUT /api/workflow/artifact/:id/content` — accepts `{ content: string, checkpointId?: number }`. Overwrites the artifact file, logs `human_edit` event, and optionally resolves the checkpoint + advances the workflow.

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

### ADO sync (feature-by-feature mode)

The new feature-by-feature workflow pushes incrementally to Azure DevOps:

1. **Epic Feature Planner stage** → `pushEpicAndFeaturesToADO()`
   - Creates epic work item
   - Creates feature work items under epic (no stories yet)
   - Saves mappings to `ado_work_item_map` table with keys: `epic`, `F1`, `F2`, `F3`

2. **Story Decomposition stages (F1/F2/F3)** → `pushFeatureToADO(featureIndex)`
   - Loads accumulated backlog (epic + all features completed so far)
   - Checks for existing stories to prevent duplicates
   - Creates story work items under existing feature with:
     - User story format in description (As a / I want / So that)
     - Product acceptance criteria (Given/When/Then formatted)
     - Technical acceptance criteria appended with separator
     - Technical notes in description
     - Platform tags as ADO work item tags (not description text)
     - Story points as `Microsoft.VSTS.Scheduling.Effort`
   - Extracts test cases from each story's `test_cases` field
   - Creates ADO Test Plan with test cases linked to stories via `TestedBy` relationship
   - Saves story mappings (F1.S1, F1.S2, etc.) and test plan mapping
   - Returns both feature URL and test plan URL for display

3. **Legacy pm_backlog stage** → `pushBacklogToAdo()`
   - First push: creates epic + features + stories in one go via `AzureDevOpsClient.createBacklog()`
   - Subsequent pushes: diff-based update via `AzureDevOpsClient.updateBacklog()`
   - Response includes `{ synced: true, created: N, updated: N }` when updating
   - Frontend shows "Sync to Board" button when mappings exist

#### Story format in ADO
Stories created by `pushFeatureToADO` include:
- **Title**: Story title from backlog
- **Description**: `<strong>As a</strong> {persona}<br><strong>I want</strong> {goal}<br><strong>So that</strong> {benefit}`
- **Acceptance Criteria**: Product ACs with Given/When/Then bolded, then `<hr>` separator, then Technical ACs with ⚙ prefix
- **Tags**: Semicolon-separated platform list (e.g., `backend; web; ios; android`)
- **Parent**: Feature work item (already exists from epic_feature_planner stage)

#### Test Plan structure
- **Plan name**: `{Feature Title} — Feature {N} Test Plan`
- **Test suites**: Grouped by story_ref (F1.S1, F1.S2, etc.)
- **Test cases**: Each with Given/When/Then steps, priority, type (happy_path/bad_path/edge_case)
- **Links**: `TestedBy` relationship from test case to story work item

### Prototype builder

After a workflow completes, users can generate interactive React prototypes to demonstrate the feature to stakeholders. The prototype agent reads all workflow artifacts (PRD, architecture, backlog) and the Figma-extracted design system to produce a self-contained React app rendered in-browser via Sandpack.

#### Flow
1. User clicks "Generate Prototype" on a completed workflow
2. `POST /api/workflow/:id/prototype/generate` streams AI generation (SSE)
3. Agent produces a JSON file-map: `App.tsx`, screen components, mock data, styles
4. Frontend renders via `@codesandbox/sandpack-react` with live preview
5. Device frame toggle: desktop / tablet / mobile (375×812 viewport)
6. Prototype saved as artifact (type `prototype`) for reload without regeneration

#### Key files
| File | Role |
|------|------|
| `agents/personas/prototype-builder.md` | Proto agent persona — styling rules, output format, constraints |
| `agents/templates/prototype.template.md` | JSON output schema the agent must follow |
| `agents/templates/prototype/design-tokens.css` | Figma design system CSS custom properties |
| `agents/templates/prototype/tailwind.config.js` | Tailwind config mapped to design tokens |
| `agents/prototype-agent.ts` | Generation logic: artifact loading, prompt assembly, streaming, artifact save |
| `routes/prototype-routes.ts` | REST endpoints: generate (SSE), load latest |
| `components/PrototypePreview.tsx` | Full-screen overlay with device frame toggle, code editor, and revision input. Supports light/dark theme. |

### Claude Code Studio

After a workflow's backlog is pushed to Azure DevOps, a **Claude Code Studio** button appears. This opens a local Claude Code CLI session via WebSocket at `/ws/ai-coding`.

#### Flow
1. Frontend opens WS connection to `/ws/ai-coding?workflowId=<id>`
2. Backend sends `connected` event with workflow context (goal, backlog stories, ADO tickets from `ado_work_item_map`)
3. Frontend sends `{ action: 'start_coding' }` (only if no prior output for this workflow)
4. Backend spawns `claude --print --allowedTools Read,Bash,Glob,Grep --max-turns 8 --no-color` with prompt via stdin, CWD = project root (detected by walking up to find `package.json` with `workspaces`)
5. stdout streams line-by-line as `{ type: 'output', line }` events
6. Falls back to `streamMock()` if claude CLI not found

#### Output persistence
`workflowStore.studioOutput[workflowId]` accumulates lines in Zustand state so output survives component unmount/remount. Cleared and restarted only when `start_coding` fires (i.e., on first open for a given workflow).

#### WebSocket routing
Both WS servers use `noServer: true`. A manual `upgrade` event handler on the HTTP server routes `/ws/demo` and `/ws/ai-coding` to their respective `WebSocketServer` instances.

### Demo webhook simulation

`POST /api/demo/webhook/trigger` creates a new initiative and immediately launches a full pipeline workflow without coordinator planning. Cycles through 4 sample initiatives (In-App Messaging, Onboarding Redesign, Portfolio Analytics, Social Trading). Default stages: `['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'qa_engineer', 'tech_refinement', 'curator']`. Useful for demos of parallel workflows on the Home Screen.

**Demo fixtures**: Set `DEMO_FIXTURE_THEME=price-alerts` (default) or `messaging` in `.env`. Fixtures live in `app/backend/src/demo/fixtures/` (base) and `app/backend/src/demo/fixtures/messaging/` (theme-specific). When adding a new stage, create a fixture file in the base directory — the system automatically falls back to base if a theme-specific fixture isn't found. Theme-specific fixtures are only needed if the content should differ from the base theme.

**Feature-specific fixtures**: For `story_decomposition_F1/F2/F3` stages, `getDemoFixture()` extracts the target feature from the full `backlog.json` fixture and returns only that feature. This allows a single fixture to serve all three stages without duplication. The multi-agent refinement code accumulates features: F1 initializes the backlog, F2/F3 append to the existing artifact.

### Agent patterns

Two agent patterns exist:

- **Pattern A (Specialist)** — document-producing agents: Analyst, PM, Architect, Prototype Builder. Extend `SpecialistAgent`. Persona files are plain markdown with YAML frontmatter (name, description). Loaded from `agents/personas/`; frontmatter is stripped before injection into the system prompt.
- **Pattern B (plain class)** — orchestration/review agents: Coordinator, Critic, Curator. No `SpecialistAgent` base class. Load persona via `readFileSync`. May still use `streamAI()`.

### Frontend state
Zustand stores:
- `stores/workflowStore.ts` — all workflow state: `activeWorkflow` (WorkflowRow with `estimated_cost`), `stageSequence`, `currentStage`, `completedStages`, `checkpoints`, `coordinatorMessages`, `isStreaming`, `pendingDiffCount`, `studioOutput` (Record<workflowId, string[]> for Claude Code Studio terminal persistence). `applyWorkflowStatus()` syncs from API. `resetWorkflow()` clears everything.
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

Seven canonical files (see `context/README.md`):
- `company.md`, `strategy.md` — have `.example.md` templates
- `tech-stack.md`, `db-schema.md`, `repos.md`, `process.md`, `current-state.md` — create to enable

**Key context files**:
- `repos.md` — Repository structure, purpose, boundaries, and cross-repo dependencies. Referenced by architect when enriching features with `targetRepos` metadata.

### Output templates (`agents/templates/`)
Four template files define the structure specialists follow:
- `research.template.md` — Analyst output format
- `prd.template.md` — PRD output format
- `architecture.template.md` — Architecture output format
- `backlog.template.md` — Backlog output format. Right-sizes output based on scope: single story (no feature wrapper), small feature (2–5 stories flat on epic), or multi-feature epic (max 6 features, max 12 stories/feature)

Editable from the UI (Templates button in header). Changes require double-confirmation. Templates are read from disk per-stage, so edits take effect on the next stage run.

#### Sprint estimation
After the backlog specialist produces output, `agents/sprint-estimation.ts` parses the JSON and injects sprint estimates:
- Reads `sprint_velocity`, `capacity_factor`, `hours_per_point`, and `ai_assisted_development` from `agents/config.yaml`
- `effectiveVelocity = sprintVelocity × capacityFactor`
- `sprintsRequired = totalEffort / effectiveVelocity` (rounded to 1 decimal)
- Sprint estimates are calculated at both **epic level** (total) and displayed per **feature** in the UI
- The frontend uses `Math.ceil()` for stakeholder-facing display, raw decimals for internal comparison

**AI-assisted development estimates:** When `ai_assisted_development.enabled: true` in config, hour estimates use `ai_hours_per_point` instead of `hours_per_point`. Both mappings are injected per-story (`estimatedHours`, `traditionalHours`, `aiEstimatedHours`) and aggregated at the sprint metadata level (`totalTraditionalHours`, `totalAiHours`, `aiAssisted`). The frontend shows a comparison with savings percentage when AI-assisted is enabled. The non-linear mapping reflects that AI accelerates routine work (1-2pt stories) more than complex integration work (8pt stories).

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
