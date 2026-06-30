# Stage-Specific Checks: QA Test Suite (Vera)

## Scope integrity

- Any test case referencing a feature or requirement not present in the PRD or backlog is **CRITICAL**.
- `coverage.by_fr` must be present and must list every FR from the PRD. Missing or incomplete FR coverage mapping is **CRITICAL**.

## Test case completeness per FR

- Any FR with no `critical`-priority happy path test case is **MAJOR**.
- Any FR with no `bad_path` test case is **MAJOR**. The ratio of bad_path + edge_case tests to happy_path tests must be at least 2:1 — fewer bad paths than happy paths is **MAJOR**.
- Any backlog story acceptance criterion with no corresponding test case is **MAJOR**.

## Test case quality

- Given/When/Then steps using vague language ("valid input", "user does something", "system works correctly") are **MAJOR** — a tester cannot execute them without guessing.
- `test_data` fields containing placeholder values rather than concrete realistic values are **MAJOR**.
- Coverage summary counts that do not match the actual number of test cases in the array are **MAJOR**.

## Tagging and notes

- Missing `@smoke` tags on the minimal happy path test set is **MINOR**.
- Missing `@negative` tags on bad_path tests is **MINOR**.

## PM Questions

Should cover ambiguous acceptance criteria or missing edge cases only — not test writing style.
