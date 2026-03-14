# Product Hub — User Guide

**Audience:** Product Managers using the app

---

## What Is Product Hub?

Product Hub is your AI-powered product ops team. You describe what you're trying to build, and a coordinated set of AI agents researches it, writes the PRD, designs the architecture, breaks it into a developer-ready backlog, and reviews the output for quality — all with you approving at every step.

The output is designed to be picked up immediately by developers (human or AI) without needing to come back to you for clarification.

---

## How It Works

You talk to one agent: the **Chief of Staff** (Coordinator). It gathers requirements, plans the work, briefs specialist agents, and brings results back to you at structured checkpoints. You review and approve at each checkpoint before the pipeline moves on.

The specialist pipeline:

1. **Analyst (Sage)** — researches your goal, maps the landscape, identifies risks and opportunities
2. **PM Strategy (Rex)** — frames the problem, writes the PRD with user personas, journeys, and requirements
3. **Architect (Atlas)** — designs the solution architecture aligned to your tech stack
4. **Backlog Agent (Pip)** — turns the PRD and architecture into epics, features, and stories
5. **Critic** — automatically reviews each specialist's output for quality (runs inline, not as a separate step)
6. **Context Curator** — proposes updates to the system's background knowledge based on what was learned

---

## Starting a Workflow

### Step 1 — Select an initiative (optional)

From the left panel, select an initiative from your roadmap. If you don't select one, a local initiative is created automatically from your goal.

### Step 2 — Write your goal

In the centre panel, type what you want to achieve. Include:
- **Who it's for** — target user or customer segment
- **The core problem** — what's broken or missing today
- **Key outcomes** — measurable success criteria
- **Scope** — MVP or full product, what's in/out
- **Constraints** — technical, regulatory, budget, timeline

### Step 3 — Answer clarifying questions

Before asking anything, the Chief of Staff reads your project context files (Company Overview, Strategy, Current State) so it already knows your company, product, and tech landscape. It asks questions only to fill gaps on four specific criteria: the **problem** being solved, the **target user**, the **scope boundary** (MVP vs. deferred), and any **hard constraints**. Once it can answer all four, it signals readiness immediately — often after a single round. Maximum 3 rounds regardless. Answer concisely — it makes reasonable inferences from terse replies.

### Step 4 — Choose your stages

Before the workflow launches, you'll see toggle buttons for each stage: **Research**, **PRD**, **Arch**, **Backlog**, **Context**. All are enabled by default.

- Click a stage to toggle it off (shown as grey with strikethrough)
- At least one stage must remain enabled
- Useful when you already have research and just need a backlog, for example

### Step 5 — Watch the pipeline run

The left panel shows the stage tracker. Each stage runs autonomously, then pauses for your review.

---

## Writing a Good Goal Statement

The quality of your goal directly affects everything the pipeline produces.

**Too vague:**
> Improve onboarding

**Better:**
> Redesign the onboarding flow for enterprise customers

**Best:**
> Redesign the onboarding flow for enterprise customers who purchase via our sales team. The current flow assumes self-serve signup and fails for accounts that need SSO, multi-team provisioning, and admin-first setup. We want to cut time-to-first-value from 14 days to under 5. Budget: $80k, target launch in 8 weeks.

The more constraints and context you include, the fewer revision rounds you'll need.

**If your context files are filled in:** You don't need to repeat company or product background in your goal — the agents already know it from the Context Editor files. Focus your goal on what's new or different about this initiative. A brief anchor phrase like "building on our current tech stack" or "for our enterprise customer segment" is enough to confirm shared context.

---

## The Stage Tracker

The left panel shows where the pipeline is:

| Status | Meaning |
|--------|---------|
| ⬜ Pending | Stage not yet started |
| 🔵 In progress | Agent currently running |
| 🟡 At checkpoint | Waiting for your review |
| ✅ Complete | Approved and done |

Clicking a completed stage opens its artifact for review.

---

## Checkpoints

Every specialist stage pauses for your review. Nothing moves forward without your approval.

When a stage completes, the conversation shows the result and action buttons appear.

### Approve
The output meets your standard. The workflow moves to the next stage automatically.

**When to approve:** The artifact covers the right scope and reflects your intent.

### Revise
You want changes before moving on. Type your feedback — be specific. The system incorporates your feedback and reruns the stage.

