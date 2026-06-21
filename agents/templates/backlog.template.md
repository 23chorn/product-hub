Produce a single valid JSON object wrapped in a ```json code block with this exact structure. No prose before or after — just the JSON block.

This stage is owned by Shard - Product Owner for ticket creation. The output should make the ticket acceptance criteria explicit and testable.

Right-size the output based on scope. Use the **minimum structure** that fits the work:

**Tier 1 — Single story** (trivial scope, 1 deliverable):
```json
{
  "story": {
    "title": "Story title",
    "persona": "Which persona from the PRD",
    "goal": "what the persona wants to achieve in their own words — must be written from the user's point of view, never from a developer/system perspective",
    "benefit": "so that [outcome for the persona]",
    "acceptanceCriteria": [
      "Given [context] When [action] Then [result]"
    ],
    "prdRef": {
      "functionalRequirements": ["FR-01"],
      "nonFunctionalRequirements": ["NFR1"],
      "userJourney": "Journey · Step"
    },
    "technical": {
      "notes": "Meaningful technical direction only — what needs to be built and any real constraint. Not a full spec; exact endpoints, schemas, and components are worked out later. null if nothing notable yet."
    },
    "effort": 3
  }
}
```

**Tier 2 — Single feature** (2–8 related stories, one capability):
```json
{
  "feature": {
    "title": "Feature name",
    "description": "What user capability this feature unlocks",
    "phase": "MVP | Phase 2 | Post-launch",
    "stories": [
      {
        "title": "Story title",
        "persona": "Which persona from the PRD",
        "goal": "what the persona wants to achieve in their own words — must be written from the user's point of view, never from a developer/system perspective",
        "benefit": "so that [outcome for the persona]",
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
}
```

**Tier 3 — Epic with features** (multiple distinct capabilities, 2+ features):
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
          "goal": "what the persona wants to achieve in their own words — must be written from the user's point of view, never from a developer/system perspective",
          "benefit": "so that [outcome for the persona]",
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

Decision criteria:
- Does the work require only 1 story? → Tier 1 (story only)
- Does the work require multiple stories but they all belong to one capability? → Tier 2 (feature with stories)
- Does the work span multiple distinct user-facing capabilities? → Tier 3 (epic with features with stories)

Rules:
- Maximum 6 features per epic — each feature should represent a distinct user-facing capability
- Maximum 12 stories per feature — each story should be independently deliverable in a single sprint
- Stories within a feature must be in dependency order — no story may depend on a later story
- Each story needs 2–4 acceptance criteria, each independently testable
- effort: Fibonacci estimate (1, 2, 3, 5, 8) reflecting total delivery effort including implementation, automated/manual testing, and code review. 1 = trivial change with minimal test surface, 2 = simple CRUD with straightforward test cases, 3 = moderate feature with several test scenarios, 5 = complex feature with integration tests and edge cases, 8 = large cross-cutting change with significant test coverage required. Stories that would score above 8 must be decomposed into smaller stories first.
- phase: use "MVP" for must-have, "Phase 2" for next iteration
- technical.notes: meaningful direction only, not a full implementation spec — detail can be added over time as the story is picked up
- Do not write accessibility-specific acceptance criteria or stories (screen reader support, TalkBack, VoiceOver, voice control, etc.) — out of scope for this product unless the PRD explicitly calls for it
