# xCube Flow — User Guide

**Audience:** Product Managers and QA using the app

---

## What Is xCube Flow?

xCube Flow is your AI-powered product ops team. Launch an initiative — usually synced from your Airtable roadmap with a complete brief already attached — and a coordinated set of AI agents researches it, writes the PRD, designs the architecture, breaks the work into developer-ready stories feature-by-feature, drafts QA test cases, and reviews its own output for quality — all with you approving at every step.

The output is designed to be picked up immediately by developers (human or AI) without needing to come back to you for clarification.

---

## How It Works

You talk to one agent: the **Chief of Staff** (Coordinator). It checks whether your initiative's brief already answers four questions — problem, target user, scope boundary, hard constraints — and launches immediately once it can. It only asks you anything when one of those is genuinely missing.

The pipeline, in order:

1. **Analyst (Sage)** — researches your goal, maps the landscape, identifies risks and opportunities
2. **PM Strategy (Rex)** — frames the problem, writes the PRD with user personas, journeys, and requirements
3. **Architect (Atlas)** — designs the solution architecture aligned to your tech stack
4. **Epic Feature Planner (Apex)** — breaks the epic into high-level features and creates the epic + feature shells in Azure DevOps
5. **Story Decomposition team, per feature** — a 7-agent collaborative round for each feature (F1, F2, F3...): **Shard** (Product) writes stories with acceptance criteria, **Vera** (QA) writes test cases for each story, and **Finn/Remi/Cole** (Backend/iOS/Android) add platform-specific technical acceptance criteria. Stories and test cases are pushed to Azure DevOps as each feature completes.
6. **Prototype (Nova)** and **Figma Design (Luma)** — optional, post-pipeline: a low-fi wireframe of just the affected screens, then a design brief for a human designer
7. **Critic** — automatically reviews each specialist's output for quality (runs inline, not as a separate step)
8. **Context Curator** — proposes updates to the system's background knowledge based on what was learned

---

## Starting a Workflow

### Step 1 — Launch an initiative

The normal path: pick a roadmap item synced from Airtable (via **Sync Airtable** in the header) and click **Launch →** on its card. It already carries a complete brief.

If the work isn't in Airtable yet, click **New Initiative** to describe it ad hoc:
- **Who it's for** — target user or customer segment
- **The core problem** — what's broken or missing today
- **Key outcomes** — measurable success criteria
- **Scope** — MVP or full product, what's in/out
- **Constraints** — technical, regulatory, budget, timeline

### Step 2 — Answer clarifying questions (rare)

Before asking anything, the Chief of Staff reads your project context files (Company Overview, Strategy, Current State) so it already knows your company, product, and tech landscape. For a complete Airtable brief, it almost always proceeds immediately. It only asks questions to fill gaps on the four criteria above, and only when the brief genuinely lacks one — maximum 2 questions per message, maximum 3 rounds.

### Step 3 — Choose your stages

Before the workflow launches, you'll see toggle buttons for each stage: **Analyst**, **PM**, **Architect**, **Epic & Features**, **Story Decomposition**, **Prototype**, **Figma**, **Curator**.

- Click a stage to toggle it off (shown as grey with strikethrough)
- At least one stage must remain enabled
- Useful when you already have research and just need a backlog, for example
- **Check your team's policy** — some departments require certain stages (e.g. Architecture, Prototype, Figma Design) to always stay on even though the system allows toggling them off. See your team's policies & procedures document if one exists.

### Step 4 — Watch the pipeline run

The left pane shows the stage list with a progress bar; the right pane shows a live event log. Each stage runs autonomously, then pauses for your review.

---

## Writing a Good Goal Statement

If you're using the ad hoc **New Initiative** form rather than a pre-filled Airtable brief, the quality of your description directly affects everything the pipeline produces.

**Too vague:**
> Improve onboarding

**Better:**
> Redesign the onboarding flow for enterprise customers

