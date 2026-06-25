# xCube Flow

AI-powered product operations platform. Launch a roadmap initiative — synced from Airtable with a complete brief, or described ad hoc — and a coordinated team of AI agents researches it, writes the PRD, designs the architecture, produces a developer-ready backlog with QA test suite and technical refinements — then pushes it all to Azure DevOps with full story/test linkage. Human review at every stage.

## Overview

You talk to one agent: the **Coordinator** (Chief of Staff). It confirms the brief is complete — asking only if something's genuinely missing — briefs specialist agents, and brings results back to you at structured checkpoints. Nothing moves forward without your approval.

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
- **Prototype Builder (Nova)** — optional, post-pipeline: a low-fidelity wireframe of just the screen(s) the change affects, not the whole app
- **Figma Designer (Luma)** — optional, post-pipeline: a concise screen-by-screen design brief for a human designer to build in Figma
- **Discovery Scout** — separate from the pipeline: surfaces candidate opportunities from interviews, app store reviews, and competitor notes for a PM to review (see [Discovery Mode](#discovery-mode))
- **Doc Reviewer (Cass)** — separate from the pipeline: on-demand, single-file documentation review inside Knowledge Studio's [Documentation Review](#documentation-review) section
- **Critic (Flint)** — adversarial quality review after each specialist stage
- **Context Curator (Ivy)** — proposes updates to project knowledge files based on workflow outputs

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS (port 5173) |
| Backend | Node.js + Express + TypeScript (port 3001) |
| Database | SQLite via `better-sqlite3` (`db/product-ops.db`) |
| Artifact storage | Disk, under `data/sessions/...` — SQLite holds a pointer row per file |
| AI | Anthropic API, AWS Bedrock, or Ollama (local) — model selectable from UI |
| Integrations | Airtable (roadmap items), Azure DevOps (work items + wiki), Figma, Slack |

```
product-agent/
├── app/
│   ├── backend/       Express API, agents, workflow engine
│   │   └── src/demo/  Demo mode fixtures and webhook simulation
│   ├── frontend/      React UI (two-column layout)
│   └── shared/        Compiled TypeScript types (@pap/shared)
├── agents/
│   ├── personas/      Agent persona markdown files (coordinator, analyst, pm, architect, critic, curator, qa-engineer, doc-reviewer, prototype-builder, platform engineers)
│   └── templates/     Output templates (research, prd, architecture, backlog, qa-tests, prototype)
├── context/           Project context files injected into every agent prompt
│   ├── behaviour/     Existing feature behaviour docs (.feature), injected into the PRD stage only
│   └── README.md      Guidelines for filling in context files
├── db/
│   ├── schema.ts       Canonical Drizzle schema (tracked)
│   ├── migrations/     Versioned SQL migrations, applied automatically on startup
│   └── product-ops.db  Runtime database (gitignored)
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

1. **Launch an initiative** — normally a roadmap item synced from Airtable, already carrying a complete brief (problem, users, scope, constraints) by team convention; the in-app "New Initiative" form is the fallback for ad hoc work not yet in Airtable
2. **The Coordinator checks the brief against four exit criteria** (problem, user, scope boundary, hard constraints) and launches immediately once it can state all four — it only asks clarifying questions (max 2 per message, up to 3 rounds) when the brief is genuinely missing one of them
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

**Optional design stages (run after the core pipeline):**
- Prototype (Nova) — a low-fidelity, brand-neutral wireframe of just the screen(s) the change affects (plus a before/after pair for transitions), not a full app or a branded mock
- Figma Design (Luma) — a concise design brief for a human designer, not an automated Figma write — surfaces which screens are needed and what's missing from the design system

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

**Dual checkpoints for story decomposition:** each `story_decomposition_F*` stage creates *two* independent checkpoints — a **Stories** checkpoint (Product/PM approval) and a **QA Tests** checkpoint (QA approval). Both must be approved before the workflow advances to the next feature. If one reviewer requests revisions after the other has already approved, the approved side is automatically invalidated and both artifacts regenerate together — partial approvals never go stale against regenerated work.

After a workflow completes, you can **redo from any stage** — provide a reason, and that stage plus all downstream stages rerun.

**Slack notifications** — set `SLACK_WEBHOOK_URL` to post a message when a checkpoint needs review and when a workflow completes.

### Sprint Estimation

The backlog stage automatically calculates sprint estimates using your team's velocity and capacity factor (configured in the in-app **Settings** panel):
- **Epic level** — total story points divided by effective velocity
- **Feature level** — per-feature sprint estimates shown in the backlog preview
- **AI-assisted estimates** — when AI-assisted development is enabled in Settings, shows AI vs traditional hour comparisons

## Roles & Access Control

Authentication is optional — with no users in the database, the app runs in single-user, admin-equivalent "no-auth" mode. Once users exist, every request requires a session and is gated by role.

| Role | Grants |
|------|--------|
| **Admin** (`is_admin`) | Everything below, plus user management and the **Knowledge Repos** settings tab (which ADO repos Documentation Review tracks) |
| `product` | Launch new workflows, run/promote Discovery opportunities, approve Stories checkpoints and any stage mapped to `product` in Stage Roles |
| `qa` | Approve QA Tests checkpoints and any stage mapped to `qa` (e.g. `qa_engineer`, `qa_engineer_F1`–`F3`) |
| `tech_lead`, `design` | Approve stages mapped to that role via Stage Roles; no special default stages out of the box |
| `management` | Read-only access to the **Stats Dashboard** (cycle time, first-time-approval rate, throughput, bottlenecks) |
| `view_only` | Hard-deny marker — overrides every other role a user holds. No checkpoint approvals, no Studio edits, no comments, no Knowledge Repo sync, no new initiatives. Read access only |

Which role a checkpoint requires is configurable per stage in **Settings → Access → Stage Roles** (`stage_roles` table) — the `qa` ↔ QA-stage mapping above is the shipped default, not hardcoded. Roles are assigned per user in **Settings → Access → Users**.

## UI Features

### Home Screen
The home screen lists your initiatives as cards showing title, workflow status, and current stage progress. Cards auto-refresh when any workflow is active. Ways to start a new workflow:
- **Launch a synced initiative** — the normal path: click **Launch →** on a roadmap item synced from Airtable (via **Sync Airtable** in the header), already carrying a complete brief
- **New Initiative** — opens a form to describe an ad hoc initiative not yet in Airtable; the Coordinator confirms the brief before launching
- **Simulate webhook** — instantly creates and launches a full pipeline from a set of sample initiatives (In-App Messaging, Onboarding Redesign, Portfolio Analytics, Social Trading) — useful for demos showing multiple parallel workflows

### Pipeline Terminal View
When a workflow is active, the main view switches to a split-pane terminal layout:
- **Left pane** — stage list with progress bar, completion status, and per-stage cost
- **Right pane** — live event log grouped by stage, showing agent progress, critic reviews, and checkpoints with inline approve/revise/reject actions

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
After a workflow completes, click **Generate Prototype** to create an interactive wireframe:
- Agent reads the workflow artifacts (PRD, architecture, backlog) and covers **only** the screen(s) the change affects — plus a before/after pair if there's a transition — not the whole app
- Built from a small set of generic, brand-neutral components (flat colors, plain shapes) rather than your design system, so review focuses on layout and flow, not visual polish
- Produces a self-contained React app rendered in-browser via an iframe
- Device frame toggle: desktop / tablet / mobile
- Code viewer panel showing all generated `.tsx` files
- Revision input to refine the prototype with natural language instructions

### Figma Design Brief
After the prototype (or directly after the core pipeline), the **Figma Design** stage produces a short JSON brief for a human designer — which screens are needed, what each shows, how they connect, and what's missing from the design system. It is not an automated Figma mockup generator: a person still builds the actual screens in Figma using the brief as a starting point.

### Discovery Mode
Click **Discovery** in the header to open a separate, lightweight opportunity-surfacing flow that sits outside the staged pipeline — no checkpoints, just a direct run:
1. **Add source documents** — paste in user interview notes, app store/Play store reviews, or competitor notes
2. **Select sources and click Run Discovery** — Scout reviews them alongside a snapshot of your current backlog (so it doesn't re-pitch what's already in flight) and surfaces a handful of evidence-backed opportunity drafts
3. **Review the feed** — each opportunity shows its rationale and cited evidence; **Dismiss** the ones that aren't worth pursuing
4. **Promote** a promising one — creates an Airtable record and a local item, so it appears on the Home screen ready to launch through the normal pipeline (requires `ROADMAP_INTEGRATION=airtable`)

Only Product/Admin roles can run discovery or promote an opportunity; other roles can still add source documents.

### Change Requests
After a workflow completes, **Change Request** opens a centred modal to describe a targeted change:
1. Select change type (Correction, Scope, Direction, Constraint, Stakeholder, Technical)
2. The Coordinator assesses impact and lists affected stages
3. Confirm which stages to re-run — only selected stages execute, not the full pipeline

### Initiative List
The left sidebar shows local initiatives and Airtable roadmap items (when configured). Each initiative displays its workflow status (active/paused/done) and clicking one restores the full workflow state.

### Knowledge Studio
Click **Knowledge Studio** in the header to manage everything that shapes agent behaviour and project documentation, organised into collapsible sections:
- **Context** — edit the canonical `context/*.md` project files. Changes are picked up immediately by the next agent request — no server restart needed. Includes **Airtable Sync**, a manual trigger that checks Airtable initiative statuses against the last-seen snapshot and, on request, runs the **Context Keeper** agent to propose `context/*.md` edits for material transitions (e.g. an initiative moving to Shipped)
- **Behaviour Docs** — edit the `.feature` files in `context/behaviour/` that describe how existing functionality currently works; only surfaced to the PRD stage, matched by keyword relevance to the initiative
- **Agents** — edit a persona's prompt, its output template, and its registered validator tools, with version history per file
- **Tools** — review the structural validators each stage calls before returning output
- **Documentation Review** — see below

#### Documentation Review
A read-only-against-source documentation review workflow for Markdown files living in Azure DevOps repos — independent of the staged product pipeline. Requires `WORK_ITEMS_INTEGRATION=ado` (reuses the same `AZURE_DEVOPS_*` credentials; no separate setup).

1. **Track a repo** — an admin adds an ADO repository in **Settings → Knowledge Repos** (label, repo name, optional branch/project). The repo is synced immediately and can be re-synced on demand; sync never writes back to the repo.
2. **Browse files** — every `.md` file in a tracked repo appears in the sidebar, grouped by repo, filterable by owner/status and by "needs frontmatter." Files must open with a `file-name:`/`owner:`/`status:` YAML frontmatter block to be considered valid — files missing it are flagged with a warning badge.
3. **Review with AI** — the **Doc Reviewer (Cass)** agent reads the file plus the committee's standing guidelines (`context/doc-review-guidelines.md`, copy from the `.example.md` template to activate) and posts 0–8 suggestions as comments (`minor`/`major`). Cass never edits the file or proposes a rewrite — only the humans who own the doc do that.
4. **Comment and resolve** — anyone who isn't `view_only` can add their own comments (optionally anchored to a quoted excerpt) and mark any comment (human or AI) resolved.
5. **History and diffs** — a History tab shows live commit history and per-commit diffs pulled directly from Azure DevOps (not cached locally), useful for auditing how a policy doc evolved.

### Mid-Workflow Chat
Talk to the Chief of Staff while a workflow is running. Ask status questions, provide corrections, or share preferences that should apply to upcoming stages.

### Stats Dashboard
Click **Stats** in the header (visible to Admin and `management` roles) for read-only cycle-time, first-time-approval-rate, throughput, and bottleneck metrics across workflows, over a configurable date range.

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

# Work items (Azure DevOps)
WORK_ITEMS_INTEGRATION=ado|none
AZURE_DEVOPS_ORG=...
AZURE_DEVOPS_PROJECT=...
AZURE_DEVOPS_PAT=...
AZURE_DEVOPS_STORY_TYPE=User Story  # or "Product Backlog Item" for Scrum template

# Azure Wiki (optional — auto-publishes analyst/PRD/architecture/prototype/figma_design
# drafts to the ADO wiki; reuses the AZURE_DEVOPS_* credentials above)
KNOWLEDGE_BASE_INTEGRATION=azure_wiki|none

# Figma (optional — lets the Figma Design stage check your design system
# for gaps before writing the design brief)
FIGMA_API_KEY=...
FIGMA_DESIGN_SYSTEM_FILE=...
FIGMA_MOCKUP_FILE=...

# Slack (optional — posts a notification when a checkpoint needs review,
# and when a workflow completes)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

See `docs/integrations/` for detailed setup guides.

**Note:** `WORK_ITEMS_INTEGRATION=jira` and `KNOWLEDGE_BASE_INTEGRATION=notion|gitbook` were removed (see git history) and are no longer recognized — only `ado`/`none` and `azure_wiki`/`none` are valid today.

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
| `doc-review-guidelines.md` | Documentation committee's standing review instructions | Doc Reviewer (Cass) only — not part of the staged pipeline |

**Stage-scoped context**: Files with a YAML frontmatter `stages:` field are only injected into matching agents — useful for technical context (API contracts, DB schema, integrations) that the analyst and PM don't need. Example: `api-contracts.example.md` is injected only into the architect and story decomposition agents.

Context files can be edited from the UI (**Knowledge Studio** button in the header) or on disk. Changes take effect immediately — no restart needed.

**Behaviour docs** (`context/behaviour/`) are a separate corpus: `.feature` files describing how existing functionality behaves today, plus a `feature-map.json` search index. Unlike the files above, they're only injected into the PRD stage, and only the documents whose keywords match the initiative — not the whole corpus. Also editable from Knowledge Studio.

## Development

```bash
npm run dev              # Start frontend + backend concurrently
npm run dev:backend      # Backend only (tsx watch)
npm run dev:frontend     # Frontend only (Vite)
npm run build            # Build all workspaces
npm test                 # Run Vitest unit tests (specs in tests/unit/)

# After editing app/shared/src/types.ts:
cd app/shared && npm run build

# Type-check backend:
cd app/backend && npx tsc --noEmit
```

See [CUSTOMIZING.md](CUSTOMIZING.md) for fork customization and [docs/developer-guide/adding-an-agent-stage.md](docs/developer-guide/adding-an-agent-stage.md) for adding new specialist stages.

Setting up governance for your Product/QA team? Start from [docs/policies-and-procedures-template.md](docs/policies-and-procedures-template.md) — a template grounded in what this system actually enforces (roles, checkpoint gates, documentation review) versus what's left to your team's convention. For a broader department-level policy doc that covers Product/QA activities beyond this tool, see [docs/product-qa-policies-and-procedures.md](docs/product-qa-policies-and-procedures.md).

## Storage

### SQLite (operational data)
Schema in `db/schema.ts` (Drizzle), with versioned migrations in `db/migrations/`; runtime connection in `app/backend/src/data/database.ts`, which applies any pending migrations on startup. See [docs/database-architecture.md](docs/database-architecture.md) for the storage dispatch flow, migration workflow, and the SQLite-vs-Postgres tradeoff analysis — this table is the quick-reference summary.

| Table | Purpose |
|-------|---------|
| `items` | Work item registry (Airtable initiatives + local items) |
| `sessions` | Agent conversation sessions |
| `messages` | Full conversation history |
| `skill_versions` | Versioned agent persona prompts, output templates, and dev context, edited from Knowledge Studio's Agents tab |
| `artifacts` | Exported document metadata + file paths |
| `workflows` | Goal-oriented orchestration units with cost tracking |
| `checkpoints` | Human review pause points |
| `checkpoint_audit` | Approve/reject/revise history per checkpoint, with the resolving user and notes |
| `workflow_events` | Stage narration events for the UI |
| `coordinator_sessions` | Coordinator planning conversation persistence |
| `policies` | Governance rules injected into Coordinator prompt |
| `change_requests` | Post-completion change requests with impact assessment and status |
| `cr_artifact_versions` | Links change requests to new artifact versions and their parents |
| `ado_work_item_map` | Maps local backlog keys to Azure DevOps work item IDs for sync |
| `qa_test_plan_map` | Maps a workflow to its Azure DevOps Test Plan, suites, and test case IDs |
| `workflow_skill_assignments` | Records which skill version ran each stage of a workflow, for audit |
| `context_diffs` | Curator-proposed updates to `context/*.md` files, pending human approval |
| `context_change_proposals` | Context Keeper-proposed edits to `context/*.md` triggered by an Airtable status change (e.g. an item moving to Shipped) |
| `context_file_versions` | Version history for `context/*.md` and `context/behaviour/*.feature` edits made in Knowledge Studio |
| `item_status_snapshots` | Last-seen Airtable status per item — diffed on sync to detect transitions for Context Keeper and shipped-item stamping |
| `pipeline_runs` | Azure DevOps AI pipeline run tracking (`AZURE_DEVOPS_AI_PIPELINE_ID`) |
| `discovery_sources` | Source documents (interviews, reviews, competitor notes) for Discovery Mode |
| `discovery_runs` | One row per Discovery Scout batch run |
| `discovery_opportunities` | Opportunity drafts surfaced by a run, reviewed/promoted/dismissed by a PM |
| `discovery_opportunity_sources` | Links opportunities to the source documents that evidenced them |
| `users`, `roles`, `user_roles` | Accounts, the role catalogue, and per-user role assignments |
| `stage_roles` | Which role(s) may approve each checkpoint stage (configurable, see [Roles & Access Control](#roles--access-control)) |
| `kb_repos` | Azure DevOps repositories tracked by Knowledge Studio's Documentation Review |
| `kb_files` | Synced `.md` files per repo, with parsed `file-name`/`owner`/`status` frontmatter |
| `kb_comments` | Human and AI (Cass) review comments per file, with open/resolved status |

### Artifact content (disk)
JSON/markdown artifacts from specialist stages are written straight to disk under `data/sessions/<itemId>/<stage>/artifacts/`. The SQLite `artifacts` table holds a pointer row per file (`file_path`) plus an optional Azure Wiki mirror (`wiki_path`/`wiki_url`) and `external_url` (e.g. the ADO work item a given artifact was pushed to). No separate service to run — it's part of the same `data/` directory used as the project's local backup.
