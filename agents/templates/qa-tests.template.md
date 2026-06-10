# QA Test Suite Output Template

Produce a single valid JSON object wrapped in a ```json code block. No prose before or after — just the JSON block.

The JSON must follow this exact schema:

```json
{
  "suite": "Feature or Epic name under test",
  "version": "1.0",
  "metadata": {
    "prd_version": "string | null",
    "source_documents": ["PRD", "Backlog", "Architecture Document"],
    "notes": "Any assumptions or gaps flagged during test design"
  },
  "test_cases": [
    {
      "id": "TC-001",
      "title": "Concise, specific test case name",
      "description": "Clear summary of what is being tested and why it matters — 1-2 sentences",
      "type": "happy_path",
      "priority": "critical",
      "category": "Logical grouping, e.g. Authentication, Form Validation, Data Display",
      "prd_ref": "FR-01",
      "story_ref": "F1.S1 (Feature.Story format) or null",
      "scenario": {
        "given": [
          "Specific precondition — state of the system or user context"
        ],
        "when": [
          "Specific action the user or system performs"
        ],
        "then": [
          "Specific, observable outcome — what can be asserted"
        ]
      },
      "preconditions": [
        "Any setup required before this test can run, e.g. 'User account exists with role Admin'"
      ],
      "test_data": {
        "note": "Replace with actual field names and values relevant to the test"
      },
      "tags": ["@smoke", "@regression"],
      "automation_notes": "Any hint useful for the automation engineer, or empty string"
    }
  ],
  "coverage": {
    "total": 0,
    "happy_paths": 0,
    "bad_paths": 0,
    "edge_cases": 0,
    "by_priority": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 0
    },
    "by_fr": {
      "FR-01": 0
    }
  }
}
```

## Type values
- `happy_path` — primary success flow
- `bad_path` — invalid input, unauthorised access, error recovery, timeout, network failure
- `edge_case` — boundary values, empty states, max payload, special characters, race conditions

## Priority values
- `critical` — smoke-level; if broken, the feature is entirely unusable
- `high` — important behaviour that will be noticed immediately when broken
- `medium` — standard regression coverage
- `low` — edge case or cosmetic that rarely affects users

## Tag values (use all that apply)
- `@smoke` — fastest path to confirm the feature basically works; run on every deploy
- `@regression` — full regression suite
- `@negative` — tests that expect failure / error states
- `@edge` — boundary and corner cases
- `@security` — authentication, authorisation, injection, CSRF
- `@accessibility` — keyboard navigation, screen reader, ARIA
- `@performance` — response time, large payloads, concurrent load

## Coverage requirements

Every PRD Functional Requirement (FR-XX) must have at least:
- 1 `critical` happy path test
- 1 `bad_path` test for each distinct failure mode
- 1 `edge_case` test for any boundary value mentioned in the AC

Every backlog story acceptance criterion (Given/When/Then) must map to at least one test case via `story_ref` using the format `F1.S1` (Feature 1, Story 1), `F2.S3` (Feature 2, Story 3), etc.

The `coverage.by_fr` object must list every FR from the PRD that has at least one test case.

## Scenario writing rules

**Given** — System state and user context. Use specific values, not categories:
- GOOD: `Given the user is logged in as "alice@example.com" with role "Editor"`
- BAD: `Given the user is authenticated`

**When** — The single action being tested:
- GOOD: `When the user submits the form with email field set to "not-an-email"`
- BAD: `When the user does various things`

**Then** — Specific, assertable outcome:
- GOOD: `Then an inline error message "Please enter a valid email address" appears below the email field`
- BAD: `Then the system shows an error`

Multiple When/Then steps are allowed for sequential actions, but keep each scenario focused on one behaviour.
