# Product Hub

AI-powered product operations platform. Describe what you want to build and a coordinated team of AI agents researches it, writes the PRD, designs the architecture, produces a developer-ready backlog with QA test suite and technical refinements — then pushes it all to Azure DevOps with full story/test linkage. Human review at every stage.

## Overview

You talk to one agent: the **Coordinator** (Chief of Staff). It gathers requirements, briefs specialist agents, and brings results back to you at structured checkpoints. Nothing moves forward without your approval.

**Specialist agents:**
- **Analyst (Sage)** — market research, domain analysis, risk identification
- **PM Strategy (Rex)** — PRD with user personas, journeys, and requirements
- **Epic Feature Planner (Apex)** — breaks epic into high-level features, creates shells in Azure DevOps
- **Story Decomposition Team (per-feature)** — 7-agent collaborative refinement:
  - **Product (Shard)** — breaks feature into user stories with acceptance criteria
  - **QA Engineer (Vera)** — generates test cases for each story (embedded in story JSON)
  - **Backend Engineer (Finn)** — adds technical acceptance criteria for API/database work
  - **iOS Engineer (Remi)** — adds iOS-specific technical criteria and notes
  - **Android Engineer (Cole)** — adds Android-specific technical criteria and notes
- **Architect (Atlas)** — solution architecture aligned to your tech stack (optional, legacy)
- **Backlog Agent (Pip)** — epics, features, and stories with acceptance criteria (legacy single-stage)
- **Critic (Flint)** — adversarial quality review after each specialist stage
- **Context Curator (Ivy)** — proposes updates to project knowledge files based on workflow outputs

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS (port 5173) |
| Backend | Node.js + Express + TypeScript (port 3001) |
| Database | SQLite via `better-sqlite3` (`db/product-ops.db`) |
| Artifact storage | MongoDB (local via Docker) — JSON artifacts stored as BSON; disk fallback when unavailable |
| AI | Anthropic API, AWS Bedrock, or Ollama (local) — model selectable from UI |
| Integrations | Airtable (roadmap items), Azure DevOps, Jira, Notion |

