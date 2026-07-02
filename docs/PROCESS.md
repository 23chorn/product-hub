# End-to-End Process: Product Goal → Shipped Implementation

This document walks through the complete lifecycle of a feature or initiative — from the first description of a product goal to a developer implementing tickets with Claude Code. It is written for anyone new to the system who needs to understand what happens at each step and why.

---

## Overview

The process has two phases:

**Product phase** (Product Hub UI) — AI agents research the idea, write the PRD, plan features, decompose stories, and push everything to Azure DevOps. A human reviews and approves at every stage.

**Implementation phase** (`pipeline` CLI) — a developer pulls their stream's tickets and context files, then Claude Code implements them in dependency order.

```
[PM / Product Owner]                       [Developer]
       │                                        │
       ▼                                        │
  Open Product Hub                             │
  Describe initiative goal                     │
       │                                        │
       ▼                                        │
  Coordinator confirms brief                   │
       │                                        │
       ▼                                        │
  Analyst → PRD → Epic/Feature Planner         │
  (AI runs, human approves each stage)         │
       │                                        │
       ▼                                        │
  Story Decomposition F1/F2/F3                 │
  (7-agent team per feature)                   │
  Stories + test cases pushed to ADO ──────────┼──► ADO tickets created
       │                                        │
       ▼                                        ▼
  Workflow complete                     `pipeline run --init=N --stream=X`
                                               │
                                               ▼
                                        Context + plan files written
                                        ADO tickets → "In Dev"
                                               │
                                               ▼
                                        Claude Code implements tickets
                                        in dependency order
```

---

## Phase 1 — Product (in the Product Hub UI)

### Step 1: Initial setup (one-time)

Before launching any initiative, fill in the project context files that every agent reads:

1. Open the app at `http://localhost:5173` (or your deployed URL)
2. Click **Knowledge Studio** in the header → **Context** section
3. Fill in `company.md` and `strategy.md` at minimum
4. Optionally add `tech-stack.md`, `db-schema.md`, `process.md`, `current-state.md`

These files persist across all workflows. They tell agents who you are, what you're building, and what constraints apply — so you don't have to repeat yourself in every brief.

For AI provider and integration configuration, see the **Environment Variables** section in [README.md](../README.md).

---

### Step 2: Launch an initiative

**Normal path (Airtable):**

1. Click **Sync Airtable** in the header to pull in the latest roadmap items
2. Find the initiative card and click **Launch →**
3. The Coordinator reads the existing brief and launches immediately if it contains all four required elements: problem statement, target users, scope boundary, and hard constraints

**Ad hoc path (no Airtable):**

1. Click **New Initiative** in the header
2. Describe the initiative goal in the text area
3. The Coordinator will ask up to 3 rounds of clarifying questions (max 2 per round) if something is genuinely missing from the brief, then confirm it's ready to proceed
4. Toggle the stages you want to run, then click **Start Workflow**

---

### Step 3: Research stage (Analyst — Sage)

The Analyst researches the market, users, competitors, and risks. It produces a **Research Brief** with cited sources.

After the stage completes:
- The **Critic (Flint)** automatically reviews the output and may trigger one automatic revision if it finds significant issues
- A **checkpoint** appears in the event log — review the artifact and choose:
  - **Approve** — move to PRD
  - **Revise** — provide written feedback; the Analyst reruns with your corrections
  - **Reject** — end the workflow

The artifact viewer shows the research brief in full. Click the expand icon for fullscreen.

---

### Step 4: PRD stage (PM Strategy — Rex)

Rex writes the Product Requirements Document: user personas, user journeys, functional requirements (FRs), non-functional requirements (NFRs), and success metrics.

If you have behaviour docs in `context/behaviour/`, Rex automatically loads the ones most relevant to this initiative (keyword-matched) so it understands what existing features already do.

Review and approve as in Step 3.

---

### Step 5: Epic Feature Planner (Apex)

Apex breaks the initiative into an epic and features, with rough phase groupings (MVP, Phase 2, etc.).

On approval, Product Hub **pushes to Azure DevOps**:
- Creates the epic and feature shells as work items
- Attaches wiki links to Research/PRD/Architecture artifacts (if wiki integration is on)
- Attaches the Figma file URL (if available)

The ADO IDs are saved locally so subsequent pushes can find the existing items.

---

### Step 6: Story Decomposition (per feature)

Each feature gets its own story decomposition stage (`story_decomposition_F1`, `F2`, `F3`). A 7-agent team runs collaboratively:

| Agent | Contribution |
|-------|-------------|
| Product (Shard) | User stories with acceptance criteria (Given/When/Then) |
| QA Engineer (Vera) | Test cases for each story |
| Backend Engineer (Finn) | Technical ACs for API/database/server work |
| iOS Engineer (Remi) | iOS-specific technical ACs (only if product area includes iOS) |
| Android Engineer (Cole) | Android-specific technical ACs (only if product area includes Android) |

Each feature stage creates **two checkpoints** — one for Stories (Product/PM approval) and one for QA Tests (QA approval). Both must be approved before the workflow advances to the next feature.

On approval, Product Hub pushes to ADO:
- Adds user stories to the feature work item with full user story format, ACs, and platform tags
- Creates a test plan with all test cases, linked to their stories

The event log shows live links to the ADO Feature board and Test Plan after each feature completes.

---

### Step 7: Curator (Ivy)

After all features are decomposed, the Context Curator proposes updates to your `context/*.md` files based on decisions and facts surfaced during the workflow. Review the proposed diffs in Knowledge Studio → Context.

---

### Optional: Post-pipeline stages

