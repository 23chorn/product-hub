# Workflow Mode — User Guide for Product Managers

This guide explains how to use the Product Automation Pipeline to take a product idea from raw goal to a structured backlog using the Coordinator-driven workflow. No technical knowledge required.

---

## What is Workflow Mode?

Workflow Mode is the primary way to use this tool. You describe a product goal in plain language, and the system automatically routes it through a sequence of AI specialist agents — researcher, product manager, backlog writer, and critic — each handing off to the next. You review and approve the output at each step before the pipeline moves on.

Think of it as having a small product team that works in sequence, with you as the decision-maker who signs off at each stage.

---

## Starting a Workflow

### Step 1 — Select an initiative

From the left panel, click on the initiative you want to run a workflow for. If you haven't created one yet, use the **+ New Initiative** button and give it a name.

[SCREENSHOT: Left panel showing initiative list with one item selected]

### Step 2 — Write your goal

In the centre panel, you'll see a text box labelled **Workflow Goal**. Type what you want to achieve and click **Start Workflow**.

[SCREENSHOT: Goal text area with example goal and Start Workflow button]

The Coordinator will briefly analyse your goal and decide which stages are needed (you'll see its reasoning stream in real time). The workflow then begins automatically.

---

## Writing a Good Goal Statement

The quality of your goal statement directly affects the quality of everything the pipeline produces. Here's how to get it right.

### Vague (avoid)
> "Make a chatbot."

This gives the agents nothing to work with. They'll make assumptions you won't agree with, and you'll spend more time revising checkpoints.

### Good
> "Build a WhatsApp-based chatbot that lets users create a profile and receive personalised product recommendations."

Clear enough to get started. The agents can infer the user, the channel, and the core feature.

### Great
> "Build a WhatsApp-based chatbot targeting small business owners in emerging markets who lack reliable internet access. Users should be able to create a profile, browse a product catalogue by category, and receive personalised recommendations based on their purchase history. The MVP should work on 2G connections and not require a smartphone app."

The more constraints, context, and user clarity you include, the less revision you'll do at checkpoints. Include: **who the user is**, **what channel or context they're in**, **what they need to accomplish**, and **any hard constraints** (technical, regulatory, scope).

---

## The Workflow Stages

Once started, the workflow runs through up to five stages. You don't need to do anything until a stage completes and a checkpoint appears.

| Stage | What it produces |
|-------|-----------------|
| **Analyst** | A research brief: problem space, constraints, market patterns |
| **PM — PRD** | A Product Requirements Document with user personas, journeys, and functional requirements |
| **PM — Backlog** | A structured JSON backlog of epics, features, and user stories |
| **Critic** | An automated adversarial review of the artifacts produced so far |
| **Curator** | Automatic updates to the project context files based on what was learned |

The Coordinator decides which stages are needed based on your goal. For a simple feature with clear scope, it may skip the Analyst stage.

[SCREENSHOT: Left panel showing stage tracker with stages in different states: complete, in-progress, at-checkpoint]

---

## Reviewing a Checkpoint

When a stage completes, the workflow pauses and a **Checkpoint** panel appears on the right side of the screen. This is your review moment.

[SCREENSHOT: CheckpointPanel with Approve / Revise / Reject buttons]

You have three options:

### Approve
The output meets your standard. The workflow moves to the next stage automatically.

**When to approve:** The artifact covers the right scope, reflects your intent, and you're comfortable moving forward.

### Revise
You want changes before moving on. A text box appears where you type your feedback. The system will incorporate your feedback and re-run the stage — you'll get a new output to review.

**When to revise:** Something is missing, wrong, or off-scope. Be specific.

**Good revision feedback:**
> "The PRD is missing a section on offline functionality. The app must work on 2G and this constraint isn't mentioned anywhere in the functional requirements."

**Weak revision feedback:**
> "Make it better."

The agents can only act on specific, actionable instructions. Vague feedback produces vague revisions.

### Reject
The workflow ends here. Use this if the direction is fundamentally wrong and you want to start over with a new goal statement.

---

## The Critic Review

The Critic stage is automatic — you don't interact with it while it runs. When it completes, it presents a verdict in the checkpoint panel:

- **approve** — the Critic found no blockers; you can proceed
- **revise** — the Critic found issues that should be addressed before shipping

The panel shows:
- The overall verdict with a colour indicator (green = approve, red = revise)
- The number of critical, major, and minor issues found
- Key questions the Critic is raising for you to consider

**You still decide.** The Critic's verdict is advisory. If it recommends revise but you disagree, you can approve anyway. If it recommends approve but you've spotted something yourself, you can still revise.

[SCREENSHOT: CheckpointPanel showing Critic verdict banner with issue counts and questions]

---

## Context Diffs — What the Curator Does

After the workflow completes, the **Curator** agent reviews everything that was produced and identifies facts that should be recorded in the project's context files. These are the background documents that every AI agent reads before every conversation — things like company overview, strategy, and technical constraints.

If the Curator proposes changes, an amber badge appears in the Coordinator panel header showing how many changes are pending.

[SCREENSHOT: CoordinatorChat header with amber "2 context diffs pending" badge]

Click the badge to open the **Context Diff Review** panel. Each proposed change shows:
- The file being changed (`company.md`, `strategy.md`, etc.)
- Whether the change is an addition, update, or removal
- The proposed new text
- The Curator's rationale for the change

You can **Approve** individual changes, **Reject** ones you disagree with, or use **Approve All** to accept everything at once.

[SCREENSHOT: ContextDiffPanel with a list of diffs and approve/reject buttons]

**Why this matters:** Context files are injected into every agent's system prompt. Keeping them accurate means every future workflow starts with better-grounded agents. Approving a diff about your target market, for example, means every future PRD will reflect that market without you having to mention it in the goal.

---

## Returning to a Workflow

If you close the app or navigate away mid-workflow, your progress is saved automatically. When you reopen the app, it will restore exactly where you were — the same stage, the same checkpoint waiting for your decision.

To intentionally abandon a workflow and start fresh, click **New workflow** in the Coordinator panel header. This clears the current workflow permanently.

---

## Policy Configuration

Policies let you configure how autonomously the pipeline operates. They apply to all workflows globally until changed.

Policies are set in the database and currently require a developer to configure. The following policies are available:

| Policy key | Values | Effect |
|-----------|--------|--------|
| `require_critic_review` | `"true"` / `"false"` | `"false"` removes the Critic stage entirely from all new workflows |
| `auto_approve_analyst_output` | `"true"` / `"false"` | `"true"` skips the human checkpoint after the Analyst stage |
| `auto_approve_pm_prd_output` | `"true"` / `"false"` | `"true"` skips the human checkpoint after the PRD stage |
| `auto_approve_pm_backlog_output` | `"true"` / `"false"` | `"true"` skips the human checkpoint after the Backlog stage |

**Recommended defaults for most PMs:** Leave all policies at their defaults (critic enabled, all checkpoints requiring human approval). Auto-approve is useful only when you trust the output quality and want to run the pipeline unattended.

---

## FAQ

**Q: The Coordinator's stage analysis is streaming — do I need to wait for it to finish?**
Yes. The workflow doesn't start until the streaming completes and the first stage begins. This usually takes 5–15 seconds.

**Q: Can I run a workflow without an initiative selected?**
No. You must select an initiative from the left panel first. The workflow needs an item to attach to.

**Q: What model is being used?**
The model shown in the header dropdown is used for all agents in the workflow. You can change it before starting a workflow; changing it mid-workflow has no effect on the current stage already running.

**Q: The Critic gave a "revise" verdict but I think the output is fine. Can I approve anyway?**
Yes. The Critic's verdict is advice, not a block. Approve if you disagree.

**Q: How many revision cycles can I do on one stage?**
Unlimited. Each revision re-runs the stage and presents a new checkpoint. In practice, 2–3 revisions is typical before the output is ready.

**Q: The workflow completed but nothing happened. Where are the outputs?**
Outputs are saved to `data/sessions/{initiative-id}/{mode}/artifacts/` on the server's file system. Ask your developer to point you to the right folder, or check the conversation log for the artifact path.

**Q: What does "context diffs pending" mean if I didn't change any context files?**
The Curator proposed changes automatically based on what the workflow produced. You haven't applied them yet — they're waiting for your approval in the diff review panel. You can safely ignore them if you don't want to update the context files.

**Q: Can I run multiple workflows for the same initiative?**
Yes, but only one can be active at a time. Complete or abandon the current workflow before starting a new one.
