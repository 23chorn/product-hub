<!-- START OUTPUT HERE — no preamble, no introductory text, no commentary. Begin directly with the heading below. -->

# [Initiative Name] — Solution Architecture

## Overview

[One to two paragraphs. Summarize the architecture approach: core service boundaries, primary technology choices, key tradeoffs, and the design philosophy (e.g., "boring technology," event-driven, serverless). State the target scale and cost envelope if known. This paragraph should let a senior engineer decide whether to keep reading.]

---

## Key Technology Decisions

[For every major technology choice, state the decision, alternatives considered, and rationale. Be specific — name products, versions, pricing tiers. Do not hand-wave with "we could use any database."]

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **[Decision area]** | [Chosen technology] | [2-3 alternatives considered] | [Why this choice wins: cost, team skill, ecosystem, specific technical property] |

---

## Data Model

[Entity-relationship overview. For each core entity: name, primary key, key fields, relationships, and implementation notes.]

| Entity | Primary Key | Key Fields | Relationships | Notes |
|--------|-------------|-----------|---------------|-------|
| **[Entity name]** | `[pk field]` | [3-5 most important fields] | [1:N, M:N relationships with other entities] | [Constraints, indexing notes, soft-delete strategy] |

### Data Model Diagram

```
[ASCII diagram showing entity relationships using arrows and indentation.
Show cardinality (1:N, M:N) and key foreign key paths.]
```

---

## API Surface

[Group endpoints by service boundary or domain. For each endpoint: method, path, purpose, key request/response fields, and notes on authentication, idempotency, or error handling.]

### [Service / Domain Name]

| Method | Endpoint | Purpose | Request | Response | Notes |
|--------|----------|---------|---------|----------|-------|
| **[METHOD]** | `/path` | [What it does] | [Key request fields or body shape] | [Key response fields] | [Auth, idempotency, rate limits] |

---

## System Architecture

### Service Boundaries & Data Flow

```
[ASCII diagram showing:
- All services/components as labeled boxes
- Data flow direction with arrows
- External dependencies (APIs, databases, caches)
- User entry points
Keep it readable — no more than 3 levels of nesting.]
```

### Component Responsibilities

[For each service/component, describe in a short paragraph:]

**[Component Name]**
- [Responsibility 1: what it does, not how]
- [Responsibility 2]
- [Error handling / retry strategy]

### Data Flow: [Primary User Journey]

```
[Step-by-step walkthrough of the most important user flow through the system.
Show: user action → service → database operation → response.
Name specific endpoints, entities, and fields.]
```

### Data Flow: [Secondary User Journey]

```
[Repeat for 1-2 additional critical flows.]
```

---

## Infrastructure Notes

### Hosting & Deployment Topology

**Development / Staging**
- [Local setup: what to run, how]
- [Staging environment: hosting, database]

**Production**

| Component | Service | Cost/mo | Rationale |
|-----------|---------|---------|-----------|
| **[Component]** | [Hosting service + tier] | $[estimate] | [Why this tier, scaling path] |
| **Total** | — | **$[range]** | [Scale assumptions] |

### Deployment Pipeline

[Numbered steps from code commit to production, including CI/CD, migrations, smoke tests, and monitoring.]

### Key Dependencies & Failure Modes

| Dependency | Impact if Down | Mitigation |
|------------|----------------|------------|
| **[External service]** | [What breaks for the user] | [Fallback, cache, graceful degradation] |

### Scalability Considerations (Phase 2+)

- [Bottleneck 1]: [When it matters] → [Solution]
- [Bottleneck 2]: [When it matters] → [Solution]

---

## Open Questions & Risks

### Unresolved Decisions (Requires Stakeholder Input)

| Question | Impact | Recommendation |
|----------|--------|----------------|
| **[Decision needed]** | [What it affects if left unresolved] | [Your recommended path + what to defer] |

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **[Risk description]** | High/Medium/Low | [Specific mitigation strategy, not "we'll handle it later"] |

### Recommended Next Steps Before Implementation

1. [Action item with enough detail that someone could do it]
2. [Action item]

---

## Appendix: Technology Stack Summary

- **[Layer]**: [Technology + version]
- **[Layer]**: [Technology + version]
- **Hosting**: [Services]
- **External APIs**: [List]
- **Monitoring**: [Tools]
- **CI/CD**: [Pipeline]

**Estimated cost at [target scale]**: $[range]/mo.