**Good revision feedback:**
> Three changes: (1) Remove the consumer app competitor section — not relevant. (2) Add a section on enterprise SSO integration patterns for SAML 2.0. (3) The time-to-value metric should reflect admin setup time, not end-user first login.

**Weak revision feedback:**
> Make it better.

Specific, numbered instructions produce specific revisions.

### How the Chief of Staff handles revision feedback

When you submit revision feedback, the Chief of Staff classifies it before acting:

| Type | What it means | What happens |
|------|--------------|--------------|
| **Output correction** | Something in the artifact is wrong or missing | Routed directly to the specialist for a targeted revision |
| **Scope change** | You're changing what should be built | The Chief of Staff pauses, names which stages are affected, and confirms before proceeding |
| **Upstream gap** | The feedback reveals a problem in an earlier stage | Flagged explicitly — you're offered the choice to redo from that earlier stage or proceed with a documented assumption |

This classification ensures corrections are fast while scope changes and upstream problems get the attention they deserve instead of silently compounding.

### Reject
The workflow ends. Use this if the direction is fundamentally wrong and you want to start over.

---

## Quality Review (Critic)

The Critic runs automatically after each specialist stage — you don't interact with it directly. It checks the output and either:

- **Passes** — no issues found, the checkpoint is created for your review
- **Auto-revises** — issues found, the specialist reruns with the feedback (up to 2 times)
- **Escalates** — after 2 revision attempts, pauses for your input with the issues listed

The Critic applies stage-specific checks tailored to each artifact type — Research Briefs are evaluated on market coverage and evidence quality, PRDs on problem framing and requirement completeness, Architecture Documents on technical soundness and stack alignment, and Backlogs on story granularity and testability. Each stage has its own CRITICAL and MAJOR rules suited to what matters at that stage.

The Critic's review details (issue counts, severity) are shown in the narration thread.

---

## Context Updates (Curator)

After the workflow completes, the Curator reviews everything produced and proposes updates to the project's context files — the background documents every AI agent reads.

If changes are proposed, an amber badge appears in the header. Click it to open the diff review panel. Each proposed change shows:
- The file being changed
- Whether it's an addition, update, or removal
- The proposed text and rationale

You can approve or reject individual changes. Approved changes take effect immediately for all future workflows.

**Why this matters:** Accurate context files mean every future workflow starts with better-grounded agents. You spend less time re-explaining your product, team, and strategy.

---

## Redoing a Stage

After a workflow completes, you can revisit any stage:

1. Click **Redo from [Stage]** at the bottom of the conversation
2. Explain what changed or what needs to be different
3. That stage and all downstream stages rerun with your feedback

This is useful when requirements change after a workflow, or when you want to explore an alternative direction.

---

## Multi-Phase Workflows

Product Hub supports iterative, multi-phase development. After completing a phase 1 (MVP) workflow, you can start a phase 2 workflow where all agents have full awareness of what phase 1 produced.

### How it works

The **Context Curator** automatically updates `current-state.md` at the end of every workflow with a summary of what was produced, key decisions made, and what comes next. Since context files are injected into every agent's system prompt, subsequent workflows inherit this knowledge automatically.

### Running phase 2

1. **Complete phase 1** — run through all stages and approve each checkpoint
2. **Approve curator diffs** — after the workflow finishes, the Curator proposes context updates including a phase summary in `current-state.md`. An amber badge appears in the header — click it and approve the changes
3. **Start a new workflow** — type a phase 2 goal that builds on the previous work

**Example phase 2 goal:**
> Phase 2 for the enterprise onboarding feature: add admin dashboard with team provisioning analytics and SSO configuration self-service. Build on the MVP we defined in phase 1.

You don't need to re-explain what phase 1 covered — the agents read `current-state.md` and know what was already decided, what was deferred, and what the next steps are.

### Reviewing and editing phase context

If you want to refine what the Curator captured before starting the next phase:

- Open the **Context Editor** (click **Context** in the header)
- Select **Current State** and edit the sections directly
- Changes take effect immediately for the next workflow

### Tips for multi-phase work

