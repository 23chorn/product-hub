# Product — Policies & Procedures

## Document Control

| Field | Value |
|---|---|
| Department / Team | `Product` |
| Document Owner | `Chris Horn` |
| Effective Date | `22/06/26` |
| Review Cadence | `every 3 months` |
| Last Reviewed | `22/06/26` |

---

## 1. Purpose & Scope

This document defines how `Product` plans, specifies, reviews, and hands off product work, and who is accountable at each step. It covers every activity performed using Product Hub - from initiative intake through to engineering handoff and documentation governance - plus the activities your team performs outside the system that this document needs to name explicitly (decision-making that happens in meetings, escalation, prioritization debate, etc.).

It is written so that:
- A new joiner can read it and understand what happens, in what order, and who is responsible, without needing to ask a colleague.
- An auditor or new manager can identify the controls in place and confirm they are being followed.
- Anyone with reasonable product/QA domain knowledge can execute any procedure in Section 6 unassisted.

**Out of scope:** engineering implementation practices once work lands in Azure DevOps (covered by `Engineering`).

---

## 2. Definitions & Glossary

### System roles (AI specialist agents)

Product Hub's pipeline is run by named AI agents, each producing one artifact type. A human is accountable for every artifact an agent produces — the agent drafts, a human approves.

| Agent (persona) | Produces | Accountable human role |
|---|---|---|
| Coordinator (Chief of Staff) | Confirms the initiative brief is complete; briefs every other agent | `Product` |
| Analyst (Sage) | Research Brief — market/domain research, risks | `Product` |
| PM Strategy (Rex) | PRD — personas, journeys, requirements | `Product` |
| Epic Feature Planner (Apex) | Epic + high-level Features; creates ADO shells | `Product` |
| Story team — Product (Shard) | User stories with acceptance criteria, per feature | `Product` |
| Story team — QA Engineer (Vera) | Test cases per story (embedded in the story) | `QA` |
| Story team — Backend (Finn) / iOS (Remi) / Android (Cole) | Platform-specific technical acceptance criteria | `Engineering` |
| Architect (Atlas) | Solution Architecture Document | `Engineering` |
| Prototype Builder (Nova) — *mandatory by policy, see §4.3* | Low-fidelity interactive wireframe | `Design` |
| Figma Designer (Luma) — *mandatory by policy, see §4.3* | Design brief for a human designer | `Design` |
| Discovery Scout | Evidence-backed opportunity drafts (outside the staged pipeline) | `Product` |
| Doc Reviewer (Cass) | Comments on documentation (never edits) | `Markdown Committee` |
| Critic (Flint) | Automated quality review after every specialist stage | — (no human owner; system control, see §5) |
| Context Curator (Ivy) | Proposed updates to project knowledge files | `Product` |
| Context Keeper | Proposed knowledge-file updates triggered by an Airtable status change | `Product` |

### Human/system roles (access control)

These are the actual roles the system enforces. They are assigned per user in **Settings → Access → Users** by an Admin. **Treat that screen, not this table, as the current source of truth for who holds which role.**

| Role | What it grants today |
|---|---|
| Admin (`is_admin`) | Everything below, plus user management and the Knowledge Repos settings (which ADO repos Documentation Review tracks) |
| `product` | Launch new workflows, run/promote Discovery opportunities, approve stages mapped to `product` in Stage Roles |
| `qa` | Approve stages mapped to `qa` in Stage Roles (by default, the QA Tests side of story decomposition) |
| `tech_lead` | Approve stages mapped to `tech_lead` in Stage Roles |
| `design` | Approve stages mapped to `design` in Stage Roles |
| `management` | Read-only — Stats Dashboard only |
| `view_only` | Hard-deny marker. Overrides every other role on the same user: no approvals, no edits, no comments, no sync, no new initiatives. Read access only |

### Other terms

| Term | Meaning |
|---|---|
| Initiative | The top-level unit of work — usually a roadmap item synced from Airtable |
| Workflow | One run of the pipeline against an initiative; tracks status, current stage, and cost |
| Stage | One step of the pipeline (e.g. `pm_prd`, `story_decomposition_F1`) |
| Checkpoint | The pause point after a stage completes, where a human must approve/revise/reject |
| Feature (F1, F2, F3...) | A high-level feature produced by the Epic Feature Planner; each gets its own story decomposition round |
| Artifact | The saved output of a stage (research brief, PRD, backlog JSON, etc.), stored on disk with a SQLite pointer row |

---

## 3. Roles & Responsibilities

### 3.1 RACI by activity


