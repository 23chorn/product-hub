# Product & QA Department Policies & Procedures

## Document Control

| Field | Value |
|---|---|
| Department | Product & QA |
| Document Owner | `Chris Horn` |
| Effective Date | `22/06/26` |
| Last Reviewed | `22/06/26` |

---

## 1. Purpose & Scope

This document defines how the Product & QA department at xCube operates: who is responsible for what, how work moves from idea to shipped feature, what must be reviewed and approved before it ships, and how a new joiner gets productive without having to ask around. It covers every activity the department performs: discovery, definition, build readiness, testing, release, and post-release review, regardless of which tool carries out a given step.

**In scope:** product management, QA, and design activities for xCube's mobile (iOS/Android), web, and B2B white-label/API product lines.
**Out of scope:** engineering implementation practices (owned by Engineering), and the xCube Flow system-specific controls, which are documented separately so this document doesn't need to change every time that tool's UI changes.

---

## 2. Department Context

xCube's mission is to be the global access point to Middle East markets, with a focus on UAE and GCC nations, bringing developed-market trading features to the region plus region-specific innovation (e.g. Shariah-compliant investing). The product surface area the department covers:

- **iOS/Android mobile app**: the primary product and channel
- **Web app**: secondary, recently released
- **Internal & external desktop trading application**
- **B2B white-label app and API-as-a-product**: licensed to financial institutions, fintechs, and regional brokers

**Constraints that shape every process below:**
- iOS and Android must ship simultaneously: no platform-first releases
- All trading flows must support English and Arabic, with copy and design reviewed by a native Arabic speaker before release
- SCA (Securities and Commodities Authority) regulatory compliance applies to trading-related features

---

## 3. Roles & Responsibilities

### 3.1 Department roster

| Role | Headcount | Primary responsibilities |
|---|---|---|
| Product Manager | 1 | Prioritization, story writing, stakeholder alignment, roadmap ownership |
| QA | 2 (dedicated) | Test design and execution; QA owns testing, PM owns final sign-off on output |
| Design | 1 | UI/UX mockups, design system maintenance; supports Product work |
| Engineering | 6 (2 mobile: iOS/Android; 3 backend; 1 web) | Implementation, code review, on-call |

### 3.2 Product Manager responsibilities

- Owns the roadmap and prioritization decisions, balancing strategic themes against day-to-day requests (Customer Success escalations, compliance asks, technical debt).
- Runs discovery: synthesizes user feedback, app store/Play store reviews, competitor moves, and stakeholder requests into roadmap candidates.
- Defines requirements: problem statement, target user, scope boundary, and hard constraints for every initiative, whether written by hand or drafted through xCube Flow.
- Owns the final sign-off on test output even though QA executes testing; see §3.3.
- Runs stakeholder communication: weekly refinement, Friday demo, and ad hoc updates to leadership/Customer Success on roadmap status.
- Owns post-launch review: confirming the shipped feature met its defined outcomes, and feeding learnings back into discovery.

### 3.3 QA responsibilities

- Owns test strategy and test case design for each feature, beyond what xCube Flow's QA Engineer agent (Vera) drafts automatically. Manual exploratory testing, regression suites, and platform-specific edge cases are QA's responsibility on top of the AI-drafted happy/bad/edge-case test cases embedded in each story.
- Executes test cases per release and tracks defects to closure.
- Owns regression testing ahead of every release, given the simultaneous iOS/Android constraint: a regression on one platform blocks both.
- Approves the QA Tests checkpoint for AI-drafted test cases when running initiatives through xCube Flow (see the system-specific document, §5).
- **Final accountability for testing rests with QA; final accountability for the released *output* rests with the PM.** These are deliberately separate to avoid testing being rushed under feature-delivery pressure.

### 3.4 Designer responsibilities

- Owns the design system and its components in Figma: the same reference xCube Flow's Figma Design stage (Luma) checks against for gaps before drafting a brief.
- Produces UI/UX mockups for every user-facing initiative, building from the PRD, prototype, and Figma Design brief where the AI-assisted pipeline is used.
- Builds the actual Figma screens that Luma's design brief identifies as needed. Luma drafts the brief (which screens, what each shows, what's missing); the Designer builds the pixels. There is no automated handoff of visuals, only of requirements.
- Owns (or routes to whoever performs) the native-Arabic-speaker review of trading-flow copy and layout before release (§2 constraint).
- Supports Product work more broadly contributing to discovery framing and reviewing the design-dependency line item in Definition of Ready (§4.3) for any story that needs it.