```
product-agent/
├── app/
│   ├── backend/       Express API, agents, workflow engine
│   │   └── src/demo/  Claude Code Studio WS handlers + demo fixtures
│   ├── frontend/      React UI (two-column layout)
│   └── shared/        Compiled TypeScript types (@pap/shared)
├── agents/
│   ├── personas/      Agent persona markdown files (coordinator, analyst, pm, architect, critic, curator, qa-engineer, prototype-builder, platform engineers)
│   ├── templates/     Output templates (research, prd, architecture, backlog, qa-tests, prototype)
│   ├── config.example.yaml  Template for user config (tracked)
│   └── config.yaml    User identity and preferences (gitignored)
├── context/           Project context files injected into every agent prompt
│   └── README.md      Guidelines for filling in context files
├── db/
│   ├── schema.sql     Canonical DB schema (tracked)
│   └── product-ops.db Runtime database (gitignored)
├── data/              Artifact exports (gitignored)
├── docs/              Deployment, developer, integration, and setup guides
└── scripts/           Setup and utility scripts
```

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9
- Docker (for local MongoDB — `docker compose up -d` starts it on port 27017; the system falls back to disk storage if unavailable)
- One of:
  - Anthropic API key (`AI_PROVIDER=anthropic`)
  - AWS credentials with Bedrock access (`AI_PROVIDER=bedrock`)
  - [Ollama](https://ollama.com) running locally (`AI_PROVIDER=ollama`)

### Setup

```bash
# First-time setup (installs deps, builds shared types, creates .env)
./scripts/setup.sh           # macOS / Linux
# or
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1   # Windows

# Or manually:
npm install
cd app/shared && npm run build && cd ../..
cp .env.example .env
# Edit .env — set AI_PROVIDER and credentials

# Start MongoDB (optional — artifacts fall back to disk without it)
docker compose up -d

# Validate configuration
npm run validate-env

# Start both frontend and backend
npm run dev
```

See [docs/setup/llm-providers.md](docs/setup/llm-providers.md) for detailed provider configuration.

## How It Works

1. **Describe your goal** in the Coordinator chat — include who it's for, the core problem, key outcomes, and constraints
2. **The Coordinator gathers context** — asks 1–3 rounds of clarifying questions, then launches the workflow
3. **Choose which stages to run** — toggle agents on/off before the workflow starts (at least one required)
4. **Specialist agents run autonomously** — each produces a document, reviewed by the Critic for quality
5. **Feature-by-feature refinement** — after high-level planning, each feature gets 7-agent collaborative refinement:
   - Product breaks feature into stories
   - QA generates test cases for each story
   - Platform engineers add technical acceptance criteria
   - Stories pushed to Azure DevOps with platform tags
   - Test cases pushed to ADO Test Plans with story linkage
6. **You review at every checkpoint** — approve, revise with feedback, or reject (two URLs shown: Feature board, Test plan)
7. **Context Curator proposes updates** — facts from the workflow are offered as updates to your project knowledge files
8. **Running cost is tracked** — estimated USD cost shown in the header throughout the workflow

### Workflow stages (new feature-by-feature pipeline)

| Stage | Agent | Output | ADO Integration |
|-------|-------|--------|----------------|
| Research | Analyst (Sage) | Market research brief with cited sources | — |
| PRD | PM Strategy (Rex) | Product Requirements Document | — |
| Epic Feature Planner | Epic Planner (Apex) | Epic + Features (high-level) | Creates epic + feature shells |
| Story Decomposition F1/F2/F3 | 7-agent team | User stories with product ACs, technical ACs, platform tags, test cases (per-feature) | Adds stories to feature + creates test plan |
| Context Update | Curator (Ivy) | Proposed updates to `context/*.md` files | — |

**Each Story Decomposition stage produces:**
- User stories in "As a / I want / So that" format
- Product acceptance criteria (Given/When/Then)
- Technical acceptance criteria from platform engineers
- Platform tags (backend, web, ios, android)
- Embedded test cases (happy path, bad path, edge case)
- Sprint estimates based on team velocity

**Legacy stages (still available):**
- Architecture (Architect — Atlas) — optional solution architecture document
- Backlog (Pip) — single-stage backlog generation without feature-by-feature refinement
- QA Test Suite (Vera) — standalone test suite generation
- Tech Refinement (Finn, Remi, Cole) — post-backlog technical enrichment

### Checkpoints

Every specialist stage pauses for human review. At each checkpoint you can:
- **Approve** — move to the next stage
- **Revise** — provide feedback; the stage reruns with your corrections (critic is skipped — the human is now the reviewer)
- **Reject** — end the workflow

After a workflow completes, you can **redo from any stage** — provide a reason, and that stage plus all downstream stages rerun.

### Sprint Estimation

The backlog stage automatically calculates sprint estimates using your team's velocity and capacity factor (configured in `agents/config.yaml`):
- **Epic level** — total story points divided by effective velocity
- **Feature level** — per-feature sprint estimates shown in the backlog preview
- **AI-assisted estimates** — when `ai_assisted_development.enabled: true`, shows AI vs traditional hour comparisons

## UI Features

### Home Screen
The home screen lists your initiatives as cards showing title, workflow status, and current stage progress. Cards auto-refresh when any workflow is active. Two ways to start a new workflow:
- **New Initiative** — opens a form to describe the initiative; the Coordinator gathers requirements before launching
- **Simulate webhook** — instantly creates and launches a full pipeline from a set of sample initiatives (In-App Messaging, Onboarding Redesign, Portfolio Analytics, Social Trading) — useful for demos showing multiple parallel workflows

### Pipeline Terminal View
When a workflow is active, the main view switches to a split-pane terminal layout:
- **Left pane** — stage list with progress bar, completion status, and per-stage cost
- **Right pane** — live event log grouped by stage, showing agent progress, critic reviews, and checkpoints with inline approve/revise/reject actions

### Claude Code Studio
After a workflow's backlog has been pushed to Azure DevOps, a **Claude Code Studio** button appears in the terminal. This opens a local Claude Code CLI session:
- **Left pane** — ticket context showing the feature goal, ADO work item IDs, and backlog stories with acceptance criteria
- **Right pane** — real-time terminal output from `claude --print --allowedTools Read,Bash,Glob,Grep` running against the actual project codebase
- Output is persisted in the Zustand store so it survives navigation
- Falls back to a mock stream if the Claude CLI is not installed

### Artifact Viewer
Review specialist outputs in a slide-out panel with fullscreen mode. The backlog preview shows structured epics, features, and stories with:
- Sprint estimates at epic and feature level
- Expandable stories with:
  - User story format: "As a / I want / So that"
  - Product acceptance criteria (Given/When/Then formatted, keywords bolded)
  - Technical acceptance criteria (marked with ⚙ icon)
  - Platform tags (backend, web, ios, android)
  - Embedded test cases (scenario, type, priority)
- Persona summary panel (fullscreen) showing which personas are covered and their story references
- **View Feature** and **View Test Plan** links after each feature completion
- **QA Test Suite** view with structured test cases and coverage breakdown
- **Prototype Preview** — renders AI-generated React prototypes in an inline device frame

### Prototype Builder
After a workflow completes, click **Generate Prototype** to create an interactive React prototype:
- Agent reads all workflow artifacts (PRD, architecture, backlog) and the design system
- Produces a self-contained React app rendered in-browser via an iframe
- Device frame toggle: desktop / tablet / mobile
- Code viewer panel showing all generated `.tsx` files
- Revision input to refine the prototype with natural language instructions

### Change Requests
After a workflow completes, **Change Request** opens a centred modal to describe a targeted change:
1. Select change type (Correction, Scope, Direction, Constraint, Stakeholder, Technical)
2. The Coordinator assesses impact and lists affected stages
3. Confirm which stages to re-run — only selected stages execute, not the full pipeline

### Initiative List
The left sidebar shows local initiatives and Airtable roadmap items (when configured). Each initiative displays its workflow status (active/paused/done) and clicking one restores the full workflow state.

### Context Editor
Edit the 6 canonical project context files directly from the UI. Click **Context** in the header. Changes are picked up immediately by the next agent request — no server restart needed.

### Template Editor
Edit the output templates that agents follow when producing documents. Click **Templates** in the header. Saves require double-confirmation since template changes affect all future outputs.

### Mid-Workflow Chat
Talk to the Chief of Staff while a workflow is running. Ask status questions, provide corrections, or share preferences that should apply to upcoming stages.

## Environment Variables

### AI Provider

```bash
# ── Option 1: Anthropic direct API (recommended) ──────────
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# ── Option 2: AWS Bedrock ──────────────────────────────────
AI_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# ── Option 3: Ollama (local, free) ─────────────────────────
AI_PROVIDER=ollama
```

**Model selection** is done from the UI header dropdown. Changes persist to `localStorage`.

### Integrations (all optional)

```bash
# Airtable roadmap (or set ROADMAP_INTEGRATION=none)
ROADMAP_INTEGRATION=airtable
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...

# Work items (Azure DevOps or Jira)
WORK_ITEMS_INTEGRATION=ado|jira|none
AZURE_DEVOPS_ORG=...
AZURE_DEVOPS_PROJECT=...
AZURE_DEVOPS_PAT=...
AZURE_DEVOPS_STORY_TYPE=User Story  # or "Product Backlog Item" for Scrum template

# Azure DevOps AI pipeline (optional — triggers a Claude Code pipeline run)
AZURE_DEVOPS_AI_PIPELINE_ID=...

# Knowledge base (Notion or GitBook)
KNOWLEDGE_BASE_INTEGRATION=notion|gitbook|none
NOTION_API_KEY=...
NOTION_DATABASE_ID=...
GITBOOK_API_TOKEN=...
GITBOOK_SPACE_ID=...
```

See `docs/integrations/` for detailed setup guides.

## Cost Optimisation

| Technique | Detail |
|-----------|--------|
| Prompt caching | Stable system prompt (persona + context + templates) is cached. Cache hits pay ~10% of normal cost |
| Per-stage template injection | Only the relevant output template is injected per stage — avoids wasting tokens |
| Critic split prompt | Persona cached separately from the document under review |
| Inline critic | Quality review runs after each specialist stage, not as a separate workflow stage |
| Auto-revision | Critic issues trigger 1 automatic revision before asking the human |
| Human revision bypass | Human-initiated revisions skip the critic — direct human ↔ specialist loop |
| Per-workflow cost tracking | Cumulative USD cost tracked in the DB and displayed in the UI |

Token usage and estimated cost are logged on every request:
```
[TOKENS] model=claude-haiku-4-5-20251001 | input=12400 (uncached=800 cache_write=11200 cache_read=400) | output=320 | cost ~$0.003200
```

## Project Context

The `context/` directory contains markdown files injected into agent system prompts. Fill these in to give agents background knowledge so they don't ask for information you've already documented.

| File | Contents | Scope |
|------|----------|-------|
| `company.md` | Company overview, team, customers, business model | All agents |
| `strategy.md` | North star, OKRs, roadmap themes | All agents |
| `tech-stack.md` | Frontend/backend/infra of the product being built | All agents |
| `db-schema.md` | Database schema of the product being built | All agents |
| `process.md` | Dev lifecycle, definition of ready/done, release process | All agents |
| `current-state.md` | Where things stand today, active work, known debt | All agents |
| `api-contracts.md` | REST/WebSocket API contracts and rate limits | Architect, story decomposition, tech refinement, QA |
| `integrations.md` | Third-party integrations (FCM, SendGrid, analytics, payments) | Architect, story decomposition, tech refinement, QA |

**Stage-scoped context**: Files with a YAML frontmatter `stages:` field are only injected into matching agents — useful for technical context (API contracts, DB schema, integrations) that the analyst and PM don't need. Example: `api-contracts.example.md` is injected only into the architect and story decomposition agents.

Context files can be edited from the UI (**Context** button in the header) or on disk. Changes take effect immediately — no restart needed.

## Development

```bash
npm run dev              # Start frontend + backend concurrently
npm run dev:backend      # Backend only (tsx watch)
npm run dev:frontend     # Frontend only (Vite)
npm run build            # Build all workspaces
npm run test:unit        # Run Vitest unit tests

# After editing app/shared/src/types.ts:
cd app/shared && npm run build

# Type-check backend:
cd app/backend && npx tsc --noEmit
```

See [CUSTOMIZING.md](CUSTOMIZING.md) for fork customization and [docs/developer-guide/adding-an-agent-stage.md](docs/developer-guide/adding-an-agent-stage.md) for adding new specialist stages.

## Storage

### SQLite (operational data)
Schema in `db/schema.sql`, mirrored in `app/backend/src/data/database.ts`.

| Table | Purpose |
|-------|---------|
| `items` | Work item registry (Airtable initiatives + local items) |
| `sessions` | Agent conversation sessions |
| `messages` | Full conversation history |
| `artifacts` | Exported document metadata + file paths |
| `workflows` | Goal-oriented orchestration units with cost tracking |
| `checkpoints` | Human review pause points |
| `workflow_events` | Stage narration events for the UI |
| `coordinator_sessions` | Coordinator planning conversation persistence |
| `context_diffs` | Proposed edits to `context/*.md` files |
| `policies` | Governance rules injected into Coordinator prompt |
| `staged_decisions` | Candidate ADR entries |
| `context_loads` | Context audit trail |
| `change_requests` | Post-completion change requests with impact assessment and status |
| `cr_artifact_versions` | Links change requests to new artifact versions and their parents |
| `ado_work_item_map` | Maps local backlog keys to Azure DevOps work item IDs for sync |

### MongoDB (artifact content)
JSON artifacts from specialist stages are stored in a local MongoDB instance (`docker-compose.yml` at project root, port 27017). The SQLite `artifacts` table tracks the MongoDB ObjectId in `external_path` with `external_system='mongodb'`. If MongoDB is unreachable on first connect, all artifacts fall back to disk automatically — no configuration needed for basic local development.

```bash
# Start MongoDB
docker compose up -d

# Stop MongoDB
docker compose down
```

Environment variables (both optional — defaults shown):
```
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=product-agent
```
