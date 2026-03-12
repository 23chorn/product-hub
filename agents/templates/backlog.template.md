Produce a single valid JSON object wrapped in a ```json code block with this exact structure. No prose before or after — just the JSON block.

```json
{
  "epic": {
    "title": "Short epic name",
    "description": "One sentence: what capability this epic delivers",
    "businessValue": "Why this matters to the business",
    "prdLink": "Initiative name or URL",
    "definitionOfDone": "Provided by the agent context"
  },
  "features": [
    {
      "title": "Feature name (e.g. Onboarding)",
      "description": "What user capability this feature unlocks",
      "phase": "MVP | Phase 2 | Post-launch",
      "stories": [
        {
          "title": "Story title",
          "persona": "Which persona from the PRD",
          "goal": "what I want to do",
          "benefit": "so that [outcome]",
          "acceptanceCriteria": [
            "Given [context] When [action] Then [result]",
            "Given [context] When [action] Then [result]"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-01", "FR-03"],
            "userJourney": "Onboarding · Step 3 — First login"
          },
          "technical": {
            "constraints": ["string"],
            "affectedComponents": ["string"],
            "dataChanges": "string | null",
            "apiChanges": "string | null"
          },
          "effort": 3
        }
      ]
    }
  ]
}
```

Rules:
- Maximum 6 features per epic — each feature should represent a distinct user-facing capability
- Maximum 12 stories per feature — each story should be independently deliverable in a single sprint
- Stories within a feature must be in dependency order — no story may depend on a later story
- Each story needs 2–4 acceptance criteria, each independently testable
- agentContext must include relevant FR numbers (e.g. "Covers FR3, FR7") and the user journey served
- effort: Fibonacci estimate (1, 2, 3, 5, 8) reflecting total delivery effort including implementation, automated/manual testing, and code review. 1 = trivial change with minimal test surface, 2 = simple CRUD with straightforward test cases, 3 = moderate feature with several test scenarios, 5 = complex feature with integration tests and edge cases, 8 = large cross-cutting change with significant test coverage required. Stories that would score above 8 must be decomposed into smaller stories first.
- phase: use "MVP" for must-have, "Phase 2" for next iteration