**Best:**
> Redesign the onboarding flow for enterprise customers who purchase via our sales team. The current flow assumes self-serve signup and fails for accounts that need SSO, multi-team provisioning, and admin-first setup. We want to cut time-to-first-value from 14 days to under 5. Budget: $80k, target launch in 8 weeks.

The more constraints and context you include, the fewer (if any) clarifying-question rounds you'll need.

**If your context files are filled in:** You don't need to repeat company or product background — the agents already know it from the Context Editor files. Focus on what's new or different about this initiative.

---

## The Pipeline Terminal View

When a workflow is active, the main view switches to a split-pane layout:

| Pane | Shows |
|------|-------|
| Left | Stage list, progress bar, completion status, per-stage cost |
| Right | Live event log grouped by stage — agent progress, critic reviews, and checkpoints with inline approve/revise/reject actions |

Clicking a completed stage's artifact opens it for review in the Artifact Viewer.

---

## Checkpoints

Every specialist stage pauses for your review. Nothing moves forward without approval — the system waits indefinitely.

### Approve
The output meets your standard. The workflow moves to the next stage automatically.

### Revise
You want changes before moving on. Type your feedback — be specific. The stage reruns with your corrections (the Critic is skipped for a human-initiated revision — you are now the reviewer).

**Good revision feedback:**
> Three changes: (1) Remove the consumer app competitor section — not relevant. (2) Add a section on enterprise SSO integration patterns for SAML 2.0. (3) The time-to-value metric should reflect admin setup time, not end-user first login.

**Weak revision feedback:**
> Make it better.

### Reject
The workflow ends. Use this if the direction is fundamentally wrong and you want to start over.

### Dual checkpoints for story decomposition

Each feature's Story Decomposition round (`story_decomposition_F1`, `F2`, `F3`...) produces **two independent checkpoints**: a **Stories** checkpoint and a **QA Tests** checkpoint. Both must be approved before the workflow advances to the next feature. If one side requests changes after the other already approved, the approved side is automatically invalidated and both artifacts regenerate together — so a partial approval never goes stale against regenerated work.

### Role-gated approval

Depending on how your admin has configured **Settings → Access → Stage Roles**, a checkpoint may require a specific role (e.g. only `qa` can approve a QA Tests checkpoint, only `product` can approve a Stories checkpoint). If you can't see an approve action on a checkpoint, you likely don't hold the required role for that stage.

---

## Quality Review (Critic)

The Critic runs automatically after each specialist stage — you don't interact with it directly. It checks the output and either:

- **Passes** — no issues found, the checkpoint is created for your review
- **Auto-revises** — issues found, the specialist reruns with the feedback (up to 2 times)
- **Escalates** — after 2 revision attempts, pauses for your input with the issues listed

The Critic applies stage-specific checks tailored to each artifact type — Research Briefs on market coverage and evidence quality, PRDs on problem framing and requirement completeness, Architecture Documents on technical soundness and stack alignment, and Stories on granularity and testability.

---

## Context Updates (Curator & Context Keeper)

After the workflow completes, the **Context Curator** reviews everything produced and proposes updates to the project's context files — the background documents every AI agent reads. If changes are proposed, an amber badge appears in the header. Open it to review each proposed diff (file, addition/update/removal, proposed text, rationale) and approve or reject individually. Approved changes take effect immediately for all future workflows.

Separately, the **Context Keeper** can be triggered on demand from Knowledge Studio's **Airtable Sync** panel — it checks Airtable initiative statuses against the last-seen snapshot and proposes context updates for material transitions (e.g. an initiative moving to Shipped).

**Why this matters:** Accurate context files mean every future workflow starts with better-grounded agents. You spend less time re-explaining your product, team, and strategy.

---

## Redoing a Stage

After a workflow completes, you can revisit any stage:

