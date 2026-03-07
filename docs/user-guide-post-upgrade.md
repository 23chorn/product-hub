# Product-Agent: User Guide
**Audience:** Product Managers using the app

---

## What Is Product-Agent?

Product-Agent is your AI-powered product ops team. You describe what you're trying to build or solve, and a coordinated set of AI agents research it, write the PRD, break it into a developer-ready backlog, and export structured work items directly into Azure DevOps.

The output is designed to be picked up immediately — by human developers or AI coding agents — without them needing to come back to you for clarification. Every story includes the context they need to get started.

---

## How It Works

You talk to one agent: the **Coordinator** (Chief of Staff). It plans the work, briefs the specialist agents, and brings results back to you at structured checkpoints. You review and approve at each checkpoint before the pipeline moves on.

Behind the scenes, the Coordinator runs:

1. **Analyst (Sage)** — researches your goal, maps the landscape, identifies risks
2. **PM Strategy (Rex)** — frames the problem, writes the PRD, structures epics
3. **Backlog Agent (Pip)** — turns the PRD into stories, tasks, and acceptance criteria
4. **Critic** — adversarially reviews the full output before it reaches you
5. **Context Curator** — proposes updates to the system's background knowledge based on decisions made

You don't choose which agent runs or when. You give the Coordinator a goal and respond at checkpoints.

---

## Starting a Workflow

1. Select an initiative from the left panel (from your Airtable roadmap) — or create a **Quick Session** for ad-hoc work not tied to a roadmap item
2. Select a model from the header dropdown
3. Type your goal in the Coordinator chat and hit send
4. Watch the stage tracker on the left as the pipeline runs

The Coordinator will confirm what it's planning before anything starts — you'll see the proposed stage sequence and can adjust it before the first agent runs.

---

## Writing a Good Goal Statement

The Coordinator uses your goal to plan and brief every agent downstream. Vague goals produce generic output. Specific goals produce specific, actionable work.

**Too vague:**
> Improve onboarding

**Better:**
> Redesign the onboarding flow for enterprise customers

**Best:**
> Redesign the onboarding flow for enterprise customers who purchase via our sales team. The current flow assumes self-serve signup and fails for accounts that need SSO, multi-team provisioning, and admin-first setup. We want to cut time-to-first-value from 14 days to under 5.

The third version tells the Coordinator the customer segment, the root problem, and the success metric. Every agent gets this context — the research is more targeted, the PRD is more specific, and the stories are more actionable.

---

## The Stage Tracker

The left panel shows where the pipeline is at any moment:

| Status | Meaning |
|--------|---------|
| ⬜ Pending | Stage not yet started |
| 🔵 In progress | Agent currently running |
| 🟡 At checkpoint | Waiting for your review |
| ✅ Complete | Approved and done |
| ⏭ Skipped | Bypassed by policy |
| 🔴 Rejected | You rejected the output — workflow stopped |

Clicking a completed stage opens its artifact in the right panel.

---

## Checkpoints

The system pauses at three points for your review. Nothing moves forward without your approval.

### Checkpoint A — Scope Review

**When:** After the Analyst completes research.

**What you see:** A research brief and a proposed Epic structure — the major workstreams the system plans to build out.

**Your options:**
- **Approve** — pipeline continues to the PRD and backlog stages
- **Revise with feedback** — Analyst reruns with your corrections incorporated
- **Reject** — workflow stops

This is the most important checkpoint. Getting scope right here prevents rework in every stage that follows.

---

### Checkpoint B — Rollout & Docs Review

**When:** After the Rollout Planner and Docs Planner complete, running in parallel with the Backlog Agent.

**What you see:** Deployment tasks and documentation tasks proposed for this initiative.

**Your options:** Approve, revise, or remove tasks that don't apply.

This checkpoint can be reached before the Backlog Agent finishes — you can resolve it independently and it won't hold up the pipeline.

---

### Checkpoint C — Full Output Review

**When:** After the Critic has reviewed both the backlog and the rollout plan together.

**What you see:** The complete backlog, rollout plan, and a Critic review summary flagging any issues (severity: critical, major, or minor).

**Your options:**
- **Approve** — triggers the ADO export
- **Revise with feedback** — address Critic findings before exporting

---

## Giving Good Feedback at Checkpoints

The Coordinator takes your feedback, re-briefs the relevant agent, and reruns that stage. Clear, specific feedback produces better revisions.

**Too vague:**
> This doesn't look right

**Better:**
> The research is too focused on B2C patterns. We're building for enterprise IT admins.

**Best:**
> Three changes: (1) Remove the consumer app competitor section — not relevant to us. (2) Add a section on enterprise SSO integration patterns for SAML 2.0. (3) The time-to-value metric should reflect admin setup time, not end-user first login.

Discrete, numbered instructions give the Coordinator something concrete to act on. "Something feels off" does not.

