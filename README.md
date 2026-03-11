# Product Hub

AI-powered product operations platform. Describe what you want to build, and a coordinated team of AI agents researches it, writes the PRD, designs the architecture, and breaks it into a developer-ready backlog — with human review at every stage.

## Overview

You talk to one agent: the **Coordinator** (Chief of Staff). It gathers requirements, briefs specialist agents, and brings results back to you at structured checkpoints. Nothing moves forward without your approval.

**Specialist agents:**
- **Analyst (Sage)** — market research, domain analysis, risk identification
- **PM Strategy (Rex)** — PRD with user personas, journeys, and requirements
- **Architect (Atlas)** — solution architecture aligned to your tech stack
- **Backlog Agent (Pip)** — epics, features, and stories with acceptance criteria
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
│   ├── frontend/      React UI (two-column layout)
│   └── shared/        Compiled TypeScript types (@pap/shared)
├── agents/
│   ├── personas/      Agent persona markdown files (coordinator, analyst, pm, architect, critic, curator)
│   ├── templates/     Output templates (research, prd, backlog)
│   └── config.yaml    User identity and preferences
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
./scripts/setup.sh

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
| Backlog | Backlog Agent (Pip) | Structured epics, features, and stories (JSON) |
| Quality Review | Critic | Inline after each specialist — auto-revises up to 2× |
| Context Update | Curator | Proposed updates to `context/*.md` files |

### Checkpoints

Every specialist stage pauses for human review. At each checkpoint you can:
- **Approve** — move to the next stage
- **Revise** — provide feedback; the stage reruns with your corrections
- **Reject** — end the workflow

After a workflow completes, you can **redo from any stage** — provide a reason, and that stage plus all downstream stages rerun.

## UI Features

### Context Editor
Edit the 6 canonical project context files directly from the UI. Click **Context** in the header. Changes are picked up immediately by the next agent request — no server restart needed. Files with templates show a "Load template" button.

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

# Knowledge base (Notion)
KNOWLEDGE_BASE_INTEGRATION=notion|none
NOTION_API_KEY=...
NOTION_DATABASE_ID=...
```

See `docs/integrations/` for detailed setup guides.

## Cost Optimisation

| Technique | Detail |
|-----------|--------|
| Prompt caching | Stable system prompt (persona + context + templates) is cached. Cache hits pay ~10% of normal cost |
| Per-stage template injection | Only the relevant output template is injected per stage — avoids wasting tokens |
| Critic split prompt | Persona cached separately from the document under review |
| Inline critic | Quality review runs after each specialist stage, not as a separate workflow stage |
| Auto-revision | Critic issues trigger up to 2 automatic revisions before asking the human |
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

Context files can be edited from the UI (**Context** button in the header) or on disk. Changes take effect immediately — no restart needed. See [`context/README.md`](context/README.md) for guidelines.

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

Schema in `db/schema.sql`, mirrored in `app/backend/src/data/database.ts`. Twelve tables:

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
| `context_loads` | Context audit trail (schema only) |
