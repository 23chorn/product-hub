# Stage-Specific Checks: QA Test Suite (Vera)

This is the epic-level suite generated once after all feature backlogs are approved — one
unified set of test cases (`layer: "user_facing"` and, when an API Contract exists,
`layer: "technical"`) covering the full merged backlog, not a per-feature artifact.
Structural validation (id format, required fields, type/priority/layer enums, Given/When/Then
non-empty arrays, tag validity, minimum test count) has already been performed by automated
tools. Do not re-raise those checks. Focus on whether coverage and quality are genuinely sound.

## Scope integrity

- Any test case referencing a feature, story, or FR not present in the merged backlog or PRD is **CRITICAL**.
- A `story_ref` that does not resolve to a real story_id in the merged backlog is **CRITICAL**.
- A test case about accessibility (WCAG compliance, color contrast, screen reader announcements, keyboard-only navigation, focus order, ARIA attributes, etc.) that isn't explicitly required by the PRD is **MAJOR** — out of scope for this product.

## Coverage completeness

- The PRD is provided as a reference document above. Cross-check its functional requirements against the `prd_ref` values across all test cases — an FR with no corresponding user-facing test case is **MAJOR**, unless it is backend-only work with no observable user outcome.
- Every feature with user-facing stories must have at least one `@smoke` happy-path test case — a feature with none is **MAJOR**.
- A functional scenario that spans two or more features (e.g. Feature A creates data Feature B displays) with no cross-feature test case (`features` array listing more than one feature) is **MAJOR** — this is the highest-risk coverage gap.
- Fewer than 25% of user-facing test cases being `negative` or `edge` type is **MAJOR** — insufficient failure-mode coverage.
- More than 3 test cases per single FR, or duplicate coverage of the same scenario across multiple test cases, is **MINOR** — the suite should stay conservative, not padded.

## Technical (API) layer

- When an API Contract was provided in context, an endpoint from that contract with no `layer: "technical"` test case is **MAJOR** — silent gap in contract coverage.
- A `layer: "technical"` test case phrased as a UI action (clicking, navigating, viewing a screen) instead of a request/response contract check is **MAJOR** — the two layers must stay distinct.
- A `layer: "technical"` test case whose `endpoint` does not match a real method+path in the provided API Contract is **MAJOR** — invented endpoint.
- No API Contract in context but `layer: "technical"` test cases are present anyway is **MAJOR** — there are no endpoints to trace them to.

## Test case quality

- Given/When/Then steps using vague language ("valid input", "user does something", "system works correctly") are **MAJOR** — a tester cannot execute them without guessing.
- An iOS and Android story covering the same functional flow written as two separate test cases instead of one combined mobile test case (per the suite's own combination rule) is **MINOR** — unnecessary duplication.
- `preconditions` that are empty or too generic to set up the test ("system is running") when the scenario clearly depends on specific state is **MINOR**.

## Tagging and notes

- Missing `@smoke` tags on the minimal happy-path test set is **MINOR**.
- Missing `@negative` or `@edge` tags on negative/edge-type tests is **MINOR**.

## PM Questions

Should cover ambiguous acceptance criteria or missing edge cases only — not test writing style.