| Activity | Responsible (drafts) | Accountable (approves) | Consulted | Informed |
|---|---|---|---|---|
| Initiative intake & prioritization | `Product` | `Product` | `Management` | `Management` |
| Research | Analyst (Sage) | `Product` | `Design` | `Management` |
| PRD | PM Strategy (Rex) | `Product` | `Design` | `Management` |
| Architecture | Architect (Atlas) | `Engineering` | `Product` | `Management` |
| Epic/Feature planning | Epic Planner (Apex) | `Product` | `Engineering` | `QA` |
| Story decomposition — Stories | Story team (Shard + platform engineers) | `Product` | `Engineering, QA` | `N/A` |
| Story decomposition — QA Tests | Story team (Vera) | `QA` | `Product` | `Engineering` |
| Engineering handoff (ADO push) | System (automatic on Stories approval) | n/a — system action | `Product` | Engineering |
| Prototype | Prototype Builder (Nova) | `Design` | `Product` | `QA, Engineering` |
| Figma Design | Figma Designer (Luma) | `Design` | `Product` | `QA, Engineering` |
| Discovery (opportunity sourcing) | Discovery Scout | `Product` | `Design` | `Management` |
| Change requests | Coordinator (impact assessment) | `Product` | `Engineering, QA` | `N/A` |
| Documentation review | Doc Reviewer (Cass) | `Markdown Committee` | `Engineering` | `Product` |

---

## 4. End-to-End Process Flows

### 4.1 Intake & Prioritization

1. The initiative is entered/synced in Airtable with: Initiative name, Description, Status, Business Value, Priority Score, Estimate, Target Window, and (optionally) Product Area, Strategic Theme, Affected Stakeholders. **The Description field must already contain the full brief** — problem, target user, scope boundary, and hard constraints — because the system does not have a structured intake form that forces this; it relies on the brief being complete on entry.
2. An Admin clicks **Sync Airtable** in Product Hub to pull new/changed items in.
3. The initiative appears on the Home screen as a card.

### 4.2 Core Pipeline (Research → Engineering Handoff)

1. **Launch** — an authorized user (`product` role or Admin) clicks **Launch →** on the initiative card.
2. **Brief confirmation** — the Coordinator checks the brief against four criteria (problem, user, scope boundary, hard constraints). If the Airtable description already covers all four — the normal case for a controlled intake process — it proceeds immediately with no questions asked. It only asks (max 2 questions per message, up to 3 rounds) when something is genuinely missing.
3. **Stage selection** — the system allows individual stages to be toggled off before launch. **Department policy: Architecture, Prototype, and Figma Design must always remain enabled.** Do not toggle them off, even though the launch screen permits it — see §4.3.
4. **Specialist stages run autonomously, in order**, each producing one artifact, each reviewed inline by the Critic before the human checkpoint (see §5):

   | Stage | Produces | ADO effect |
   |---|---|---|
   | Research | Research Brief | — |
   | PRD | Product Requirements Document | — |
   | Architecture (Atlas) | Solution Architecture Document | — |
   | Epic Feature Planner | Epic + Features (high-level) | Creates epic + feature shells in ADO |
   | Story Decomposition (per feature, F1/F2/F3...) | Stories with acceptance criteria, platform tags, and embedded test cases | Adds stories to the ADO feature; creates/extends the ADO Test Plan |
   | Prototype (Nova) | Low-fi wireframe of the affected screens | — |
   | Figma Design (Luma) | Design brief for a human designer | — |
   | Context Update | Proposed edits to `context/*.md` | — |

5. **Dual checkpoint per feature** — each story decomposition round produces *two* independent checkpoints: a **Stories** checkpoint and a **QA Tests** checkpoint. Both must be approved before the next feature starts. If one side requests revisions after the other already approved, the approved side is invalidated automatically and both regenerate together.
6. **Human review at every checkpoint** — approve, revise with feedback, or reject (see §5).
7. **Handoff** — once a feature's Stories checkpoint is approved, its stories and test cases are pushed to Azure DevOps with full story↔test-case linkage. Two links are surfaced to the reviewer: the Feature board and the Test Plan.
8. **Context Curator runs at the end** — proposes updates to `context/*.md` based on what was learned. A human must approve each proposed diff before it takes effect for future workflows.

### 4.3 Discovery Mode (opportunity sourcing)

A separate, lightweight flow outside the staged pipeline — no checkpoints, no Critic.

1. Source documents (interviews, app store/Play store reviews, competitor notes) are added.
2. An authorized user (Product/Admin) selects sources and runs Discovery. The Scout reviews them against a snapshot of the current backlog (to avoid re-pitching in-flight work) and drafts evidence-backed opportunities.
3. Each opportunity is reviewed and either **dismissed** or **promoted**. Promotion creates an Airtable record and a local item, which then enters the normal intake flow (§4.1).

### 4.4 Change Request Management

After a workflow completes, a change can be requested without restarting the whole pipeline:

1. The requester selects a change type: Correction, Scope, Direction, Constraint, Stakeholder, or Technical.
2. The Coordinator assesses impact and names which stages would be affected.
3. The requester confirms which stages to re-run — only those stages execute.

### 4.5 Documentation Governance (Knowledge Studio → Documentation Review)

For Markdown documentation living in tracked Azure DevOps repos — independent of the product pipeline above.

