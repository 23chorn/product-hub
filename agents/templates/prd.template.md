<!-- START OUTPUT HERE — no preamble, no introductory text, no commentary. Begin directly with the heading below. -->

# PRD: [Feature / Initiative Name]

**Status:** Draft

---

## Problem Statement

[One paragraph. Who is affected, what is broken today, and why solving it matters now.]

---

## User Personas

**[Persona name]** — [one-line description]
- Goal: [what they want to achieve]
- Pain: [what stops them today]

**[Persona name]** — [one-line description]
- Goal:
- Pain:

---

## Key User Journeys

### Journey 1: [Name]
1. User [action]
2. System [response]
3. User [action]
4. Outcome: [what the user achieves]

### Journey 2: [Name]
1. …

---

## Success Metrics

**Primary metric** — the single number that defines success for this initiative.

| Metric | Baseline | Target | Timeframe | Measurement |
|--------|----------|--------|-----------|-------------|
| [e.g. Activation rate] | [current %] | [goal %] | [e.g. 60 days post-launch] | [e.g. analytics event / DB query / third-party tool] |

**Secondary metrics** — supporting signals that indicate the feature is working as intended.

| Metric | Baseline | Target | Timeframe | Measurement |
|--------|----------|--------|-----------|-------------|
| [e.g. Feature adoption rate] | | | | |
| [e.g. Task completion time] | | | | |

**Counter-metrics** — metrics that must not regress as a result of this work.

| Metric | Current value | Acceptable floor | Measurement |
|--------|--------------|------------------|-------------|
| [e.g. Core funnel conversion] | | [must stay above X] | |
| [e.g. Page load time] | | | |

---

## Non-Functional Requirements

| # | Category | Requirement | Priority |
|---|----------|-------------|----------|
| NFR1 | Performance | [e.g. Page load < 2s at P95 under expected load] | Must / Should / Nice-to-have |
| NFR2 | Scalability | [e.g. Must support X concurrent users without degradation] | |
| NFR3 | Security | [e.g. All user data encrypted at rest and in transit] | |
| NFR4 | Accessibility | [e.g. WCAG 2.1 AA compliance for all new UI surfaces] | |
| NFR5 | Data retention | [e.g. User data retained for X years, deletable on request] | |
| NFR6 | Availability | [e.g. 99.9% uptime, max 4h planned maintenance window/month] | |

Include only categories relevant to this initiative. Remove rows that do not apply.

---

## Functional Requirements

| # | Requirement |
|---|-------------|
| FR1 | The system shall… |
| FR2 | Users can… |
| FR3 | |
| FR4 | |
| FR5 | |

---

## Out of Scope

- [What this version deliberately does not include]
- [Deferred items for a future phase]

---

## Open Questions & Risks

List up to 10 unresolved questions or identified risks. These are items that could not be fully answered during the PRD process and must be tracked. Rank by impact (highest first).

| # | Type | Question / Risk | Impact | Owner | Status |
|---|------|-----------------|--------|-------|--------|
| 1 | Question | [Unanswered question that affects scope or implementation] | High/Med/Low | [Who should answer] | Open |
| 2 | Risk | [Identified risk or assumption that has not been validated] | High/Med/Low | [Who owns mitigation] | Open |

**Guidance:**
- **Question** — something unknown that needs an answer before or during implementation (e.g. "What is the expected data volume for the first year?")
- **Risk** — a known uncertainty that could derail the plan (e.g. "Third-party API rate limits may not support peak load")
- Items marked **Open** here will be carried forward into a separate Risk & Open Questions document for tracking
- If more than 10 items exist, include the top 10 here and note that the full list is in the risk sheet
