# Product Ops Pipeline

AI-powered product operations platform where specialized agents help Product Managers create PRDs, generate backlogs, and conduct market research through structured conversational workflows.

## Overview

Three AI agents — each with its own persona, menu, and guided workflows — assist PMs through complex documentation tasks. Conversations persist across sessions, artifacts are exported as markdown/JSON, and all activity is tracked in a local SQLite database.

**Agents:**
- **PM Agent (PRD mode)** — creates PRDs through a structured step-file workflow
- **PM Agent (Backlog mode)** — transforms PRDs into epics and user stories, or creates quick tickets ad-hoc
- **Analyst Agent** — conducts market research, domain research, and brainstorming

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS (port 5173) |
| Backend | Node.js + Express + TypeScript (port 3001) |
| Database | SQLite via `better-sqlite3` (`db/product-ops.db`) |
| AI | Anthropic API, AWS Bedrock, or Ollama (local) — model selectable from the UI header |
| Integrations | Airtable (roadmap items), Azure DevOps |

```
Product-agent/
├── app/
│   ├── backend/       Express API, agents, session management
│   ├── frontend/      React UI (three-column resizable layout)
│   └── shared/        Compiled TypeScript types (@pap/shared)
├── _bmad/             Agent personas, workflows, and step files
│   └── README.md      Active agents, workflow steps, and template outputs
├── context/           Project context files injected into every agent prompt
│   └── README.md      Guidelines for filling in context files
├── db/
│   ├── schema.sql     Canonical DB schema (tracked)
│   └── product-ops.db Runtime database (gitignored)
└── data/              Conversation markdown logs + artifact exports (gitignored)
```

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9
- One of:
  - Anthropic API key (`AI_PROVIDER=anthropic`)
  - AWS credentials with Bedrock access (`AI_PROVIDER=bedrock`)
  - [Ollama](https://ollama.com) running locally with at least one model pulled (`AI_PROVIDER=ollama`)
- Airtable API key + Base ID (or set `USE_MOCK_DATA=true` to skip)

### Setup

```bash
# Install dependencies
npm install

# Build shared types (required before first run)
cd app/shared && npm run build && cd ../..

# Configure environment
cp .env.example .env
# Edit .env — see Environment Variables below

# Validate configuration
npm run validate-env

# Start both frontend and backend
npm run dev
```

### Mock data mode

Set `USE_MOCK_DATA=true` in `.env` to bypass Airtable and run with fixture data — useful for frontend development without a live Airtable connection.

## Environment Variables

### AI Provider

Set `AI_PROVIDER` to one of three options:

```bash
# ── Option 1: Anthropic direct API ──────────────────────────
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# ── Option 2: AWS Bedrock ────────────────────────────────────
AI_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# AWS_SESSION_TOKEN=...   # Required for SSO / assumed-role credentials

# ── Option 3: Ollama (local) ─────────────────────────────────
AI_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434   # optional, this is the default
```

For Ollama, also add your installed model IDs to `PROVIDER_MODELS.ollama` in [app/backend/src/utils/ai-provider.ts](app/backend/src/utils/ai-provider.ts). Each `id` must exactly match the tag from `ollama list`. Restart the server after editing.

**Model selection** is done from the UI — a dropdown in the app header lets users switch between available models for the configured provider. Changes persist to `localStorage`. The active provider and available models are logged on startup:
```
🤖 AI provider: anthropic | models: claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929, claude-opus-4-6
```

### Other variables

```bash
# Airtable (or set USE_MOCK_DATA=true to bypass)
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...

# Dev
USE_MOCK_DATA=false
```

## How It Works

1. **Select an initiative** from the Airtable roadmap, or create a **Quick Session** for ad-hoc work not tied to a roadmap item
2. **Choose a mode** — PRD, Backlog, or Analyst (quick sessions are locked to Backlog)
3. **Select a model** from the header dropdown (preference persists across sessions)
4. **Pick a workflow** from the agent's menu (or go free-form chat)
5. **Work through the workflow** — agents follow structured step files, streaming responses in real time. Mid-conversation responses are kept brief — one question at a time
6. **Export** — type `e` in chat. For PRD and Analyst modes the export captures the finished draft directly from the last chat message — no additional API call. Backlog converts the conversation to JSON. All exports are saved to `data/sessions/{itemId}/{mode}/artifacts/` and shown in the preview panel

Each agent/mode combination keeps its own conversation history. Sessions persist across page refreshes and server restarts — returning to a mode resumes where you left off.

## Cost Optimisation

The platform applies several techniques to keep token costs low:

| Technique | Detail |
|-----------|--------|
| Prompt caching | Stable system prompt (persona + context + workflow steps) is cached. Cache hits pay ~10% of normal input cost. Works on both Anthropic direct and AWS Bedrock |
| Rolling message window | Only the last 20 messages are sent per request |
| Artifact injection limit | PRD/analyst artifacts only included in the first 12 messages of a session |
| Step-file trimming | Workflow step files removed from the system prompt after 12 messages |
| Export direct capture | PRD/analyst export reads the draft from chat history — no regeneration API call |
| Brief response mode | Agents ask one question at a time mid-conversation; full document only at export |

Token usage and estimated cost are logged on every request:
```
[TOKENS] model=claude-haiku-4-5-20251001 | input=12400 (uncached=800 cache_write=11200 cache_read=400) | output=320 | cost ~$0.003200
```

## Project Context

The `context/` directory contains markdown files injected into every agent's system prompt. Fill these in to give agents background knowledge about your product so they don't ask for information you've already documented. See [`context/README.md`](context/README.md) for detailed guidelines.

| File | Contents | Status |
|------|----------|--------|
| `company.md` | Company overview, team, customers, business model | Active |
| `strategy.md` | North star, OKRs, roadmap themes, explicit non-priorities | Active |
| `tech-stack.md` | Frontend/backend/infra of the product being built | Create to enable |
| `db-schema.md` | Database schema of the product being built | Create to enable |
| `process.md` | Dev lifecycle, definition of ready/done, release process | Create to enable |
| `current-state.md` | Where things stand today, active work, known debt | Create to enable |

Context files are cached in memory after first load. Restart the server after editing them. Add any new `.md` files and they are picked up automatically.

## Quick Sessions

Quick sessions are ad-hoc sessions not tied to any Airtable roadmap item. Up to 5 can exist at once.

- Quick sessions are **Backlog mode only** — PRD and Analyst tabs are disabled when a quick item is selected
- The backlog menu shows **Quick Tickets** (describe a feature conversationally — no PRD required) and **Chat** only
- Deleting a quick session removes all DB records and disk files for that session

## BMAD Agent Framework

Agent personas and workflow instructions live under `_bmad/`. The backend loads them at runtime — editing a file takes effect on the next server restart (personas/workflows) or immediately (context files). See [`_bmad/README.md`](_bmad/README.md) for a full map of active agents, workflow steps, and what each template produces.

**Currently active agents:**
- Rex / Pip (PM) — handles `prd` and `backlog` modes
- Sage (Analyst) — handles `analyst` mode

**To wire up a new agent or workflow:** add an entry to `MODE_AGENT_MAP` and `MODE_MENU_CODES` in `app/backend/src/agents/bmad-agent.ts`, and add the corresponding `AppMode` to `app/shared/src/types.ts`.

## Development Commands

```bash
npm run dev              # Start frontend + backend concurrently
npm run dev:backend      # Backend only (tsx watch)
npm run dev:frontend     # Frontend only (Vite)
npm run build            # Build all workspaces

# After editing app/shared/src/types.ts:
cd app/shared && npm run build

# Integration tests (hit real APIs)
npm run test:airtable
npm run test:claude
npm run test:ado
```

## Database

Schema is defined in `db/schema.sql` and mirrored in `app/backend/src/data/database.ts`. Six tables:

| Table | Purpose |
|-------|---------|
| `items` | Work item registry (Airtable initiatives + quick-add items) |
| `sessions` | Agent conversation sessions, one per item × mode |
| `messages` | Full conversation history (source of truth for AI context) |
| `artifacts` | Exported document metadata + file paths |
| `staged_decisions` | Agent decision candidates (pending Decision Log Agent) |
| `context_loads` | Context audit trail (Phase 5+, schema only) |

## License

Internal use only — xCube
