# Stage-Specific Checks: Backlog (Pip)

Structural validation (story_id format, field names, Given/When/Then format, AC counts, Fibonacci point values, platform tag validity, technical AC presence, test case array presence) has already been performed by automated tools. Do not re-raise these structural issues. Focus on whether the stories are logically sound and the scope is correct.

## Story independence

- Every story must be independently deliverable without depending on an unmerged story in the same sprint. If story B cannot be built until story A is merged, they must be in dependency order and story B's AC must not assume story A is complete. Circular dependencies are **CRITICAL**.
- A story that requires design, infrastructure, or a third-party integration to exist before any work can begin — without that dependency being a separate story — is **MAJOR**.

## Acceptance criteria quality

- ACs must be independently testable. An AC that requires a QA engineer to make a judgement call ("the experience should feel smooth", "the flow should be intuitive") is **MAJOR**.
- ACs must describe outcomes, not implementation steps. An AC that specifies HOW rather than WHAT constrains the engineer unnecessarily — **MINOR** for low-stakes choices, **MAJOR** for ACs that would force a specific technical approach.

## Effort consistency

- Effort scores must be internally consistent. Two stories of clearly similar complexity scored 2 and 8 respectively with no explanation is **MAJOR** — inconsistent scoring corrupts sprint planning.
- Stories covering significant integration work, new data models, or cross-platform changes that are scored 1 or 2 are likely underestimated — flag as **MAJOR** with a specific reason.
- Stories scored 8 that have not been decomposed into sub-stories are **MAJOR**.

## Scope coverage

- The PRD is provided as a reference document above. Use it to verify that every functional requirement has a corresponding story. A PRD FR with no corresponding story is **MAJOR** — scope has been silently dropped.
- Each story must have exactly one platform tag (`backend`, `web`, `ios`, or `android`). A story with no platform tag or multiple platform values is **MAJOR** — the validator enforces single-stream but the critic should flag any semantic mismatch too.
- Platform assignment must match the actual work described. A story tagged `web` that clearly involves API design with no corresponding `backend` story is **MAJOR** — the backend work is hidden. Each stream of work that touches a different platform must be its own ticket.
- Phase tags must be consistent with the PRD's Out of Scope section. A story tagged MVP that covers explicitly out-of-scope functionality is **CRITICAL**.

## PM Questions

Should cover genuine scope ambiguity — which persona a story serves if unclear, whether a flow should be MVP or a later phase. Not estimation or AC format.