1. Click **Redo from [Stage]** at the bottom of the conversation
2. Explain what changed or what needs to be different
3. That stage and all downstream stages rerun with your feedback

---

## Sprint Estimation

The backlog automatically calculates sprint estimates using your team's velocity and capacity factor (configured in the in-app **Settings** panel):
- **Epic level** — total story points divided by effective velocity
- **Feature level** — per-feature sprint estimates shown in the backlog preview
- **AI-assisted estimates** — when AI-assisted development is enabled in Settings, shows AI vs. traditional hour comparisons

---

## Knowledge Studio

Click **Knowledge Studio** in the header for everything that shapes agent behaviour and project documentation:

| Section | What it's for |
|---|---|
| Context | Edit `context/*.md` files directly. Changes take effect on the next agent request — no restart needed. Includes the Airtable Sync panel (Context Keeper, above) |
| Behaviour Docs | `.feature` files describing how existing functionality works today — surfaced only to the PRD stage |
| Agents | Edit a persona's prompt, output template, and registered validators, with version history per file |
| Tools | Review the structural validators each stage calls before returning output |
| Documentation Review | Independent of the product pipeline — AI-assisted review of Markdown docs in tracked Azure DevOps repos. See the root [README.md](../../README.md#documentation-review) for the full flow |

Saves to agent templates require double-confirmation since changes affect all future outputs.

---

## Workflow Cost

The estimated cost of the current workflow is shown in the header (e.g. `$0.12`). This tracks all specialist, critic, and curator token usage for the workflow.

---

## Choosing a Model

The model dropdown in the header controls which AI model runs your requests. Your choice persists across sessions.

- **Faster and cheaper (Haiku):** good for iteration and testing
- **More capable (Sonnet/Opus):** better for production-quality PRDs, architecture docs, and stories

---

## Returning to a Workflow

If you close the app mid-workflow, your progress is saved automatically. When you reopen, it restores exactly where you were — same stage, same checkpoint.

---

## Policies

Policies control how autonomously the pipeline operates. Set once, applies to all workflows.

| Policy | Default | Effect |
|--------|---------|--------|
| `require_critic_review` | On | Off = skip quality review after each specialist |
| `auto_approve_critic` | Off | On = auto-approve when critic passes (no human gate) |

Policies are stored in the database — there's no UI for editing them yet. Contact your developer to adjust them.

---

## Tips

- **Start with a specific goal, not a category.** "Improve search" starts agents in the wrong place. "Users can't find products by attribute combination — we need faceted search with real-time filtering" starts them in the right place.
- **The first checkpoint is worth your time.** Five minutes reviewing scope saves hours of rework downstream.
- **Context files matter.** The more accurate your project knowledge, the less you re-explain in every workflow.
- **Use stage toggles deliberately.** Skip research when you already have it; skip architecture for a trivial change — but check your team's policy first, since some stages may be required regardless of what the toggle allows.

---

## Troubleshooting

**The Coordinator keeps asking questions instead of launching.**
It launches as soon as it can answer four criteria: problem, target user, scope boundary, and constraints. If it keeps asking, your goal likely lacks scope specificity or a named user segment — add a sentence addressing what's in scope and who it's for. If your context files are filled in, a brief reference to them (e.g. "building on our current tech stack") helps it confirm rather than re-ask.

**An agent produces output about the wrong topic.**
The context files may describe a different product than what you're building. Update them via Knowledge Studio → Context.

**My workflow is stuck at a checkpoint.**
The system waits indefinitely. Open the checkpoint and approve, revise, or reject. If you can't see an approve action, you may not hold the role required for that checkpoint — check with an Admin.

**The cost seems high.**
Switch to a cheaper model (Haiku) for iteration, then use a more capable model for the final run. Prompt caching reduces cost significantly on repeated requests within a session.

**A completed stage has wrong content.**
Use "Revise with feedback" at the current checkpoint, or after the workflow completes, use "Redo from [Stage]" to rerun it.
