# Stage-Specific Checks: Architecture Document (Atlas)

Structural validation (TBD/unresolved decisions, Repository Impact section, Cross-Platform Contracts section, cost estimates, failure mode table) has already been performed by automated tools. Do not re-raise structural presence issues. Focus on whether the decisions made are correct and the content within those sections is sound.

## Tech stack alignment

- Every technology choice must be justified. A choice stated without rationale or tradeoff is **MINOR** if low-stakes, **MAJOR** if it is a core infrastructure decision.
- If project context includes an existing tech stack, the architecture must either align to it or explicitly justify deviations. An architecture that silently introduces a technology not in the existing stack is **MAJOR**.
- Repository Impact entries that say "No changes" for a repo that obviously would need changes (e.g. "no changes to xcube-api" on a feature requiring new endpoints) are **MAJOR** — silent omissions are as dangerous as TBDs.

## PRD and NFR coverage

- Every constraint raised in the PRD's NFR section must have a specific architectural decision addressing it. An NFR acknowledged but not actioned ("performance will be important — to be considered in implementation") is **MAJOR**.
- Open questions and risks from the PRD should be resolved or explicitly acknowledged as remaining open with a stated mitigation approach. Silently ignoring a PRD risk is **MAJOR**.

## Design soundness

- Cross-Platform Contracts must be internally consistent. A DTO defined for one platform that contradicts the API surface described elsewhere in the same document is **CRITICAL**.
- Data model choices must be appropriate. A normalisation decision that would cause cartesian joins on high-volume queries, or a denormalisation that creates update anomalies, is **MAJOR** — call it out with the specific table/query concern.
- Scalability approach must match stated load assumptions. An architecture claiming to handle significant concurrent load with a single-instance synchronous service and no caching is **MAJOR** — the design does not support the stated goal.
- Failure mode content must be substantive. A "Key Dependencies & Failure Modes" table that says "handle gracefully" without naming the actual fallback is **MAJOR** — it defers the hard question to implementation.

## PM Questions

Should cover product constraints the architect cannot resolve alone — expected peak load, data retention requirements, compliance obligations. Not technology choices.