- **Approve curator diffs promptly** — the phase summary only enters the shared context once you approve it
- **Be specific about what's new in phase 2** — the agents know what phase 1 produced, so focus your goal on what's different or additional
- **Check `current-state.md` before starting** — verify it accurately reflects where things stand; correct anything the Curator got wrong

If `current-state.md` doesn't exist yet (e.g. you never created one in the Context Editor), the Curator creates it automatically with a starter template the first time it runs.

---

## Mid-Workflow Chat

You can message the Chief of Staff while a workflow is running. Use this to:
- Ask about the current status
- Provide corrections or preferences for upcoming stages
- Share context that should influence the next specialist

Type in the input box at the bottom of the conversation at any time during a workflow.

---

## Context Editor

Click **Context** in the header to open the Context Editor. You can edit 6 project knowledge files directly from the UI:

| File | Purpose |
|------|---------|
| Company Overview | Company, team, customers, business model |
| Product Strategy | North star, OKRs, roadmap themes |
| Tech Stack | Frontend, backend, infrastructure |
| Database Schema | Tables, relationships, key fields |
| Development Process | Lifecycle, definition of ready/done |
| Current State | Active work, known debt, where things stand |

Files with templates show a **Load template** button when empty. Changes are saved immediately and picked up by the next agent request.

---

## Template Editor

Click **Templates** in the header to edit the output templates that agents follow when producing documents:

| Template | Used by |
|----------|---------|
| Research Brief | Analyst (Sage) |
| PRD | PM Strategy (Rex) |
| Architecture | Architect (Atlas) |
| Backlog | Backlog Agent (Pip) |

**Saves require double-confirmation** because template changes affect all future outputs. The first click shows a warning; the second click saves.

---

## Workflow Cost

The estimated cost of the current workflow is shown in amber text in the header (e.g. `$0.12`). This tracks all specialist, critic, and curator token usage for the workflow.

---

## Choosing a Model

The model dropdown in the header controls which AI model runs your requests. Your choice persists across sessions.

- **Faster and cheaper (Haiku):** Good for iteration and testing
- **More capable (Sonnet / Opus):** Better for production-quality PRDs, architecture docs, and backlogs

---

## Returning to a Workflow

If you close the app mid-workflow, your progress is saved automatically. When you reopen, it restores exactly where you were — same stage, same checkpoint.

To start fresh, the current workflow must be completed or you can start a new one from the workflow history panel.

---

## Policies

Policies control how autonomously the pipeline operates. Set once, applies to all workflows.

| Policy | Default | Effect |
|--------|---------|--------|
| `require_critic_review` | On | Off = skip quality review after each specialist |
| `auto_approve_critic` | Off | On = auto-approve when critic passes (no human gate) |

Policies are stored in the database. Contact your developer to adjust them.

---

## Tips

- **Start with a specific goal, not a category.** "Improve search" starts agents in the wrong place. "Users can't find products by attribute combination — we need faceted search with real-time filtering" starts them in the right place.
- **The first checkpoint is worth your time.** Five minutes reviewing scope saves hours of rework downstream.
- **Context files matter.** The more accurate your project knowledge, the less you re-explain in every workflow.
- **Use stage toggles.** Skip research when you already have it. Skip architecture when it's a simple feature. Run only the backlog stage for a well-scoped ticket.

---

## Troubleshooting

**The Coordinator keeps asking questions instead of launching.**
The Chief of Staff launches as soon as it can answer four criteria: problem, target user, scope boundary, and constraints. This often happens after a single round. If it keeps asking, your goal likely lacks scope specificity or a named user segment. Add a sentence addressing what's in scope for this initiative and who it's for. If your context files are filled in, include a brief reference to them in your goal (e.g. "building on our current tech stack" or "for our existing enterprise customers") so the coordinator can confirm what it already knows rather than asking to verify it.

**An agent produces output about the wrong topic.**
The context files may describe a different product than what you're building. Update them via the Context Editor.

**My workflow is stuck at a checkpoint.**
The system waits indefinitely for your response. Open the conversation and approve, revise, or reject to continue.

**The cost seems high.**
Switch to a cheaper model (Haiku) for iteration, then use a more capable model for the final run. Prompt caching reduces cost significantly on subsequent requests.

**A completed stage has wrong content.**
Use "Revise with feedback" at the current checkpoint, or after the workflow completes, use "Redo from [Stage]" to rerun it.