After the workflow completes, additional stages are available from the workflow view:

- **Prototype (Nova)** — generates an interactive low-fidelity wireframe of the affected screens only (not the whole app). Renders inline in the browser with a device frame toggle.
- **Figma Design (Luma)** — produces a design brief for a human designer. Not an automated Figma write — a person still builds the screens.
- **Change Request** — for targeted post-completion changes. The Coordinator identifies which stages are affected; only those stages rerun.

---

## Phase 2 — Implementation (developer CLI)

Once story decomposition is complete and tickets exist in ADO, a developer uses `@xcube/pipeline` to pull their work and launch Claude Code.

### Step 1: Install the CLI

```bash
npm install -g @xcube/pipeline
# or use npx without installing
```

### Step 2: Configure

Create a `.env` file in your implementation repository (or in `packages/pipeline/` if running from source):

```bash
PIPELINE_API_URL=http://your-product-hub-host:3001
PIPELINE_API_KEY=your-api-key
```

The API key must match `PIPELINE_API_KEY` in Product Hub's `.env`. Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3: Run the pipeline

Navigate to your implementation repository and run:

```bash
pipeline run --init=<N> --phase=<phase> --stream=<stream>
```

- `--init` — the initiative number shown on the card in Product Hub (e.g. `21`)
- `--phase` — the phase label from the backlog (e.g. `mvp`, `v2`) — must match exactly
- `--stream` — your platform: `backend`, `web`, `ios`, or `android`

Example:
```bash
cd ~/repos/my-app
pipeline run --init=21 --phase=mvp --stream=ios
```

The CLI prints progress as it runs:
```
@xcube/pipeline — Initiative #21  phase:mvp  stream:ios
1/4  Fetching initiative context... done
     Add Price Alerts
     4 tickets in scope, 4 in implementation order

2/4  Fetching ticket details... done

3/4  Writing context files... done
     PIPELINE_CONTEXT.md
     PIPELINE_PLAN.md

4/4  Updating Azure DevOps ticket states... done
     ✓ 4 ticket(s) moved to "In Dev"

✓ Ready

Launching Claude Code in /Users/dev/repos/my-app
```

### Step 4: Claude Code implements the tickets

Claude Code launches in your workspace with:
- A system prompt telling it to work through `PIPELINE_PLAN.md` in order
- `PIPELINE_CONTEXT.md` — full initiative context and every ticket's details (user stories, ACs, technical ACs, FRs/NFRs, platform notes)
- `PIPELINE_PLAN.md` — an ordered checklist of tickets to implement

Claude Code:
1. Reads the first unchecked ticket from `PIPELINE_PLAN.md`
2. Looks up its full details in `PIPELINE_CONTEXT.md`
3. Implements the ticket
4. Builds the project and runs tests
5. Marks the ticket `[x]` in `PIPELINE_PLAN.md` and increments the status counter
6. Moves to the next ticket

You stay in the loop in interactive mode — you can interrupt, redirect, or ask questions at any point.

### Cross-stream dependencies

If a ticket in your stream depends on a ticket in another stream (e.g. an iOS ticket that depends on a backend API), it surfaces in the manifest as a **blocked ticket** and is excluded from `implementationOrder`. The iOS developer can work on the independent tickets in their stream while the backend developer completes the dependency.

Once the blocking ticket is marked done in ADO, the iOS developer re-runs `pipeline run` (or fetches the payload directly) to get the now-unblocked ticket.

### Headless mode (CI / automated environments)

```bash
pipeline run --init=21 --phase=mvp --stream=backend --mode=headless
```

Launches `claude -p <prompt>` non-interactively. Useful for automated dev environments or CI pipelines that batch-implement tickets.

---

## Ticket content at implementation time

When Claude Code implements a ticket, it has access to:

| Field | What it contains |
|-------|----------------|
| User story | As a `persona`, I want `goal`, so that `benefit` |
| Acceptance criteria | Given/When/Then functional scenarios |
| Technical ACs | Implementation-level testable conditions |
| Platform notes | Platform-specific implementation hints (per stream) |
| Feature description | High-level context for the capability this story belongs to |
| Initiative context | Problem statement, target users, success metrics, constraints, out-of-scope |
| Functional requirements | Which FRs from the PRD this story satisfies |
| Non-functional requirements | Performance, scalability, and security thresholds the story must meet |
| Dependency order | `implementationOrder` ensures stories are tackled after their dependencies |

This means the developer (and Claude Code) knows exactly what to build, to what standard, and in what order — without hunting through PRDs or asking questions.

---

## Roles and approvals

| Who | What they do |
|-----|-------------|
| Product Owner / PM | Launches initiatives, approves Stories checkpoints, runs Discovery |
| QA Lead | Approves QA Tests checkpoints |
| Admin | Full access, user management, Knowledge Studio repos |
| Developer | Runs `pipeline` CLI, implements tickets in their repo |

Checkpoint roles are configurable per stage in **Settings → Access → Stage Roles**.

---

## Quick reference: API endpoints used by the pipeline CLI

| Endpoint | Purpose |
|----------|---------|
| `GET /api/dev/initiatives/:n/manifest?stream=X&phase=Y` | Initiative context, features, tickets, implementation order |
| `GET /api/dev/initiatives/:n/tickets/payload?ids=F0.S0,F0.S1` | Full ticket details for a batch of local keys |
| `PUT /api/dev/initiatives/:n/tickets/state` | Bulk update ticket states in ADO (New → In Dev) |

See [`docs/api/dev-tickets-api.md`](api/dev-tickets-api.md) for the full API reference.
