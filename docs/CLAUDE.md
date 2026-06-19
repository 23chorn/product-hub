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
npm test                 # Vitest unit tests (from app/backend/; specs in tests/unit/)
npm run test:airtable    # Integration — hits real Airtable API
npm run test:bedrock     # Integration — hits real Bedrock API
npm run test:ado         # Integration — hits real ADO API
```

## Architecture

### Monorepo layout
```
app/
  backend/   Express + TypeScript (port 3001)
  frontend/  React 18 + Vite + Tailwind (port 5173)
  shared/    Compiled TypeScript types — consumed by both via `@pap/shared`
agents/
  personas/  Agent persona .md files
  templates/ Output templates (research, prd, backlog, architecture, prototype)
  config.yaml  User identity and preferences (gitignored)
context/     Project context files loaded into every agent system prompt
  behaviour/ xCube Docs from Azure Wiki — current implementation reference for PRD and story phases
db/          SQLite database (product-ops.db, gitignored) + schema.ts (Drizzle schema) + migrations/
```

Frontend proxies `/api/*` to the backend via Vite config. The shared package must be built (`npm run build` in `app/shared`) before type changes are visible to the backend.

### AI provider
`utils/ai-provider.ts` routes all LLM calls to Anthropic SDK, AWS Bedrock, or Ollama based on `AI_PROVIDER` env var. The Anthropic client uses lazy initialization — must not be instantiated at module load time.

Model config (pricing, token limits, per-agent assignments) is centralised in `utils/model-config.ts`. To add models: edit `PROVIDER_MODELS` there and add entries to `MODEL_MAX_OUTPUT_TOKENS` and `MODEL_PRICING`.

**Prompt caching**: `buildSystemPrompt()` returns `SystemPrompt = string | { stable: string; dynamic?: string }`. `stable` is cached (persona + context + template); `dynamic` is per-session item context injected uncached.

**Retry**: Both providers retry up to 3× with 15 s linear back-off on HTTP 429 / `ThrottlingException`.

### Database
Single SQLite file at `db/product-ops.db` via `better-sqlite3` (synchronous). Schema is defined in `db/schema.ts` (Drizzle) — the single source of truth. On startup, `app/backend/src/data/database.ts` runs `migrate()` against `db/migrations/` (tracked in the `__drizzle_migrations` table). To change the schema: edit `db/schema.ts`, then generate a migration with `npm run db:generate` from `app/backend/` (config in `app/backend/drizzle.config.ts`). The rest of the codebase uses the raw `better-sqlite3` instance exported as the default from `database.ts`.

| Table | Purpose |
|-------|---------|
| `items` | Work-item registry; all sessions/workflows FK into this |
| `sessions` | One row per agent per item per sitting |
| `messages` | Full message history per session |
| `artifacts` | Files produced by sessions |
| `workflows` | Goal-oriented orchestration unit with `estimated_cost` tracking |
| `checkpoints` | Human review pause points within a workflow |
| `workflow_events` | Stage narration events polled by the frontend |
| `coordinator_sessions` | Coordinator planning conversation persistence |
| `context_diffs` | Proposed edits to `context/*.md` files; approved diffs applied atomically |
| `policies` | Governance key-value rules injected into Coordinator system prompt |
| `staged_decisions` | Candidate ADR entries written by agents |
| `change_requests` | Post-completion CRs with impact assessment and status |
| `cr_artifact_versions` | Links CRs to new artifact versions and their parents |
| `ado_work_item_map` | Maps local backlog keys (F1, F1.S1) to ADO work item IDs |

### Coordinator workflow (the only mode)

Default pipeline: `['analyst', 'pm_prd', 'epic_feature_planner', 'story_decomposition_F1', 'story_decomposition_F2', 'story_decomposition_F3', 'curator']`

1. User types a goal → Coordinator reads `company.md`, `strategy.md`, `current-state.md` first. Emits `COORDINATOR_READY` (max 3 rounds) with enriched context JSON.
2. User toggles stages → `POST /api/workflow/start` → `advanceStage()`.
3. **Specialist stages** (analyst, pm_prd, epic_feature_planner): `runAutonomousStage()` streams output, saves artifact. Inline critic auto-revises up to 2× via conversation threading (`[user: brief, assistant: prior draft, user: revision directive]`). Creates `pending` checkpoint for human review.
4. Human review: **Approve** → next stage; **Revise** → rerun with feedback; **Reject** → ends. Feedback classified: output correction → specialist revision; scope change → confirm before proceeding; upstream gap → offer redo from earlier stage.
5. **Multi-agent refinement stages** (story_decomposition_F1/F2/F3): `runMultiAgentRefinement()` coordinates a dynamic team (Shard=Product, Vera=QA, Finn=Backend always present; Remi=Web, iOS/Android engineers included only when `productArea` warrants it). Stories accumulated across features. `pushFeatureToADO()` adds stories to existing ADO features, creates epic-level test plan (cumulative across F1/F2/F3). Duplicate prevention via `ado_work_item_map`.
6. Curator runs automatically, writes `context_diffs`, workflow completes.
7. After completion: redo from any stage with feedback.

#### Key agent files
| File | Role |
|------|------|
| `agents/coordinator-agent.ts` | Planning sessions, stage briefs, mid-workflow chat, CR briefs |
| `agents/critic-agent.ts` | Single-shot review. Stage-specific rules via `buildStageInstructions(stage)` |
| `agents/specialist-agent.ts` | Persona loading, context injection, template injection, streaming |
| `agents/workflow-router.ts` | Core state machine: `createWorkflow()`, `advanceStage()`, checkpoint management |
| `agents/workflow-db.ts` | Shared types, prepared statements, `insertEvent`, `costTracker` |
| `agents/workflow-stage-runner.ts` | `runAutonomousStage()` — fire-and-forget background runner |
| `agents/multi-agent-refinement.ts` | Multi-agent collaborative story refinement orchestrator — dynamic participant list based on productArea |
| `agents/feature-decomposition.ts` | ADO push: `pushEpicAndFeaturesToADO()`, `pushFeatureToADO()` |
| `agents/stage-metadata.ts` | Stage constants: maps, labels, token limits, `stageGoal()`, `stageNotDecide()` |
| `agents/workflow-mutations.ts` | `propagateFeedback()`, `reiterateFromStage()`, `retryCurrentStage()` |
| `agents/change-request.ts` | CR lifecycle: create, assess impact (SSE), execute targeted stages |
| `agents/prototype-agent.ts` | Prototype generation from workflow artifacts + design system tokens |
| `utils/model-config.ts` | All model/pricing config and cost estimation |

#### When adding a new stage
1. Create persona file in `agents/personas/<stage-name>.md`
2. Create output template in `agents/templates/<stage-name>.template.md`
3. Add demo fixture in `app/backend/src/demo/fixtures/<stage-name>.<ext>`
4. Update `stage-metadata.ts`: `STAGE_OUTPUT_FORMATS`, `STAGE_SESSION_MAP`, `STAGE_ARTIFACT_TYPE`, `STAGE_ARTIFACT_LABEL`, `STAGE_LABELS_BRIEF`, `stageGoal()`, `stageNotDecide()`
5. Update `specialist-agent.ts`: add entry in `STAGE_TEMPLATE_MAP`
6. Update `workflow-stage-runner.ts`: add to `specialistStages` set (~line 697), label ternary (~line 685), `adoBackedStages` if it creates ADO tickets (~line 688)
7. Update frontend `constants/stage-labels.ts`: `STAGE_LABELS` and optionally `STAGE_SHORT_LABELS`
8. Update `demo-mode.ts`: `DEMO_FIXTURE_FILES` and `DEMO_STAGE_DELAY_MS`

#### Policies (governance)
`policies` DB table stores key-value rules, loaded at runtime (no restart needed):
- `require_critic_review` — `"false"` disables inline critic
- `auto_approve_critic` — `"true"` auto-resolves critic approvals without human gate

### Multi-agent story format (feature-by-feature pipeline)

Stories use this shape (old field aliases still accepted for backward compat):

```
story_id, title, as_a (was: persona), i_want (was: goal), so_that (was: benefit),
acceptance_criteria (was: acceptanceCriteria), technical_acceptance_criteria,
platform[], estimated_points (was: effort/storyPoints), depends_on[]
```

ADO push maps platform tags to semicolon-separated work item tags. Epic-level test plan is cumulative across all story decomposition stages. Full test suite lives in the QA engineer stage as a separate artifact — not embedded in story tickets.

### Inline artifact editing
Users can edit specialist outputs during review (pencil icon → textarea). **Cmd/Ctrl+S** saves; **Save & Approve** also resolves the checkpoint and advances the workflow. JSON artifacts are validated before save. Endpoint: `PUT /api/workflow/artifact/:id/content`.

### Change Request system
Post-completion targeted changes without full reruns. Flow: create CR → assess impact (Coordinator SSE, determines `affected_stages`) → user confirms stages → execute (conversation threading via `reiterateFromStage()`). Key file: `agents/change-request.ts`.

### ADO sync
- **Epic Feature Planner** → `pushEpicAndFeaturesToADO()`: creates epic + feature shells, saves mappings (`epic`, `F1`–`F3`)
- **Story Decomposition** → `pushFeatureToADO()`: adds stories to existing features with user story format, Given/When/Then ACs, technical ACs (with `<hr>` separator), platform tags, story points as `Microsoft.VSTS.Scheduling.Effort`
- **Legacy pm_backlog** → `pushBacklogToAdo()`: creates full Epic→Feature→Story hierarchy; subsequent pushes use diff-based `updateBacklog()`
- Story type configurable via `AZURE_DEVOPS_STORY_TYPE` env var (default: "User Story")

### Agent patterns
- **Pattern A (Specialist)** — document-producing agents (Analyst, PM, Architect, Prototype). Extend `SpecialistAgent`. Persona files are markdown with YAML frontmatter stripped before injection.
- **Pattern B (plain class)** — orchestration/review agents (Coordinator, Critic, Curator). Load persona via `readFileSync`, use `streamAI()`.

### Per-stage JSON validators (`agents/tool-registry.ts`)
Each specialist stage has a structural validator registered as a tool the agent calls before returning output. Validators check field presence, array minimums, character/word limits, format constraints, and flag TBD/vague language. Key validators:
- `validate_analyst_json` — title, market_size sub-fields, ≥2 competitive entries, inline [N] citations, no placeholder URLs
- `validate_prd_json` — personas, journeys (steps ≥2), success_metrics (primary/secondary/counter), NFR measurability, FR count 10–20
- `validate_architecture_json` — recursive TBD scan, technology_decisions (alternatives must be substantive, not "None"/"N/A"), `new_dependencies` structure validation, data_model, api_surface, epic_features_enriched
- `validate_gtm_strategy_json` — Moore positioning template, segment enums, headline ≤8 words, exactly 3 phases
- `validate_feature_marketing_json` — 3 name variants, value_proposition ≤20 words, app_store ≤170 chars, exactly 5 FAQ entries

`syncSeedSkillTools()` in `skill-registry.ts` auto-bumps skill version on server start when tool names differ from the seed — existing installs pick up renamed validators without manual migration.

### Architecture `new_dependencies` field
The architecture JSON schema includes a `new_dependencies` array (added in `agents/templates/architecture.template.md`). Every technology not in `context/tech-stack.md` must appear here with:
- `not_solvable_with_existing_stack_because` — specific gap (>20 chars required by validator)
- `existing_alternatives_evaluated` — what existing tech was tried first
- `cost_or_risk` — operational/licensing implications

Empty `new_dependencies: []` = deliberate statement that no new tech is introduced. The field is rendered prominently at the top of the human review artifact view (`architectureToMarkdown()` in `artifact-to-markdown.ts`) — the PM sees it before the technology decisions table.

The architect persona (`agents/personas/architect.md`) has an "Extend before adopting" principle, and the critic (`agents/personas/critic-architect.md`) flags undeclared new dependencies as **CRITICAL**.

### Frontend state (Zustand stores)
- `workflowStore.ts` — `activeWorkflow`, `stageSequence`, `currentStage`, `completedStages`, `checkpoints`, `coordinatorMessages`, `studioOutput` (terminal persistence per workflowId)
- `sessionStore.ts` — `selectedItem`
- `modelStore.ts` — `selectedModelId` (persisted to `localStorage`), `availableModels`
- `themeStore.ts`, `contextEditorStore.ts`, `templateEditorStore.ts` — UI toggles

Key shared frontend modules: `constants/stage-labels.ts`, `utils/coordinator-helpers.ts`, `utils/backlog-helpers.ts`.

### Project context (`context/`)
Any `.md` file here is injected into agent system prompts. Cached in memory; invalidated when files are saved via UI or context diffs are approved. Canonical files: `company.md`, `strategy.md`, `tech-stack.md`, `db-schema.md`, `repos.md`, `process.md`, `current-state.md`.

**Stage-scoped context**: Files with a YAML frontmatter `stages:` field are only injected into matching agents. Files without `stages:` are universal. The `stageMatches()` helper prefix-matches so `story_decomposition` covers `story_decomposition_F1/F2/F3`. Implementation in `specialist-agent.ts`: `parseContextFrontmatter()`, `loadProjectContext(stage)`, `_contextByStageCache`.

Example stage-scoped file (injected only into architect + story decomposition agents):
```markdown
---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# API Contracts
...
```

Example files (tracked but gitignored in prod): `api-contracts.example.md`, `integrations.example.md`, `db-schema.example.md`, `repos.example.md`.

### Output templates (`agents/templates/`)
`research.template.md`, `prd.template.md`, `architecture.template.md`, `backlog.template.md`. Read from disk per-stage (no caching), so UI edits take effect immediately on the next run.

Sprint estimation runs after backlog specialist: reads `agents/config.yaml` for `sprint_velocity`, `capacity_factor`, `hours_per_point`, and `ai_assisted_development`. Injects sprint metadata into backlog JSON via `agents/sprint-estimation.ts`.

### Integration providers
Configured via `app/backend/src/config/app-config.ts`:
- `ROADMAP_INTEGRATION=airtable|none`
- `WORK_ITEMS_INTEGRATION=ado|jira|none`
- `KNOWLEDGE_BASE_INTEGRATION=notion|gitbook|azure_wiki|none` — `azure_wiki` auto-publishes analyst/PRD/architecture/prototype/figma_design drafts to the ADO wiki (`tryWikiPush()` in `workflow-stage-runner.ts`); independent of `WORK_ITEMS_INTEGRATION`, reuses the same `AZURE_DEVOPS_*` credentials. Once an artifact is wiki-synced, its `external_system` flips to `azure_wiki` permanently and all future reads (including previews) come from the wiki, not Mongo/disk.

### Demo
`POST /api/demo/webhook/trigger` launches a full pipeline without coordinator planning, cycling through 4 sample initiatives. Set `DEMO_FIXTURE_THEME=price-alerts` (default) or `messaging`. Fixtures in `app/backend/src/demo/fixtures/`; system auto-falls back to base theme if themed fixture missing. `USE_MOCK_DATA=true` bypasses Airtable for local dev.

**Fixture format**: All fixtures are `.json` files. The `messaging/` subdirectory contains theme-specific overrides for `analyst.json`, `prd.json`, `architecture.json`, `gtm-strategy.json`, `feature-marketing.json`. Common fixtures (backlog, qa-tests, prototype, epic-features) are shared across themes. Demo artifacts flow through the same `saveLocalArtifact()` path as real LLM outputs — MongoDB is attempted first; falls back to disk if unavailable.

### Artifact storage (`app/backend/src/data/mongo-client.ts`)
Specialist-stage JSON artifacts are stored in locally hosted MongoDB (`docker-compose.yml` at project root). The `artifacts` SQLite table tracks the storage location via `external_system='mongodb'` and `external_path=<ObjectId>`. Disk fallback is automatic when MongoDB is unreachable (`serverSelectionTimeoutMS: 3000`).

Key exports: `insertArtifactDoc()`, `updateArtifactDocId()`, `readArtifactDoc()`, `replaceArtifactDocContent()`, `parseContentForMongo()` (stores JSON as real BSON, non-JSON as string).

`saveLocalArtifact()` in `artifact-helpers.ts` dispatches: MongoDB → disk fallback. `updateArtifactContent()` dispatches: MongoDB → azure_wiki → disk based on `external_system`.

To start MongoDB locally: `docker compose up -d`. Set `MONGODB_URI` and `MONGODB_DB` in `.env` (defaults: `mongodb://localhost:27017`, `product-agent`).

### Misc
- **Airtable formula**: use `NOT({Field})` not `{Field} = BLANK()` for link fields (Airtable returns SERVER_ERROR for the latter)
- **Context cache**: `invalidateContextCache()` in `specialist-agent.ts` — called automatically after context file saves
- **Claude Code Studio**: WS at `/ws/ai-coding` — spawns `claude --print` CLI, streams stdout. Both WS servers use `noServer: true` with manual upgrade routing.