### 3.5 Cross-functional collaboration

| Partner | What Product, QA & Design need from them | What Product, QA & Design provide them |
|---|---|---|
| Engineering | Feasibility input during definition, implementation, code review | Prioritized, ready-to-build stories with acceptance criteria (Definition of Ready, §4.3); finished design specs |
| Compliance/Legal | Sign-off on trading-flow and KYC-adjacent features (SCA) | Early visibility into features that touch regulated flows |
| Customer Success | Customer feedback, escalations, market signal | Roadmap visibility, release notes |
| Strategy partners | Product requirements for managed-strategy features | Implementation timeline and integration requirements |

---

## 4. End-to-End Process Flows

### 4.1 Discovery & Intake

1. Ideas enter from multiple sources: Customer Success escalations, app store/Play store reviews, competitor moves, internal stakeholder requests, and strategic roadmap themes set by leadership.
2. The PM triages: is this in scope (§2 constraints), and does it warrant a roadmap slot?
3. For evidence-backed opportunity surfacing, xCube Flow's **Discovery Mode** can review uploaded source documents (interviews, reviews, competitor notes) and draft opportunity candidates against the current backlog snapshot. This is optional tooling support, not a required step.
4. Accepted ideas are entered into the Airtable roadmap with a complete brief (problem, target user, scope boundary, constraints) and a priority score (Business Value × weighted Estimate, per the existing Airtable formula).

### 4.2 Definition

1. The PM (with Design and Engineering input as needed) launches the initiative through xCube Flow, which runs Research → PRD → Architecture as AI-drafted specialist stages, each reviewed at a human checkpoint.
2. For any feature touching a regulated trading flow, KYC, or fund movement: Compliance is looped in during this stage, not after stories are written.
3. For any feature with a user-facing surface: Design reviews the PRD and prototype output (English and Arabic).
4. Architecture is always produced (department policy; see the system-specific document §4.3) so Engineering has a technical plan before stories are written, not just a feature description.

### 4.3 Build Readiness

A story is ready for the sprint/queue when:
- The business problem or need is described in one or two sentences
- The expected change, flow, or behaviour is outlined, even at a high level
- Acceptance criteria are written as simple, testable statements
- Dependencies (API, design, data, cross-team) are identified
- Design/UX is attached where applicable (Figma link, wireframe, or screenshot)
- Assumptions or limitations are documented
- There are no blocking questions left

When stories are produced via xCube Flow's Story Decomposition stage, the AI-drafted acceptance criteria, platform tags, and embedded test cases are checked against this list at the Stories checkpoint before approval. The checklist doesn't change just because a machine drafted the first pass.

### 4.4 QA & Testing

1. Each story carries AI-drafted test cases (happy path, bad path, edge case) from xCube Flow's Story Decomposition stage, reviewed and approved by QA at the QA Tests checkpoint.
2. QA extends this with manual exploratory testing and platform-specific checks, particularly anything affecting both iOS and Android, since both must ship together.
3. Regression testing runs ahead of every release; a regression on either mobile platform blocks the release for both.
4. Defects are tracked to closure in Azure DevOps, linked to the originating story/test case.

### 4.5 Release Management

A story is done when:
- Functionality meets all acceptance criteria
- Code review is completed and passed
- Unit tests (if applicable) pass and QA has verified the feature against acceptance criteria
- No critical or high-severity bugs remain open
- Documentation/wiki is updated where needed
- The feature has been demoed or communicated to Product/the team

**Cadence:** Kanban, with a weekly 1-hour refinement session, a daily 10am standup (Teams fallback if remote) followed by a team-only retro (45 min).

**Bilingual gate:** trading-flow copy and design changes require sign-off from a native Arabic speaker before release.

### 4.6 Post-Release

