<!-- START OUTPUT HERE — no preamble, no introductory text, no commentary. Begin directly with the heading below. -->

# [Initiative Name] — Solution Architecture

## System Overview

[2–3 sentences. What is being built, which platforms are in scope (web / iOS / Android / backend / infra), and the core architectural approach. State the design philosophy and target scale if known. This should let a senior engineer decide whether to keep reading.]

---

## Technology Choices by Platform

[For every platform in scope, state technology decisions, alternatives considered, and rationale. Be specific — name products, versions, library names. Do not hand-wave with "we could use any database." Skip platforms not in scope for this initiative.]

### Backend

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **[Decision area]** | [Chosen technology] | [Alternatives] | [Why this wins] |

### Web

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **[Decision area]** | [Chosen technology] | [Alternatives] | [Why this wins] |

### iOS

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **[Decision area]** | [Chosen technology] | [Alternatives] | [Why this wins] |

### Android

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **[Decision area]** | [Chosen technology] | [Alternatives] | [Why this wins] |

### Infrastructure

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **[Decision area]** | [Chosen technology] | [Alternatives] | [Why this wins] |

---

## Data Model

[New or modified entities. For each: name, primary key, key fields, relationships, implementation notes. Reference existing tables from `db-schema.md` where relevant.]

| Entity | Primary Key | Key Fields | Relationships | Notes |
|--------|-------------|-----------|---------------|-------|
| **[Entity name]** | `[pk field]` | [3–5 important fields] | [1:N, M:N with other entities] | [Constraints, indexing, soft-delete] |

### Entity Relationship Diagram

```
[ASCII diagram showing entity relationships, cardinality (1:N, M:N), and key FK paths.]
```

---

## API Surface

[New endpoints grouped by service/domain. Name the repo each endpoint lives in.]

### [Service / Domain — repo: reponame]

| Method | Endpoint | Purpose | Request | Response | Notes |
|--------|----------|---------|---------|----------|-------|
| **[METHOD]** | `/path` | [What it does] | [Key request fields] | [Key response fields] | [Auth, idempotency, rate limits] |

---

## Repository Impact

[For every repo listed in `repos.md`, state what changes are needed for this initiative. Use "No changes" for repos unaffected. If a new repo is required, flag it as a risk in the Risks section.]

| Repo | Changes Required | Notes |
|------|-----------------|-------|
| **[repo-name]** | [What is added, modified, or removed] | [Dependencies on other repos, new packages needed] |
| **[repo-name]** | No changes | — |

---

## Cross-Platform Contracts

[Shared types, DTOs, API schemas, pub/sub channel names, and event payloads that span more than one repo. These are the interface contracts story decomposition agents and platform engineers must honour.]

### Shared Types / DTOs

```typescript
// [DTO or interface name] — used by [list of repos]
[Type definition or schema]
```

### Pub/Sub Channels & Events

| Channel | Published by | Consumed by | Payload shape |
|---------|-------------|-------------|---------------|
| **[channel-name]** | [repo] | [repo, repo] | [Key fields] |

### Cross-Repo API Calls

| Caller | Endpoint | Provider repo | Notes |
|--------|----------|--------------|-------|
| **[repo]** | `METHOD /path` | [repo] | [Auth, versioning notes] |

---

## System Architecture Diagram

```
[ASCII diagram:
- All services/components as labeled boxes
- Data flow direction with arrows
- External dependencies (APIs, databases, caches, queues)
- User entry points (web browser, mobile app)
Keep it readable — max 3 levels of nesting.]
```

### Data Flow: [Primary User Journey]

```
[Step-by-step walkthrough of the most critical user flow:
user action → service → database operation → response
Name specific endpoints, entities, channels, and fields.]
```

---

## Deployment & Infrastructure

### Environment Requirements

| Component | Dev/Staging | Production | Notes |
|-----------|-------------|------------|-------|
| **[Component]** | [Setup] | [Hosting + tier] | [Scaling path] |

### Estimated Cost at [Target Scale]

| Component | Service | Cost/mo | Rationale |
|-----------|---------|---------|-----------|
| **[Component]** | [Hosting service + tier] | $[estimate] | [Scale assumptions] |
| **Total** | — | **$[range]** | — |

### Deployment Strategy

[Numbered steps from code commit to production — CI/CD pipeline, migration strategy, feature flags, smoke tests, rollback plan. Call out any platform-specific differences (e.g. App Store review lag for mobile).]

### Key Dependencies & Failure Modes

| Dependency | Impact if Down | Mitigation |
|------------|----------------|------------|
| **[External service]** | [What breaks for the user] | [Fallback, cache, graceful degradation] |

---

## Risks & Mitigations

| Risk | Platform | Severity | Mitigation |
|------|----------|----------|------------|
| **[Risk description]** | [Web / iOS / Android / Backend / All] | High / Medium / Low | [Specific mitigation — not "we'll handle it later"] |

---

## Open Questions

[Decisions that need product or engineering input before implementation begins.]

| Question | Impact if Unresolved | Recommendation |
|----------|---------------------|----------------|
| **[Decision needed]** | [What it blocks or affects] | [Your recommended path, what to defer] |

### Recommended Next Steps Before Implementation

1. [Concrete action — specific enough that someone could do it tomorrow]
2. [Action]
3. [Action]