---

## The Export

Once you approve at Checkpoint C, the system creates work items in Azure DevOps:

```
ADO Epic
  └── ADO Feature (your Story)
        └── ADO Task
```

Dependency links between stories are created automatically. You receive:

- A confirmation with links to the created ADO items
- `backlog.json` — full structured data for feeding to AI coding agents
- `backlog.md` — human-readable version with ADO links included

The export is deterministic — no AI involved at this stage. What you approved at Checkpoint C is exactly what gets created in ADO.

---

## Quick Sessions

For ad-hoc work not tied to any roadmap initiative — a one-off ticket, a quick research question, a scratchpad idea.

- Create via the **Quick Session** button in the left panel
- Backlog mode only — no full PRD workflow
- Shows **Quick Tickets** and **Chat** options
- Up to 5 can exist at once
- Deleting a Quick Session removes all its history permanently

Quick Tickets let you describe a feature conversationally and get a structured ticket out the other end without running the full pipeline. Good for tactical requests that come in from developers mid-sprint.

---

## Direct Access Mode

For power users who want to talk to a specific agent directly without the Coordinator managing the flow.

Access via the **Direct Access** toggle in the header. Choose a mode tab (PRD, Backlog, Analyst) and interact with that agent directly.

Use this when:
- You want to iterate quickly on a specific PRD section without re-running research
- You're doing exploratory brainstorming that isn't ready to become a workflow yet
- You need to patch a single story without touching the rest of the backlog

Conversations in Direct Access mode are separate from Workflow Mode sessions and don't feed into the checkpoint pipeline.

**Exporting from Direct Access:** Type `e` in the chat. PRD and Analyst mode capture the last substantial agent response directly. Backlog mode makes an API call to format the full conversation as JSON.

---

## Choosing a Model

The model dropdown in the header controls which AI model runs your requests. Your choice persists across sessions.

**Faster and cheaper (Haiku):** Good for research, brainstorming, and quick tickets.

**More capable (Sonnet / Opus):** Use for PRDs, complex backlogs, and anything where output quality directly affects what developers build.

---

## Configuring the System (Policies)

Policies let you adjust how autonomous the system is. Set once, applies to every workflow unless overridden per session.

| Policy | Default | What it does |
|--------|---------|-------------|
| Auto-approve Analyst output | Off | Skips Checkpoint A — use for well-scoped, low-stakes work |
| Require Critic review | On | Turn off to skip adversarial review and move faster |
| Max stories per Epic | 8 | Prevents the Backlog Agent from over-expanding any single epic |
| Brand tone | "professional, concise" | Injected into all agent briefs |
| Context updates require approval | On | Turn off to let the Curator update context files automatically |

Ask your developer to adjust these in the admin settings panel.

---

## Tips

**Start with a specific goal, not a category.** "Improve search" starts the Analyst in the wrong place. "Users can't find products by attribute combination — we need faceted search with real-time filtering" starts it in the right place.

**Checkpoint A is worth your time.** Five minutes reviewing the scope and epic structure saves hours of rework downstream. If the epics don't match your mental model, say so before the backlog is written.

**Use Quick Tickets for developer requests.** When a developer asks for a ticket on something tactical, don't start a full workflow. Open a Quick Session, use Quick Tickets, describe the feature conversationally, done in two minutes.

**The `agentContext` field in every story is written for AI coding agents.** If your team feeds stories to a coding agent, this field tells it exactly which files, types, and patterns to work with. Don't delete it from the ADO description.

**Context files matter.** Background about your company, product, and strategy is injected into every agent automatically. The more accurate these files are, the less you'll re-explain context in every session. Ask your developer to keep them updated after major decisions.

---

## Troubleshooting

**The Coordinator's plan doesn't match what I expected.**
Give it a more specific goal statement. The Coordinator infers scope from your goal — if the scope is wrong, the goal was ambiguous. You can also adjust the proposed stage sequence before approving it at the start.

**An agent keeps asking for information I've already provided.**
The context files are likely outdated. Ask your developer to update `context/company.md` and `context/strategy.md` with the relevant background.

**The export created ADO items but in the wrong project or area path.**
ADO configuration (org, project, area path) is set server-side. Ask your developer to check the `ADO_ORG_URL` and `ADO_PROJECT` environment variables.

**My workflow is stuck at a checkpoint.**
The system waits indefinitely for your response at checkpoints — nothing times out. Open the checkpoint panel and approve, reject, or revise to continue.

**A completed stage shows content I didn't expect.**
Click the stage in the tracker to open its artifact. If it's wrong, use "Revise with feedback" at the current checkpoint — the Coordinator will re-brief the relevant agent with your correction even if that stage has already completed.

**My session history is missing.**
Sessions persist across page refreshes and server restarts. If history is missing, the database may have been reset. Contact your developer.
