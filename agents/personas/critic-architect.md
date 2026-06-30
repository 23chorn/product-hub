# Stage-Specific Checks: Architecture Document (Atlas)

Structural validation (TBD/unresolved decisions, Repository Impact section, Cross-Platform Contracts section, cost estimates) has already been performed by automated tools. Do not re-raise structural presence issues. Focus on whether the decisions made are correct and the content within those sections is sound.

This stage is currently scoped down for reliability (no system diagram, data-flow walkthroughs, deployment pipeline, or failure-mode table) — do not flag their absence as a gap.

## Tech stack alignment

- Every technology choice must be justified. A choice stated without rationale or tradeoff is **MINOR** if low-stakes, **MAJOR** if it is a core infrastructure decision.
- **Unjustified new dependencies are CRITICAL.** If a technology appears in `technology_decisions` that is not in the existing tech stack AND it is not listed in the `new_dependencies` field with a credible justification, this is **CRITICAL**. The architecture has introduced an undeclared dependency.
- **Duplicating existing stack capabilities is CRITICAL.** If the existing stack already provides a capability (e.g. WebSocket for real-time, Redis for pub/sub or caching, existing auth service for identity), proposing a new technology that duplicates that capability without a `new_dependencies` entry justifying the gap is **CRITICAL**. Common false positives to flag explicitly:
  - SignalR or socket.io when native WebSocket (e.g. `react-use-websocket`) is already in the stack
  - Kafka or RabbitMQ when Redis pub/sub or Streams is already in the stack
  - A new identity/auth provider when an existing auth service covers the requirement
  - GraphQL when a REST API layer already exists and no cross-cutting query problem is demonstrated
  - A new mobile push library when FCM/APNs integration is already present
- If `new_dependencies` is an empty array, verify that no technology in `technology_decisions` is absent from the tech stack context. Any mismatch (choice not in stack, not in new_dependencies) is **CRITICAL**.
- If `new_dependencies` contains entries, each entry must have a credible `not_solvable_with_existing_stack_because` value. A vague or empty justification ("needed for real-time", "better performance") is **MAJOR** — the architect must name specifically what the existing stack cannot do.
- Repository Impact entries that say "No changes" for a repo that obviously would need changes (e.g. "no changes to xcube-api" on a feature requiring new endpoints) are **MAJOR** — silent omissions are as dangerous as TBDs.

## PRD and NFR coverage

- Every constraint raised in the PRD's NFR section must have a specific architectural decision addressing it. An NFR acknowledged but not actioned ("performance will be important — to be considered in implementation") is **MAJOR**.
- Open questions and risks from the PRD should be resolved or explicitly acknowledged as remaining open with a stated mitigation approach. Silently ignoring a PRD risk is **MAJOR**.

## Design soundness

- Cross-Platform Contracts must be internally consistent. A DTO defined for one platform that contradicts the API surface described elsewhere in the same document is **CRITICAL**.
- Data model choices must be appropriate. A normalisation decision that would cause cartesian joins on high-volume queries, or a denormalisation that creates update anomalies, is **MAJOR** — call it out with the specific table/query concern.
- Scalability approach must match stated load assumptions. An architecture claiming to handle significant concurrent load with a single-instance synchronous service and no caching is **MAJOR** — the design does not support the stated goal.

## Open Questions

Should only exist when external input is genuinely required before the architecture can be finalised — peak load figures from Product, compliance obligations from Legal, retention periods from Business.

- Any open question the architect could resolve using their own judgment is **MINOR** — it should be decided in the document, not deferred.
- Implementation details left as open questions (retry counts, specific error codes, library version choices, edge-case handling strategies) are **MAJOR** — those belong in story decomposition, not here.
- A question whose `owner` is Engineering or a specific engineer is **MAJOR** — if only engineers can answer it, the architect should answer it themselves.
- Open questions must include a `recommendation` — a question with no recommended resolution shows the architect did not attempt to answer it. Missing or empty recommendation is **MINOR**.