1. The PM confirms the shipped feature against its originally defined outcome (from the PRD).
2. Learnings and follow-ups feed back into Discovery (§4.1), including anything the Context Curator/Context Keeper proposed adding to `context/current-state.md` if the initiative ran through xCube Flow.

---

## 5. Key Controls & Approval Requirements

| Control | What it covers |
|---|---|
| Definition of Ready | No story enters the build queue without a clear problem statement, scope, acceptance criteria, dependencies, and (if applicable) design; see §4.3 |
| Definition of Done | No story is closed without passing acceptance criteria, code review, QA verification, and a demo; see §4.5 |
| QA sign-off vs. PM sign-off | Deliberately separate accountabilities: QA verifies the feature works as specified; the PM verifies the output matches the original intent. Neither substitutes for the other |
| Simultaneous iOS/Android release | No platform-first releases for shared features |
| Bilingual review | English/Arabic copy and design sign-off required before release of trading flows |
| Regulatory (SCA) compliance | Required for trading-related features; Compliance is looped in during Definition (§4.2), not at the end |
| Mandatory Architecture/Prototype/Figma stages | When using xCube Flow, these three stages are never skipped; see [the system-specific document, §4.3](policies-and-procedures-template.md#43-mandatory-stages-department-policy-and-discontinued-stages) |
| Checkpoint approvals inside xCube Flow | See [the system-specific document, §5](policies-and-procedures-template.md#5-key-controls--approval-requirements) for the full mechanics (dual Stories/QA checkpoints, audit trail, role gating) |

---

## 6. Tooling Landscape

| Tool | Purpose | Owner |
|---|---|---|
| **xCube Flow** | AI-assisted research, PRD, architecture, story decomposition, and QA test case drafting; pushes backlog to Azure DevOps | Product |
| **Airtable** | Roadmap and prioritization source of truth | Product |
| **Azure DevOps** | Engineering work item tracking, test plans, sprint/board management | Engineering, with Product/QA visibility |
| **Figma** | Design system and screen mockups | Design |
| **Slack/Teams** | Day-to-day communication, escalation | All |

xCube Flow accelerates the Definition stage (§4.2) and the build-readiness drafting (§4.3); it does not replace the human judgment calls in Discovery (§4.1), Release Management (§4.5), or Post-Release review (§4.6).

---

## 7. Procedures: Quick Reference

**Take an idea from intake to a scoped roadmap item**
1. Capture the source (customer feedback, review, competitor note, stakeholder request).
2. Check it against current non-priorities (§2) before investing further time.
3. If credible, add it to Airtable with a complete brief and a Business Value / Estimate / Confidence score.

**Move an initiative from roadmap to build-ready stories**
1. Launch the initiative (via xCube Flow if using the AI-assisted pipeline, or manually).
2. Confirm Research, PRD, and Architecture are produced and approved.
3. Review Stories and QA Tests checkpoints against the Definition of Ready (§4.3).
4. Confirm Prototype and Figma Design briefs exist before the feature enters the engineering queue.

**Run a release**
1. Confirm Definition of Done (§4.5) for every story in the release.
2. Confirm regression testing is complete on both iOS and Android.
3. Confirm bilingual and (if applicable) compliance sign-off.
4. Demo to stakeholders Friday; ship simultaneously to iOS and Android.

**Onboard a new Product, QA, or Design joiner**
1. Add accounts/access needed across xCube Flow, Airtable, Azure DevOps, Figma.
2. Read this document, then product-hub-procedures for the xCube Flow-specific mechanics.
3. Read `context/company.md` and `context/strategy.md` for product/company background.
4. Shadow a refinement session, a checkpoint review, and a release before owning one independently.

---

## 8. Escalation & Exceptions

- Disagreement on roadmap priority: `Product/Management`
- A release-blocking regression found late in the cycle: `Product`
- A request that conflicts with current non-priorities (§2) but a stakeholder insists: `Product`
- Compliance flags a feature late in the cycle: `Product/Management`
- QA and PM disagree on release-readiness: `Product/QA`

---

## 9. Related Documents

- [docs/policies-and-procedures-template.md](policies-and-procedures-template.md): xCube Flow system-specific roles, checkpoints, and controls
