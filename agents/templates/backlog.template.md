Produce a single valid JSON object wrapped in a ```json code block with this exact structure. No prose before or after — just the JSON block.

```json
{
  "epic": {
    "title": "Short epic name",
    "description": "One sentence: what capability this epic delivers",
    "businessValue": "Why this matters to the business",
    "prdLink": "Initiative name or URL"
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
          "agentContext": "FR numbers this covers, user journey served, technical constraints, definition of done"
        }
      ]
    }
  ]
}
```

Rules:
- Maximum 6 features per epic — each feature should represent a distinct user-facing capability
- Maximum 8 stories per feature — each story should be independently deliverable in a single sprint
- Stories within a feature must be in dependency order — no story may depend on a later story
- Each story needs 2–4 acceptance criteria, each independently testable
- agentContext must include relevant FR numbers (e.g. "Covers FR3, FR7") and the user journey served
- phase: use "MVP" for must-have, "Phase 2" for next iteration
