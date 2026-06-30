# Stage-Specific Checks: PRD (Rex)

Structural validation (required sections, metric baselines/targets, counter-metric presence, NFR measurability, personas section, Out of Scope presence, Open Questions presence) has already been performed by automated tools. Do not re-raise those structural presence issues. Focus on whether the content within those sections is actually sound.

## Requirements quality

- Every functional requirement must trace to a user problem or persona need stated elsewhere in the document. A requirement that exists only as a solution assumption — with no stated user problem — is **MAJOR**.
- FRs written as implementation instructions ("The system will use a microservice to...") rather than capability statements ("Users can...") are **MAJOR** — they constrain the architect without adding user value.
- Vague FRs ("The system shall handle errors gracefully", "The app should be fast") with no measurable threshold are **MAJOR** for core flows, **MINOR** for secondary flows.
- Missing FRs for obviously implied behaviour — error states, empty states, permission failures on core flows — are **MAJOR**.

## Personas and journeys

- Personas must be distinct — if two personas have identical goals and pains, they are the same persona written twice. This is **MINOR** unless the PRD makes different product decisions for each, in which case the duplication causes real ambiguity (**MAJOR**).
- If the research brief is available as prior context, personas should reflect the user segments identified in the research. A persona with no grounding in the research is an assumption — flag as **MAJOR** if it drives significant scope.
- Every persona must appear in at least one user journey. A persona defined but never used in a journey is **MINOR**.

## Success metrics quality

- Targets must be directionally plausible given the context. A target claiming 10× improvement with no supporting rationale is **MAJOR** — it suggests the metric was not seriously considered.
- The primary metric must measure the outcome the feature is solving for — not a proxy. A deposit feature measured by page views rather than deposit conversion is **MAJOR**.
- Counter-metrics must protect the specific existing flows at risk from this change — not generic "don't break things" statements. Generic counter-metrics are **MINOR**; absent counter-metrics for obviously at-risk flows are **MAJOR**.

## NFR quality

- If the project context includes a tech stack or compliance constraints, any NFR that contradicts them is **CRITICAL**.
- NFRs present but with thresholds so loose they would pass any implementation are **MAJOR** for critical paths — a trading platform with "response time < 30s" is not a real constraint.

## PM Questions

Should cover genuine business ambiguity — scope boundaries, expected user behaviour in edge cases, priority between conflicting requirements.

- Any question whose `owner` is Engineering, Architecture, or a specific technical role is **MAJOR** — it is not a PRD question. Technical decisions belong to the Solution Architect and Engineering stages.
- Any question that asks *how* something will be implemented (which service, which algorithm, which fallback strategy, how to handle a technical edge case) is **MAJOR** — the PRD defines *what* and *why*, not *how*.
- Questions should be answerable by a product manager, business owner, legal, or design lead — if only an engineer can answer it, it is in the wrong artifact.