1. An Admin tracks a repo in **Settings → Knowledge Repos**.
2. Every `.md` file in the repo is synced and listed, grouped by repo and filterable by owner/status. Files must carry a `file-name:`/`owner:`/`status:` frontmatter block to be considered valid; files without it are flagged.
3. The Doc Reviewer (Cass) agent reviews a file against the standing committee guidelines (`context/doc-review-guidelines.md`) and posts up to 8 `minor`/`major` comments. Cass never edits or rewrites — only the file's named human owner does.
4. Any user who isn't `view_only` can add comments and resolve any comment (human or AI).
5. A History tab shows live commit history and diffs pulled directly from Azure DevOps.

### 4.6 Context & Knowledge Maintenance

Two automatic mechanisms keep agent background knowledge current — both require human approval before taking effect:

- **Context Curator** — runs at the end of every workflow, proposes updates to `context/*.md` based on what was learned.
- **Context Keeper** — runs on request from the Airtable Sync panel, proposes updates when an initiative's Airtable status changes materially (e.g. moves to Shipped).

---

## 5. Key Controls & Approval Requirements

The first row below is a **department policy control** — the system does not enforce it; it relies on the launching user following §4.3. Everything after it is enforced by the system today, not by convention:

| Control | How it works |
|---|---|
| **Architecture, Prototype, and Figma Design are mandatory** | Department policy, not a system rule — the launch screen still lets any of the three be toggled off. The launching user is responsible for leaving them on for every initiative (see §4.3). |
| **Mandatory checkpoint per stage** | Every specialist stage pauses for human review before the next stage starts. The system waits indefinitely — there is no timeout or auto-advance. |
| **Three checkpoint outcomes only** | Approve (advance), Revise (feedback → stage reruns, Critic is skipped — the human is now the reviewer), Reject (workflow ends). |
| **Inline Critic review** | After every specialist stage and before the human checkpoint, the Critic (Flint) reviews the artifact against stage-specific rules. On finding issues it triggers up to 1 automatic revision before the human ever sees it; only if it's still failing does it escalate to the human with the issues listed. |
| **Independent dual checkpoints** | Story decomposition's Stories and QA Tests checkpoints are approved independently, but a late revision on one side invalidates and regenerates the other — partial approvals can't go stale against regenerated work. |
| **Role-gated approval** | Each checkpoint stage can require one or more roles to approve, configured in **Settings → Access → Stage Roles**. Check that screen for the current mapping — it is admin-editable and intentionally not hardcoded into policy. |
| **`view_only` hard-deny** | Overrides every other role the same user holds. No approvals, no edits, no comments, no sync, regardless of any other role assignment. |
| **Full audit trail** | Every checkpoint resolution (approve/reject/revise) is logged with the resolving user, timestamp, and notes. Pull this for any audit of who approved what. |
| **Change request impact gate** | A change request cannot silently re-run the whole pipeline — the Coordinator must name affected stages and the requester must confirm before anything re-runs. |
| **Documentation review is read-only-against-source** | Cass posts comments only; it cannot edit a tracked file or push a rewrite. All edits are made by the file's human owner. |
| **Governance policies** | `require_critic_review` (default on) and `auto_approve_critic` (default off, meaning a passing Critic review still waits for a human) are global toggles, not per-stage. |

---

## 6. Procedures — Quick Reference

**Launch an initiative**
1. Confirm the Airtable record has a complete brief (problem, user, scope, constraints) in Description.
2. Click **Sync Airtable** (Admin) if the item isn't showing yet.
3. Click **Launch →** on the card.
4. Confirm the stage toggles — **Architecture, Prototype, and Figma Design must stay enabled** (department policy, §4.3) even though the screen allows turning them off — then start.

**Review and resolve a checkpoint**
1. Open the pending checkpoint from the Pipeline Terminal View or your notification.
2. Read the artifact in the Artifact Viewer.
3. Approve, or Revise with specific, numbered feedback, or Reject with a reason.

**Request a change after completion**
1. Open the completed workflow, click **Change Request**.
2. Select the change type and describe it.
3. Review the Coordinator's impact assessment and confirm which stages re-run.

**Run Discovery on new source material**
1. Add the source documents (interviews/reviews/competitor notes).
2. Select sources, click **Run Discovery**.
3. Review each opportunity's rationale and evidence; dismiss or promote.

**Review documentation**
1. Open **Knowledge Studio → Documentation Review**.
2. Select a file; check it has valid frontmatter.
3. Run Cass for AI suggestions, or add your own comment.
4. Resolve comments once addressed.

**Onboard a new team member** 
1. Admin creates the user in **Settings → Access → Users** and assigns role(s).

---

## 7. Metrics, Audit & Continuous Improvement

- **Stats Dashboard** (Admin and `management` roles) — cycle time, first-time-approval rate, throughput, and bottlenecks across workflows, over a configurable date range.
- **Checkpoint audit log** — every approval/rejection/revision, with resolving user and notes, for any compliance audit.
- **Per-workflow cost tracking** — cumulative AI cost is tracked per workflow and shown in the UI.
