# Product Hub

AI-powered product operations platform. Describe what you want to build and a coordinated team of AI agents researches it, writes the PRD, designs the architecture, produces a developer-ready backlog with QA test suite and technical refinements — with human review at every stage.

## Overview

You talk to one agent: the **Coordinator** (Chief of Staff). It gathers requirements, briefs specialist agents, and brings results back to you at structured checkpoints. Nothing moves forward without your approval.

**Specialist agents:**
- **Analyst (Sage)** — market research, domain analysis, risk identification
- **PM Strategy (Rex)** — PRD with user personas, journeys, and requirements
- **Architect (Atlas)** — solution architecture aligned to your tech stack
- **Backlog Agent (Pip)** — epics, features, and stories with acceptance criteria
- **QA Engineer (Vera)** — automation-ready JSON test suite covering all happy paths, bad paths, and edge cases
- **Tech Refinement (Finn, Remi & Cole)** — technical backlog refining stories into engineering-ready tickets with platform-specific tasks (iOS, Android, Backend)
- **Critic (Flint)** — adversarial quality review after each specialist stage
- **Context Curator (Ivy)** — proposes updates to project knowledge files based on workflow outputs

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS (port 5173) |
| Backend | Node.js + Express + TypeScript (port 3001) |
| Database | SQLite via `better-sqlite3` (`db/product-ops.db`) |
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
5. **You review at every checkpoint** — approve, revise with feedback, or reject
6. **Context Curator proposes updates** — facts from the workflow are offered as updates to your project knowledge files
7. **Running cost is tracked** — estimated USD cost shown in the header throughout the workflow

### Workflow stages

| Stage | Agent | Output |
|-------|-------|--------|
| Research | Analyst (Sage) | Market research brief with cited sources |
| PRD | PM Strategy (Rex) | Product Requirements Document |
| Architecture | Architect (Atlas) | Solution architecture document |
| Backlog | Backlog Agent (Pip) | Right-sized backlog: single stories, small features, or full epic/feature/story hierarchy (JSON) |
| QA Test Suite | QA Engineer (Vera) | Automation-ready JSON test suite covering happy paths, bad paths, and edge cases |
| Tech Refinement | Finn, Remi & Cole | Engineering-ready tickets with iOS, Android, and Backend tasks and effort estimates |
| Quality Review | Critic (Flint) | Inline after each specialist — auto-revises once, then asks the human |
| Context Update | Curator (Ivy) | Proposed updates to `context/*.md` files |

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
- Expandable stories with formatted acceptance criteria (Given/When/Then)
- Persona summary panel (fullscreen) showing which personas are covered and their story references
- **Push to Board** button (after workflow completes) to export the backlog to Azure DevOps or Jira
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

The `context/` directory contains markdown files injected into every agent's system prompt. Fill these in to give agents background knowledge so they don't ask for information you've already documented.

| File | Contents | Status |
|------|----------|--------|
| `company.md` | Company overview, team, customers, business model | Template available |
| `strategy.md` | North star, OKRs, roadmap themes | Template available |
| `tech-stack.md` | Frontend/backend/infra of the product being built | Create to enable |
| `db-schema.md` | Database schema of the product being built | Create to enable |
| `process.md` | Dev lifecycle, definition of ready/done, release process | Create to enable |
| `current-state.md` | Where things stand today, active work, known debt | Create to enable |

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

## Database

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
